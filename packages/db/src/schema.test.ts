import { readFileSync } from 'node:fs';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  apiKeys,
  authNonces,
  chainEvents,
  merchants,
  paymentIntents,
  requestRateLimits,
  refundRequests,
  sessions,
} from './schema.js';

describe('security-sensitive database constraints', () => {
  it('stores digests instead of raw authentication credentials', () => {
    expect(getTableConfig(apiKeys).columns.map((column) => column.name)).toContain('key_hash');
    expect(getTableConfig(authNonces).columns.map((column) => column.name)).toContain('nonce_hash');
    const sessionColumns = getTableConfig(sessions).columns.map((column) => column.name);
    expect(sessionColumns).toContain('token_hash');
    expect(sessionColumns).toContain('csrf_hash');
  });

  it('has idempotency and canonical-chain uniqueness boundaries', () => {
    expect(
      getTableConfig(merchants).indexes.some(
        (index) => index.config.name === 'merchants_onchain_address_uq',
      ),
    ).toBe(true);
    expect(
      getTableConfig(paymentIntents).indexes.some(
        (index) => index.config.name === 'payment_intents_merchant_idempotency_uq',
      ),
    ).toBe(true);
    expect(
      getTableConfig(paymentIntents).indexes.some(
        (index) => index.config.name === 'payment_intents_merchant_payment_id_uq',
      ),
    ).toBe(true);
    expect(
      getTableConfig(refundRequests).indexes.some(
        (index) => index.config.name === 'refund_requests_payment_refund_id_uq',
      ),
    ).toBe(true);
    expect(
      getTableConfig(chainEvents).indexes.some(
        (index) => index.config.name === 'chain_events_log_uq',
      ),
    ).toBe(true);
  });

  it('keeps the checked-in migration aligned with critical schema columns', () => {
    const migration = readFileSync(
      new URL('../migrations/0000_initial.sql', import.meta.url),
      'utf8',
    );
    expect(migration.match(/"lease_expires_at"/g)).toHaveLength(1);
    expect(migration).toContain('CREATE UNIQUE INDEX "api_keys_merchant_idempotency_uq"');
    expect(migration).toContain('"expected_settlement_recipients" jsonb NOT NULL');
    expect(migration).toContain('"settlement_recipients" jsonb');
    expect(migration).toContain('"merchant_address" char(42) NOT NULL');
    expect(migration).toContain('CREATE UNIQUE INDEX "refund_requests_one_pending_per_payment_uq"');
    expect(migration).toContain(`WHERE "status" = 'requested'`);
    expect(getTableConfig(apiKeys).columns.map((column) => column.name)).toContain(
      'idempotency_key',
    );
    const identityMigration = readFileSync(
      new URL('../migrations/0001_stable_merchant_identity.sql', import.meta.url),
      'utf8',
    );
    expect(identityMigration).toContain('"onchain_merchant_address"');
    expect(identityMigration).toContain('"wallet_address"');
    const rateLimitMigration = readFileSync(
      new URL('../migrations/0002_distributed_rate_limits.sql', import.meta.url),
      'utf8',
    );
    expect(rateLimitMigration).toContain('CREATE UNLOGGED TABLE "request_rate_limits"');
    expect(getTableConfig(requestRateLimits).primaryKeys).toHaveLength(1);
  });
});
