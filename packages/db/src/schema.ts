import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const merchantStatus = pgEnum('merchant_status', [
  'pending_registration',
  'active',
  'paused',
]);

export const paymentIntentStatus = pgEnum('payment_intent_status', [
  'created',
  'submitted',
  'succeeded',
  'partially_refunded',
  'refunded',
  'expired',
]);

export const refundStatus = pgEnum('refund_status', ['requested', 'submitted', 'succeeded']);

export type SettlementRecipientSnapshot = {
  address: `0x${string}`;
  basisPoints: number;
  amount: string;
};

export type SettlementRecipientTerms = {
  address: `0x${string}`;
  basisPoints: number;
};

export const webhookDeliveryStatus = pgEnum('webhook_delivery_status', [
  'pending',
  'processing',
  'retry',
  'succeeded',
  'dead_letter',
]);

export type MerchantSettings = {
  displayName: string;
  defaultSettlementToken?: `0x${string}`;
};

export type PaymentIntentTypedData = {
  domain: {
    name: 'GiwaPay';
    version: '1';
    chainId: number;
    verifyingContract: `0x${string}`;
  };
  primaryType: 'PaymentIntent';
  types: Record<string, readonly { name: string; type: string }[]>;
  message: Record<string, string | number>;
};

export type WebhookPayload = {
  id: string;
  type: string;
  createdAt: string;
  data: Record<string, unknown>;
};

export const merchants = pgTable(
  'merchants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminAddress: char('admin_address', { length: 42 }).notNull(),
    payoutAddress: char('payout_address', { length: 42 }).notNull(),
    delegatedSignerAddress: char('delegated_signer_address', { length: 42 }),
    refundOperatorAddress: char('refund_operator_address', { length: 42 }),
    status: merchantStatus('status').notNull().default('pending_registration'),
    onchainRegisteredAt: timestamp('onchain_registered_at', {
      withTimezone: true,
    }),
    settings: jsonb('settings').$type<MerchantSettings>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('merchants_admin_address_uq').on(table.adminAddress),
    check(
      'merchants_admin_address_lowercase',
      sql`${table.adminAddress} = lower(${table.adminAddress})`,
    ),
    check(
      'merchants_payout_address_lowercase',
      sql`${table.payoutAddress} = lower(${table.payoutAddress})`,
    ),
  ],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    prefix: varchar('prefix', { length: 24 }).notNull(),
    keyHash: char('key_hash', { length: 64 }).notNull(),
    scopes: jsonb('scopes')
      .$type<string[]>()
      .notNull()
      .default(sql`'["payment_intents:read","payment_intents:write"]'::jsonb`),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('api_keys_hash_uq').on(table.keyHash),
    uniqueIndex('api_keys_merchant_idempotency_uq').on(table.merchantId, table.idempotencyKey),
    index('api_keys_merchant_idx').on(table.merchantId),
  ],
);

export const authNonces = pgTable(
  'auth_nonces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nonceHash: char('nonce_hash', { length: 64 }).notNull(),
    walletAddress: char('wallet_address', { length: 42 }).notNull(),
    domain: varchar('domain', { length: 255 }).notNull(),
    uri: text('uri').notNull(),
    chainId: integer('chain_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('auth_nonces_hash_uq').on(table.nonceHash),
    index('auth_nonces_expiry_idx').on(table.expiresAt),
    check('auth_nonces_chain_positive', sql`${table.chainId} > 0`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    csrfHash: char('csrf_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sessions_token_hash_uq').on(table.tokenHash),
    index('sessions_merchant_idx').on(table.merchantId),
    index('sessions_expiry_idx').on(table.expiresAt),
  ],
);

export const paymentIntents = pgTable(
  'payment_intents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paymentId: char('payment_id', { length: 66 }).notNull(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'restrict' }),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
    description: varchar('description', { length: 500 }).notNull(),
    settlementToken: char('settlement_token', { length: 42 }).notNull(),
    settlementAmount: numeric('settlement_amount', {
      precision: 78,
      scale: 0,
    }).notNull(),
    splitId: char('split_id', { length: 66 }).notNull(),
    platformFee: numeric('platform_fee', { precision: 78, scale: 0 }).notNull(),
    validAfter: timestamp('valid_after', { withTimezone: true }).notNull(),
    payerRestriction: char('payer_restriction', { length: 42 }).notNull(),
    metadataHash: char('metadata_hash', { length: 66 }).notNull(),
    chainId: integer('chain_id').notNull(),
    routerAddress: char('router_address', { length: 42 }).notNull(),
    signerAddress: char('signer_address', { length: 42 }).notNull(),
    signature: text('signature').notNull(),
    typedData: jsonb('typed_data').$type<PaymentIntentTypedData>().notNull(),
    status: paymentIntentStatus('status').notNull().default('created'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    metadata: jsonb('metadata').$type<Record<string, string>>().notNull(),
    payerAddress: char('payer_address', { length: 42 }),
    inputToken: char('input_token', { length: 42 }),
    inputAmount: numeric('input_amount', { precision: 78, scale: 0 }),
    platformFeeAmount: numeric('platform_fee_amount', {
      precision: 78,
      scale: 0,
    }),
    paymentTransactionHash: char('payment_transaction_hash', { length: 66 }),
    paymentBlockNumber: bigint('payment_block_number', { mode: 'bigint' }),
    paymentBlockHash: char('payment_block_hash', { length: 66 }),
    paymentLogIndex: integer('payment_log_index'),
    chainVerifiedAt: timestamp('chain_verified_at', { withTimezone: true }),
    expectedSettlementRecipients: jsonb('expected_settlement_recipients')
      .$type<SettlementRecipientTerms[]>()
      .notNull(),
    settlementRecipients: jsonb('settlement_recipients').$type<SettlementRecipientSnapshot[]>(),
    refundedAmount: numeric('refunded_amount', {
      precision: 78,
      scale: 0,
    })
      .notNull()
      .default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('payment_intents_merchant_payment_id_uq').on(table.merchantId, table.paymentId),
    uniqueIndex('payment_intents_merchant_idempotency_uq').on(
      table.merchantId,
      table.idempotencyKey,
    ),
    index('payment_intents_merchant_created_idx').on(table.merchantId, table.createdAt),
    index('payment_intents_status_idx').on(table.status),
    index('payment_intents_expiry_idx').on(table.expiresAt),
    check('payment_intents_amount_positive', sql`${table.settlementAmount} > 0`),
    check('payment_intents_fee_nonnegative', sql`${table.platformFee} >= 0`),
  ],
);

export const refundRequests = pgTable(
  'refund_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    refundId: char('refund_id', { length: 66 }).notNull(),
    paymentIntentId: uuid('payment_intent_id')
      .notNull()
      .references(() => paymentIntents.id, { onDelete: 'restrict' }),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'restrict' }),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
    amount: numeric('amount', { precision: 78, scale: 0 }).notNull(),
    reason: varchar('reason', { length: 500 }),
    status: refundStatus('status').notNull().default('requested'),
    transactionHash: char('transaction_hash', { length: 66 }),
    blockNumber: bigint('block_number', { mode: 'bigint' }),
    blockHash: char('block_hash', { length: 66 }),
    logIndex: integer('log_index'),
    chainVerifiedAt: timestamp('chain_verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('refund_requests_payment_refund_id_uq').on(table.paymentIntentId, table.refundId),
    uniqueIndex('refund_requests_merchant_idempotency_uq').on(
      table.merchantId,
      table.idempotencyKey,
    ),
    uniqueIndex('refund_requests_one_pending_per_payment_uq')
      .on(table.paymentIntentId)
      .where(sql`${table.status} = 'requested'`),
    index('refund_requests_payment_idx').on(table.paymentIntentId),
    check('refund_requests_amount_positive', sql`${table.amount} > 0`),
  ],
);

