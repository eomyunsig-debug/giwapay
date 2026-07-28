import { fileURLToPath } from 'node:url';

import { and, apiKeys, createDatabase, eq, merchants, paymentIntents } from '@giwapay/db';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import { zeroAddress, zeroBytes32 } from './abi.js';
import { randomToken, secretDigest } from './crypto.js';
import { loadConfig } from './env.js';
import { PaymentIntentSigner } from './signer.js';
import type { AppServices } from './types.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const run = databaseUrl ? describe : describe.skip;

const routerAddress = `0x${'11'.repeat(20)}` as const;
const merchantRegistryAddress = `0x${'22'.repeat(20)}` as const;
const adapterRegistryAddress = `0x${'33'.repeat(20)}` as const;
const settlementToken = `0x${'44'.repeat(20)}` as const;

type OnchainMerchant = {
  admin: `0x${string}`;
  payoutAddress: `0x${string}`;
  delegatedSigner: `0x${string}`;
  refundOperator: `0x${string}`;
  active: boolean;
  createdAt: bigint;
  updatedAt: bigint;
};

run('PaymentIntent route integration', () => {
  const database = createDatabase(databaseUrl ?? 'postgresql://unused', { max: 4 });
  const signerPrivateKey = generatePrivateKey();
  const signerAccount = privateKeyToAccount(signerPrivateKey);
  const onchainMerchants = new Map<string, OnchainMerchant>();
  let chainCalls = 0;
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: databaseUrl ?? 'postgresql://unused:unused@127.0.0.1:1/unused',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    WEB_BASE_URL: 'http://localhost:3000',
    PUBLIC_API_URL: 'http://localhost:3001',
    SESSION_SECRET: 's'.repeat(32),
    API_KEY_PEPPER: 'p'.repeat(32),
    WEBHOOK_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    GIWA_RPC_URL: 'http://127.0.0.1:8545',
    CHAIN_CONFIRMATIONS: '1',
    CHAIN_READ_CACHE_TTL_MS: '250',
    PAYMENT_ROUTER_ADDRESS: routerAddress,
    MERCHANT_REGISTRY_ADDRESS: merchantRegistryAddress,
    ADAPTER_REGISTRY_ADDRESS: adapterRegistryAddress,
    PAYMENT_INTENT_SIGNER_PRIVATE_KEY: signerPrivateKey,
    PLATFORM_FEE_BPS: '50',
    SUPPORTED_PAYMENT_TOKENS_JSON: JSON.stringify([
      {
        token: settlementToken,
        tokenSymbol: 'USDC',
        tokenName: 'Test settlement token',
        tokenDecimals: 6,
        settlementToken,
        adapterIdentifier: 'direct',
        adapterData: '0x',
        defaultSlippageBps: 0,
        testOnly: false,
      },
    ]),
  });
  const chainClient = {
    getBlockNumber: async () => {
      chainCalls += 1;
      return 100n;
    },
    getChainId: async () => 91_342,
    readContract: async ({
      functionName,
      args,
    }: {
      functionName: string;
      args?: readonly unknown[];
    }) => {
      chainCalls += 1;
      if (functionName === 'platformFeeBps') return 50;
      if (functionName === 'merchantRegistry') return merchantRegistryAddress;
      if (functionName === 'adapterRegistry') return adapterRegistryAddress;
      if (functionName === 'getMerchant') {
        const merchant = onchainMerchants.get(String(args?.[0]).toLowerCase());
        if (!merchant) throw new Error('Unknown test merchant');
        return merchant;
      }
      if (functionName === 'getSplitTemplate') {
        const merchant = onchainMerchants.get(String(args?.[0]).toLowerCase());
        if (!merchant) throw new Error('Unknown test merchant');
        return [[merchant.payoutAddress], [10_000], true] as const;
      }
      throw new Error(`Unexpected readContract call: ${functionName}`);
    },
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

  async function createMerchant() {
    const admin = privateKeyToAccount(generatePrivateKey()).address.toLowerCase() as `0x${string}`;
    const payout = privateKeyToAccount(generatePrivateKey()).address.toLowerCase() as `0x${string}`;
    const [merchant] = await database.db
      .insert(merchants)
      .values({
        onchainMerchantAddress: admin,
        adminAddress: admin,
        payoutAddress: payout,
        delegatedSignerAddress: signerAccount.address.toLowerCase(),
        status: 'active',
        onchainRegisteredAt: new Date(),
        settings: { displayName: 'Route test merchant' },
      })
      .returning();
    if (!merchant) throw new Error('Unable to create test merchant');
    onchainMerchants.set(admin, {
      admin,
      payoutAddress: payout,
      delegatedSigner: signerAccount.address.toLowerCase() as `0x${string}`,
      refundOperator: zeroAddress,
      active: true,
      createdAt: 1n,
      updatedAt: 1n,
    });
    const apiKey = `gwp_test_${randomToken(32)}`;
    await database.db.insert(apiKeys).values({
      merchantId: merchant.id,
      idempotencyKey: crypto.randomUUID(),
      name: 'route-test',
      prefix: apiKey.slice(0, 20),
      keyHash: secretDigest(apiKey, config.API_KEY_PEPPER),
      scopes: ['payment_intents:read', 'payment_intents:write', 'refunds:write'],
    });
    return { admin, apiKey, merchant };
  }

  function createBody(idempotencyKey: string) {
    return {
      idempotencyKey,
      description: 'Concurrent payment',
      settlementToken,
      settlementAmount: '25000000',
      splitId: zeroBytes32,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      payer: zeroAddress,
      metadata: { orderId: crypto.randomUUID() },
    };
  }

  async function postIntent(apiKey: string, payload: ReturnType<typeof createBody>) {
    return app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'idempotency-key': payload.idempotencyKey,
      },
      payload,
    });
  }

  it('serializes concurrent idempotent retries and rejects semantic key reuse', async () => {
    const { apiKey, merchant } = await createMerchant();
    const idempotencyKey = crypto.randomUUID();
    const payload = createBody(idempotencyKey);

    const responses = await Promise.all([postIntent(apiKey, payload), postIntent(apiKey, payload)]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 201]);
    const bodies = responses.map((response) =>
      response.json<{ paymentIntent: { id: string; paymentId: string } }>(),
    );
    expect(bodies[0]?.paymentIntent.id).toBe(bodies[1]?.paymentIntent.id);
    expect(bodies[0]?.paymentIntent.paymentId).toBe(bodies[1]?.paymentIntent.paymentId);

    const stored = await database.db
      .select({ id: paymentIntents.id })
      .from(paymentIntents)
      .where(
        and(
          eq(paymentIntents.merchantId, merchant.id),
          eq(paymentIntents.idempotencyKey, idempotencyKey),
        ),
      );
    expect(stored).toHaveLength(1);

    const conflict = await postIntent(apiKey, {
      ...payload,
      description: 'Different payment',
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('idempotency_key_conflict');
  });

  it('rejects an unsafe payment window without storing an intent', async () => {
    const { apiKey, merchant } = await createMerchant();
    const payload = {
      ...createBody(crypto.randomUUID()),
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    };

    const response = await postIntent(apiKey, payload);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('payment_window_invalid');
    const stored = await database.db
      .select({ id: paymentIntents.id })
      .from(paymentIntents)
      .where(eq(paymentIntents.merchantId, merchant.id));
    expect(stored).toHaveLength(0);
  });

  it('fails closed when the delegated signer is revoked after intent creation', async () => {
    const { admin, apiKey } = await createMerchant();
    const created = await postIntent(apiKey, createBody(crypto.randomUUID()));
    expect(created.statusCode).toBe(201);
    const paymentIntentId = created.json<{ paymentIntent: { id: string } }>().paymentIntent.id;
    const state = onchainMerchants.get(admin);
    if (!state) throw new Error('Missing on-chain merchant fixture');
    state.delegatedSigner = zeroAddress;

    const quote = await app.inject({
      method: 'GET',
      url: `/v1/payment-intents/${paymentIntentId}/quote?tokenIn=${settlementToken}`,
    });
    expect(quote.statusCode).toBe(409);
    expect(quote.json().error.code).toBe('payment_intent_authorization_revoked');
  });

  it('rejects a tampered quote envelope', async () => {
    const { apiKey } = await createMerchant();
    const created = await postIntent(apiKey, createBody(crypto.randomUUID()));
    expect(created.statusCode).toBe(201);
    const paymentIntentId = created.json<{ paymentIntent: { id: string } }>().paymentIntent.id;
    const quote = await app.inject({
      method: 'GET',
      url: `/v1/payment-intents/${paymentIntentId}/quote?tokenIn=${settlementToken}`,
    });
    expect(quote.statusCode).toBe(200);
    const quoteId = quote.json<{ quoteId: string }>().quoteId;
    const final = quoteId.at(-1);
    const tampered = `${quoteId.slice(0, -1)}${final === 'A' ? 'B' : 'A'}`;
    await new Promise((resolve) => setTimeout(resolve, 275));
    const callsBeforePrepare = chainCalls;

    const prepare = await app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${paymentIntentId}/prepare`,
      payload: { tokenIn: settlementToken, quoteId: tampered },
    });
    expect(prepare.statusCode).toBe(409);
    expect(prepare.json().error.code).toBe('quote_invalid');
    expect(chainCalls).toBe(callsBeforePrepare);
  });

  it('applies a strict per-intent prepare limit before chain work', async () => {
    const { apiKey } = await createMerchant();
    const created = await postIntent(apiKey, createBody(crypto.randomUUID()));
    expect(created.statusCode).toBe(201);
    const paymentIntentId = created.json<{ paymentIntent: { id: string } }>().paymentIntent.id;
    const invalidPrepare = () =>
      app.inject({
        method: 'POST',
        url: `/v1/payment-intents/${paymentIntentId}/prepare`,
        payload: { tokenIn: settlementToken, quoteId: 'invalid-envelope'.repeat(3) },
      });

    const responses = [];
    for (let index = 0; index < config.PREPARE_RATE_LIMIT_MAX + 1; index += 1) {
      responses.push(await invalidPrepare());
    }
    expect(responses.slice(0, -1).every((response) => response.statusCode === 409)).toBe(true);
    expect(responses.at(-1)?.statusCode).toBe(429);
  });
});
