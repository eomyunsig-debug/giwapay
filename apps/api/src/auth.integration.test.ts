import { fileURLToPath } from 'node:url';

import {
  and,
  apiKeys,
  chainBlocks,
  chainCursors,
  chainEvents,
  createDatabase,
  eq,
  inArray,
  merchants,
  paymentIntents,
  refundRequests,
  webhookDeliveries,
  webhookEndpoints,
  webhookEvents,
} from '@giwapay/db';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pino from 'pino';
import { SiweMessage } from 'siwe';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import { randomToken, secretDigest } from './crypto.js';
import { loadConfig } from './env.js';
import { ChainIndexer } from './indexer-service.js';
import { PaymentIntentSigner } from './signer.js';
import type { AppServices } from './types.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const run = databaseUrl ? describe : describe.skip;

run('SIWE integration', () => {
  const database = createDatabase(databaseUrl ?? 'postgresql://unused');
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl ?? 'postgresql://unused:unused@127.0.0.1:1/unused',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    WEB_BASE_URL: 'http://localhost:3000',
    PUBLIC_API_URL: 'http://localhost:3001',
    SESSION_SECRET: 's'.repeat(32),
    API_KEY_PEPPER: 'p'.repeat(32),
    WEBHOOK_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    GIWA_RPC_URL: 'http://127.0.0.1:8545',
  });
  const chainClient = {
    getChainId: async () => 91_342,
  } as unknown as AppServices['chainClient'];
  const services: AppServices = {
    config,
    db: database.db,
    pool: database.pool,
    chainClient,
    intentSigner: new PaymentIntentSigner(config),
  };
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    await migrate(database.db, {
      migrationsFolder: fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)),
    });
    app = await buildApp(services);
  });

  afterAll(async () => {
    await app?.close();
    await database.close();
  });

  it('binds nonce to origin/address and enforces one-time use', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const nonceResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/nonce',
      headers: { origin: 'http://localhost:3000' },
      payload: { address: account.address },
    });
    expect(nonceResponse.statusCode).toBe(200);
    const nonce = nonceResponse.json<{
      nonce: string;
      domain: string;
      uri: string;
      chainId: number;
      issuedAt: string;
      expirationTime: string;
      statement: string;
    }>();
    const message = new SiweMessage({
      domain: nonce.domain,
      address: account.address,
      statement: nonce.statement,
      uri: nonce.uri,
      version: '1',
      chainId: nonce.chainId,
      nonce: nonce.nonce,
      issuedAt: nonce.issuedAt,
      expirationTime: nonce.expirationTime,
    }).prepareMessage();
    const signature = await account.signMessage({ message });
    const alteredMessage = new SiweMessage({
      domain: nonce.domain,
      address: account.address,
      statement: 'A different sign-in statement',
      uri: nonce.uri,
      version: '1',
      chainId: nonce.chainId,
      nonce: nonce.nonce,
      issuedAt: nonce.issuedAt,
      expirationTime: nonce.expirationTime,
    }).prepareMessage();
    const alteredSignature = await account.signMessage({ message: alteredMessage });
    const altered = await app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      headers: { origin: 'http://localhost:3000' },
      payload: { message: alteredMessage, signature: alteredSignature },
    });
    expect(altered.statusCode).toBe(401);
    expect(altered.json().error.code).toBe('siwe_context_mismatch');
    const verify = () =>
      app.inject({
        method: 'POST',
        url: '/v1/auth/verify',
        headers: { origin: 'http://localhost:3000' },
        payload: { message, signature },
      });
    const first = await verify();
    expect(first.statusCode).toBe(200);
    const setCookieHeaders = first.headers['set-cookie'];
    expect(
      Array.isArray(setCookieHeaders) ? setCookieHeaders.join('; ') : setCookieHeaders,
    ).toContain('HttpOnly');
    const merchantId = first.json<{ merchant: { id: string } }>().merchant.id;
    const rawApiKey = `gwp_test_${randomToken(32)}`;
    await database.db.insert(apiKeys).values({
      merchantId,
      idempotencyKey: crypto.randomUUID(),
      name: 'payment-only',
      prefix: rawApiKey.slice(0, 20),
      keyHash: secretDigest(rawApiKey, config.API_KEY_PEPPER),
      scopes: ['payment_intents:read'],
    });
    const webhookRead = await app.inject({
      method: 'GET',
      url: '/v1/webhook-endpoints',
      headers: { authorization: `Bearer ${rawApiKey}` },
    });
    expect(webhookRead.statusCode).toBe(403);
    expect(webhookRead.json().error.code).toBe('scope_required');
    const replay = await verify();
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe('siwe_nonce_invalid');
  });

  it('reloads the persisted cursor immediately after a reorg rollback', async () => {
    // TEST_DATABASE_URL may point at a reusable local database. Reset only
    // indexer-owned projections so this regression remains repeatable.
    await database.db.delete(chainEvents);
    await database.db.delete(chainBlocks);
    await database.db.delete(chainCursors);
    await database.db.delete(webhookEvents);
    const router =
      `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(20))).toString('hex')}` as const;
    const hash = (byte: string) => `0x${byte.repeat(64)}` as const;
    const merchantAddress =
      `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(20))).toString('hex')}` as const;
    const [merchant] = await database.db
      .insert(merchants)
      .values({
        onchainMerchantAddress: merchantAddress,
        adminAddress: merchantAddress,
        payoutAddress: merchantAddress,
        status: 'active',
        settings: { displayName: 'Reorg merchant' },
      })
      .returning();
    if (!merchant) throw new Error('Unable to create reorg test merchant');
    const paymentId = hash('a');
    const [intent] = await database.db
      .insert(paymentIntents)
      .values({
        paymentId,
        merchantId: merchant.id,
        idempotencyKey: crypto.randomUUID(),
        description: 'Reorg payment',
        settlementToken: merchantAddress,
        settlementAmount: '1000',
        splitId: hash('0'),
        platformFee: '5',
        validAfter: new Date('2026-07-28T00:00:00.000Z'),
        payerRestriction: `0x${'00'.repeat(20)}`,
        metadataHash: hash('d'),
        chainId: 91_342,
        routerAddress: router,
        signerAddress: merchantAddress,
        signature: '0x00',
        typedData: {
          domain: {
            name: 'GiwaPay',
            version: '1',
            chainId: 91_342,
            verifyingContract: router,
          },
          primaryType: 'PaymentIntent',
          types: { PaymentIntent: [] },
          message: {
            merchant: merchantAddress,
            signer: merchantAddress,
            splitHash: hash('c'),
          },
        },
        status: 'partially_refunded',
        expiresAt: new Date('2026-07-29T00:00:00.000Z'),
        metadata: {},
        payerAddress: merchantAddress,
        inputToken: merchantAddress,
        inputAmount: '1005',
        platformFeeAmount: '5',
        paymentTransactionHash: hash('4'),
        paymentBlockNumber: 100n,
        paymentBlockHash: hash('2'),
        paymentLogIndex: 1,
        chainVerifiedAt: new Date(),
        expectedSettlementRecipients: [{ address: merchantAddress, basisPoints: 10_000 }],
        settlementRecipients: [{ address: merchantAddress, basisPoints: 10_000, amount: '1000' }],
        refundedAmount: '100',
      })
      .returning();
    if (!intent) throw new Error('Unable to create reorg test payment');
    const [refund] = await database.db
      .insert(refundRequests)
      .values({
        refundId: hash('b'),
        paymentIntentId: intent.id,
        merchantId: merchant.id,
        idempotencyKey: crypto.randomUUID(),
        amount: '100',
        status: 'succeeded',
        transactionHash: hash('5'),
        blockNumber: 100n,
        blockHash: hash('2'),
        logIndex: 2,
        chainVerifiedAt: new Date(),
      })
      .returning();
    if (!refund) throw new Error('Unable to create reorg test refund');
    await database.db.insert(chainEvents).values([
      {
        chainId: 91_342,
        contractAddress: router,
        transactionHash: hash('4'),
        logIndex: 1,
        blockNumber: 100n,
        blockHash: hash('2'),
        eventName: 'PaymentSucceeded',
        merchantAddress,
        aggregateId: paymentId,
        payload: {},
      },
      {
        chainId: 91_342,
        contractAddress: router,
        transactionHash: hash('5'),
        logIndex: 2,
        blockNumber: 100n,
        blockHash: hash('2'),
        eventName: 'Refunded',
        merchantAddress,
        aggregateId: paymentId,
        payload: { refundId: refund.refundId, totalRefunded: '100' },
      },
    ]);
    const [endpoint] = await database.db
      .insert(webhookEndpoints)
      .values({
        merchantId: merchant.id,
        url: `https://merchant-${merchant.id}.example/webhook`,
        secretCiphertext: 'not-used-by-reorg-test',
        secretLastFour: 'test',
      })
      .returning();
    if (!endpoint) throw new Error('Unable to create reorg test endpoint');
    const paymentWebhookId = crypto.randomUUID();
    const refundWebhookId = crypto.randomUUID();
    await database.db.insert(webhookEvents).values([
      {
        id: paymentWebhookId,
        merchantId: merchant.id,
        eventType: 'payment.succeeded',
        aggregateId: intent.id,
        payload: {
          id: paymentWebhookId,
          type: 'payment.succeeded',
          createdAt: new Date().toISOString(),
          data: { blockHash: hash('2') },
        },
      },
      {
        id: refundWebhookId,
        merchantId: merchant.id,
        eventType: 'refund.succeeded',
        aggregateId: refund.id,
        payload: {
          id: refundWebhookId,
          type: 'refund.succeeded',
          createdAt: new Date().toISOString(),
          data: { blockHash: hash('2') },
        },
      },
    ]);
    const originalDeliveries = await database.db
      .insert(webhookDeliveries)
      .values([
        { eventId: paymentWebhookId, endpointId: endpoint.id, status: 'retry' },
        { eventId: refundWebhookId, endpointId: endpoint.id, status: 'processing' },
      ])
      .returning({ id: webhookDeliveries.id });
    await database.db.insert(chainBlocks).values([
      {
        chainId: 91_342,
        blockNumber: 90n,
        blockHash: hash('1'),
        parentHash: hash('0'),
      },
      {
        chainId: 91_342,
        blockNumber: 100n,
        blockHash: hash('2'),
        parentHash: hash('1'),
      },
    ]);
    await database.db.insert(chainCursors).values({
      chainId: 91_342,
      contractAddress: router,
      nextBlockNumber: 101n,
      lastBlockHash: hash('2'),
    });
    let staleCursorAdvanced = false;
    const reorgClient = {
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) =>
        blockNumber === 90n
          ? { hash: hash('1'), parentHash: hash('0') }
          : { hash: hash('3'), parentHash: hash('1') },
      getBlockNumber: async () => {
        staleCursorAdvanced = true;
        throw new Error('stale cursor must not advance');
      },
    } as unknown as AppServices['chainClient'];
    const indexerConfig = {
      ...config,
      PAYMENT_ROUTER_ADDRESS: router,
      CHAIN_START_BLOCK: 0n,
    };
    const indexer = new ChainIndexer(
      {
        ...services,
        config: indexerConfig,
        chainClient: reorgClient,
      },
      pino({ level: 'silent' }),
    );
    await expect(indexer.next()).resolves.toBe(true);
    expect(staleCursorAdvanced).toBe(false);
    const [cursor] = await database.db
      .select()
      .from(chainCursors)
      .where(and(eq(chainCursors.chainId, 91_342), eq(chainCursors.contractAddress, router)));
    expect(cursor?.nextBlockNumber).toBe(91n);
    expect(cursor?.lastBlockHash).toBe(hash('1'));
    const rolledBackDeliveries = await database.db
      .select()
      .from(webhookDeliveries)
      .where(
        inArray(
          webhookDeliveries.id,
          originalDeliveries.map((delivery) => delivery.id),
        ),
      );
    expect(rolledBackDeliveries.map((delivery) => delivery.status)).toEqual([
      'dead_letter',
      'dead_letter',
    ]);
    expect(rolledBackDeliveries.every((delivery) => delivery.leaseExpiresAt === null)).toBe(true);
    const reorgEvents = await database.db
      .select({ eventType: webhookEvents.eventType, payload: webhookEvents.payload })
      .from(webhookEvents)
      .where(inArray(webhookEvents.eventType, ['payment.reorged', 'refund.reorged']));
    expect(reorgEvents.map((event) => event.eventType).sort()).toEqual([
      'payment.reorged',
      'refund.reorged',
    ]);
    expect(
      reorgEvents.every((event) => event.payload.data.invalidatedBlockHash === hash('2')),
    ).toBe(true);
    const [rolledBackRefund] = await database.db
      .select()
      .from(refundRequests)
      .where(eq(refundRequests.id, refund.id));
    expect(rolledBackRefund?.status).toBe('submitted');
    expect(rolledBackRefund?.transactionHash).toBe(hash('5'));
  });
});