export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    description: varchar('description', { length: 200 }),
    secretCiphertext: text('secret_ciphertext').notNull(),
    secretLastFour: char('secret_last_four', { length: 4 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('webhook_endpoints_merchant_url_uq').on(table.merchantId, table.url),
    index('webhook_endpoints_merchant_idx').on(table.merchantId),
  ],
);

export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    payload: jsonb('payload').$type<WebhookPayload>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('webhook_events_type_aggregate_idx').on(table.eventType, table.aggregateId),
    index('webhook_events_merchant_idx').on(table.merchantId),
  ],
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => webhookEvents.id, { onDelete: 'cascade' }),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    status: webhookDeliveryStatus('status').notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    responseStatus: integer('response_status'),
    responseBody: varchar('response_body', { length: 1000 }),
    lastError: varchar('last_error', { length: 1000 }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('webhook_deliveries_event_endpoint_uq').on(table.eventId, table.endpointId),
    index('webhook_deliveries_due_idx').on(table.status, table.nextAttemptAt),
  ],
);

export const chainCursors = pgTable(
  'chain_cursors',
  {
    chainId: integer('chain_id').notNull(),
    contractAddress: char('contract_address', { length: 42 }).notNull(),
    nextBlockNumber: bigint('next_block_number', { mode: 'bigint' }).notNull(),
    lastBlockHash: char('last_block_hash', { length: 66 }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.chainId, table.contractAddress],
      name: 'chain_cursors_pk',
    }),
  ],
);

export const chainBlocks = pgTable(
  'chain_blocks',
  {
    chainId: integer('chain_id').notNull(),
    blockNumber: bigint('block_number', { mode: 'bigint' }).notNull(),
    blockHash: char('block_hash', { length: 66 }).notNull(),
    parentHash: char('parent_hash', { length: 66 }).notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.chainId, table.blockNumber],
      name: 'chain_blocks_pk',
    }),
    uniqueIndex('chain_blocks_chain_hash_uq').on(table.chainId, table.blockHash),
  ],
);

export const chainEvents = pgTable(
  'chain_events',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    chainId: integer('chain_id').notNull(),
    contractAddress: char('contract_address', { length: 42 }).notNull(),
    transactionHash: char('transaction_hash', { length: 66 }).notNull(),
    logIndex: integer('log_index').notNull(),
    blockNumber: bigint('block_number', { mode: 'bigint' }).notNull(),
    blockHash: char('block_hash', { length: 66 }).notNull(),
    eventName: varchar('event_name', { length: 100 }).notNull(),
    merchantAddress: char('merchant_address', { length: 42 }).notNull(),
    aggregateId: char('aggregate_id', { length: 66 }).notNull(),
    payload: jsonb('payload').$type<Record<string, string>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('chain_events_log_uq').on(table.chainId, table.transactionHash, table.logIndex),
    index('chain_events_block_idx').on(table.chainId, table.blockNumber),
    index('chain_events_aggregate_idx').on(table.merchantAddress, table.aggregateId),
    check(
      'chain_events_merchant_address_lowercase',
      sql`${table.merchantAddress} = lower(${table.merchantAddress})`,
    ),
  ],
);

export type Merchant = typeof merchants.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type PaymentIntent = typeof paymentIntents.$inferSelect;
export type RefundRequest = typeof refundRequests.$inferSelect;
