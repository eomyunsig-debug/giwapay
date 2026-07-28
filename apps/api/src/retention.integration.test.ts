import { fileURLToPath } from 'node:url';

import {
  authNonces,
  chainBlocks,
  chainCursors,
  createDatabase,
  eq,
  merchants,
  sessions,
  webhookDeliveries,
  webhookEndpoints,
  webhookEvents,
} from '@giwapay/db';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from './env.js';
import { runRetentionCycle } from './retention.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const run = databaseUrl ? describe : describe.skip;

run('retention integration', () => {
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
    AUTH_RETENTION_DAYS: '1',
    WEBHOOK_RETENTION_DAYS: '7',
    RETENTION_BATCH_SIZE: '100',
    REORG_LOOKBACK_BLOCKS: '1000',
    CHAIN_CONFIRMATIONS: '3',
  });

  beforeAll(async () => {
    await migrate(database.db, {
      migrationsFolder: fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)),
    });
  });

  afterAll(async () => {
    await database.close();
  });

  it('removes only expired auth, terminal webhooks, and blocks outside reorg lookback', async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1_000);
    const future = new Date(now.getTime() + 24 * 60 * 60 * 1_000);
    const address = `0x${crypto.randomUUID().replaceAll('-', '').slice(0, 40).padEnd(40, '1')}`;
    const [merchant] = await database.db
      .insert(merchants)
      .values({
        onchainMerchantAddress: address,
        adminAddress: address,
        payoutAddress: address,
        settings: { displayName: 'Retention merchant' },
      })
      .returning();
    if (!merchant) throw new Error('Unable to create retention merchant');

    const expiredNonceHash = crypto.randomUUID().replaceAll('-', '').padEnd(64, '1');
    const activeNonceHash = crypto.randomUUID().replaceAll('-', '').padEnd(64, '2');
    await database.db.insert(authNonces).values([
      {
        nonceHash: expiredNonceHash,
        walletAddress: address,
        domain: 'localhost:3000',
        uri: 'http://localhost:3000',
        chainId: 91_342,
        expiresAt: old,
        createdAt: old,
      },
      {
        nonceHash: activeNonceHash,
        walletAddress: address,
        domain: 'localhost:3000',
        uri: 'http://localhost:3000',
        chainId: 91_342,
        expiresAt: future,
      },
    ]);
    const expiredSessionHash = crypto.randomUUID().replaceAll('-', '').padEnd(64, '3');
    const activeSessionHash = crypto.randomUUID().replaceAll('-', '').padEnd(64, '4');
    await database.db.insert(sessions).values([
      {
        merchantId: merchant.id,
        walletAddress: address,
        tokenHash: expiredSessionHash,
        csrfHash: crypto.randomUUID().replaceAll('-', '').padEnd(64, '5'),
        expiresAt: old,
        createdAt: old,
      },
      {
        merchantId: merchant.id,
        walletAddress: address,
        tokenHash: activeSessionHash,
        csrfHash: crypto.randomUUID().replaceAll('-', '').padEnd(64, '6'),
        expiresAt: future,
      },
    ]);

    const [endpoint] = await database.db
      .insert(webhookEndpoints)
      .values({
        merchantId: merchant.id,
        url: `https://retention-${merchant.id}.example/webhook`,
        secretCiphertext: 'retention-test',
        secretLastFour: 'test',
      })
      .returning();
    if (!endpoint) throw new Error('Unable to create retention endpoint');
    const terminalEventId = crypto.randomUUID();
    const pendingEventId = crypto.randomUUID();
    await database.db.insert(webhookEvents).values([
      {
        id: terminalEventId,
        merchantId: merchant.id,
        eventType: 'payment.succeeded',
        aggregateId: crypto.randomUUID(),
        payload: {
          id: terminalEventId,
          type: 'payment.succeeded',
          createdAt: old.toISOString(),
          data: {},
        },
        createdAt: old,
      },
      {
        id: pendingEventId,
        merchantId: merchant.id,
        eventType: 'payment.succeeded',
        aggregateId: crypto.randomUUID(),
        payload: {
          id: pendingEventId,
          type: 'payment.succeeded',
          createdAt: old.toISOString(),
          data: {},
        },
        createdAt: old,
      },
    ]);
    await database.db.insert(webhookDeliveries).values([
      { eventId: terminalEventId, endpointId: endpoint.id, status: 'succeeded' },
      { eventId: pendingEventId, endpointId: endpoint.id, status: 'retry' },
    ]);

    const chainId = 100_000 + Math.floor(Math.random() * 1_000_000);
    const contractAddress =
      `0x${crypto.randomUUID().replaceAll('-', '').slice(0, 40).padEnd(40, '7')}` as const;
    const hash = (byte: string) => `0x${byte.repeat(64)}` as const;
    await database.db.insert(chainCursors).values({
      chainId,
      contractAddress,
      nextBlockNumber: 2_000n,
      lastBlockHash: hash('f'),
    });
    await database.db.insert(chainBlocks).values([
      {
        chainId,
        blockNumber: 1n,
        blockHash: hash('a'),
        parentHash: hash('0'),
      },
      {
        chainId,
        blockNumber: 1_500n,
        blockHash: hash('b'),
        parentHash: hash('a'),
      },
    ]);
    await database.pool.query(
      `insert into request_rate_limits (
         rate_key, window_start, request_count, expires_at
       ) values ($1, $2, 1, $3)`,
      [crypto.randomUUID().replaceAll('-', '').padEnd(64, '8'), 1, old],
    );

    const deleted = await runRetentionCycle({ config, pool: database.pool }, now);
    expect(deleted).toMatchObject({
      authNonces: 1,
      sessions: 1,
      webhookEvents: 1,
      chainBlocks: 1,
      requestRateLimits: 1,
    });
    expect(
      await database.db.select().from(authNonces).where(eq(authNonces.nonceHash, activeNonceHash)),
    ).toHaveLength(1);
    expect(
      await database.db.select().from(sessions).where(eq(sessions.tokenHash, activeSessionHash)),
    ).toHaveLength(1);
    expect(
      await database.db.select().from(webhookEvents).where(eq(webhookEvents.id, pendingEventId)),
    ).toHaveLength(1);
    expect(
      await database.db.select().from(chainBlocks).where(eq(chainBlocks.chainId, chainId)),
    ).toHaveLength(1);
    expect(
      (await database.pool.query('select 1 from request_rate_limits where expires_at < $1', [now]))
        .rowCount,
    ).toBe(0);
  });
});
