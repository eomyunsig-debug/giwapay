import { PgDialect } from 'drizzle-orm/pg-core';
import type { Logger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppServices } from './types.js';
import { encryptSecret } from './crypto.js';
import { type ClaimedDelivery, deliverWebhook, webhookLeaseDurationMs } from './webhooks.js';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock('undici', () => ({
  Agent: class {
    async close() {}
  },
  fetch: mocks.fetch,
}));

vi.mock('./http-security.js', () => ({
  resolveSafeWebhookTarget: vi.fn(async () => ({
    url: new URL('https://merchant.example/webhooks'),
    addresses: [{ address: '203.0.113.10', family: 4 }],
  })),
}));

function createClaimedDelivery(): ClaimedDelivery {
  const leaseExpiresAt = new Date('2026-07-28T12:02:00.000Z');
  return {
    delivery: {
      id: '10000000-0000-4000-8000-000000000001',
      eventId: '20000000-0000-4000-8000-000000000002',
      endpointId: '30000000-0000-4000-8000-000000000003',
      status: 'processing',
      attemptCount: 1,
      nextAttemptAt: new Date('2026-07-28T12:00:00.000Z'),
      leaseExpiresAt,
      responseStatus: null,
      responseBody: null,
      lastError: null,
      deliveredAt: null,
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
      updatedAt: new Date('2026-07-28T12:00:00.000Z'),
    },
    event: {
      id: '20000000-0000-4000-8000-000000000002',
      merchantId: '40000000-0000-4000-8000-000000000004',
      eventType: 'payment.succeeded',
      aggregateId: '50000000-0000-4000-8000-000000000005',
      payload: {
        id: '20000000-0000-4000-8000-000000000002',
        type: 'payment.succeeded',
        createdAt: '2026-07-28T12:00:00.000Z',
        data: {},
      },
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
    },
    endpoint: {
      id: '30000000-0000-4000-8000-000000000003',
      merchantId: '40000000-0000-4000-8000-000000000004',
      url: 'https://merchant.example/webhooks',
      description: null,
      secretCiphertext: encryptSecret('whsec_test', Buffer.alloc(32)),
      secretLastFour: 'test',
      enabled: true,
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
      updatedAt: new Date('2026-07-28T12:00:00.000Z'),
    },
  };
}

function createStaleServices(capturedQueries: { sql: string; params: unknown[] }[]) {
  const update = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn((predicate: { getSQL(): unknown }) => {
        const query = new PgDialect().sqlToQuery(
          predicate as Parameters<PgDialect['sqlToQuery']>[0],
        );
        capturedQueries.push({ sql: query.sql, params: query.params });
        return {
          // The current database row belongs to attempt 2, so the attempt-1
          // compare-and-set predicate intentionally matches no row.
          returning: vi.fn(async () => []),
        };
      }),
    })),
  }));
  return {
    db: { update },
    config: {
      NODE_ENV: 'test',
      WEBHOOK_TIMEOUT_MS: 60_000,
      WEBHOOK_MAX_ATTEMPTS: 8,
      webhookKey: Buffer.alloc(32),
    },
  } as unknown as AppServices;
}

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
  } as unknown as Logger;
}

describe('webhook delivery leases', () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
  });

  it('keeps a safety margin beyond the maximum delivery timeout', () => {
    expect(webhookLeaseDurationMs(60_000)).toBe(120_000);
    expect(webhookLeaseDurationMs(10_000)).toBe(120_000);
  });

  it.each([
    { responseStatus: 200, expectedMessage: 'Ignored stale webhook delivery success' },
    { responseStatus: 500, expectedMessage: 'Ignored stale webhook delivery failure' },
  ])(
    'does not let a stale attempt overwrite a newer claim after HTTP $responseStatus',
    async ({ responseStatus, expectedMessage }) => {
      mocks.fetch.mockResolvedValue({ status: responseStatus, body: null });
      const capturedQueries: { sql: string; params: unknown[] }[] = [];
      const services = createStaleServices(capturedQueries);
      const logger = createLogger();
      const claimed = createClaimedDelivery();

      await deliverWebhook(services, claimed, logger);

      expect(capturedQueries).toHaveLength(1);
      expect(capturedQueries[0]?.sql).toContain('"webhook_deliveries"."status" =');
      expect(capturedQueries[0]?.sql).toContain('"webhook_deliveries"."attempt_count" =');
      expect(capturedQueries[0]?.sql).toContain('"webhook_deliveries"."lease_expires_at" =');
      expect(capturedQueries[0]?.params).toEqual([
        claimed.delivery.id,
        'processing',
        claimed.delivery.attemptCount,
        claimed.delivery.leaseExpiresAt?.toISOString(),
      ]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: claimed.delivery.id,
          attempt: claimed.delivery.attemptCount,
        }),
        expectedMessage,
      );
      expect(logger.info).not.toHaveBeenCalled();
    },
  );
});
