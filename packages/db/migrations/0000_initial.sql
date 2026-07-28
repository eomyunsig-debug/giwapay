CREATE TYPE "public"."merchant_status" AS ENUM('pending_registration', 'active', 'paused');
--> statement-breakpoint
CREATE TYPE "public"."payment_intent_status" AS ENUM('created', 'submitted', 'succeeded', 'partially_refunded', 'refunded', 'expired');
--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('requested', 'submitted', 'succeeded');
--> statement-breakpoint
CREATE TYPE "public"."webhook_delivery_status" AS ENUM('pending', 'processing', 'retry', 'succeeded', 'dead_letter');
--> statement-breakpoint
CREATE TABLE "merchants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "admin_address" char(42) NOT NULL,
  "payout_address" char(42) NOT NULL,
  "delegated_signer_address" char(42),
  "refund_operator_address" char(42),
  "status" "merchant_status" DEFAULT 'pending_registration' NOT NULL,
  "onchain_registered_at" timestamp with time zone,
  "settings" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "merchants_admin_address_lowercase" CHECK ("merchants"."admin_address" = lower("merchants"."admin_address")),
  CONSTRAINT "merchants_payout_address_lowercase" CHECK ("merchants"."payout_address" = lower("merchants"."payout_address"))
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "merchant_id" uuid NOT NULL,
  "idempotency_key" varchar(255) NOT NULL,
  "name" varchar(100) NOT NULL,
  "prefix" varchar(24) NOT NULL,
  "key_hash" char(64) NOT NULL,
  "scopes" jsonb DEFAULT '["payment_intents:read","payment_intents:write"]'::jsonb NOT NULL,
  "expires_at" timestamp with time zone,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_nonces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "nonce_hash" char(64) NOT NULL,
  "wallet_address" char(42) NOT NULL,
  "domain" varchar(255) NOT NULL,
  "uri" text NOT NULL,
  "chain_id" integer NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "auth_nonces_chain_positive" CHECK ("auth_nonces"."chain_id" > 0)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "merchant_id" uuid NOT NULL,
  "token_hash" char(64) NOT NULL,
  "csrf_hash" char(64) NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "payment_id" char(66) NOT NULL,
  "merchant_id" uuid NOT NULL,
  "idempotency_key" varchar(255) NOT NULL,
  "description" varchar(500) NOT NULL,
  "settlement_token" char(42) NOT NULL,
  "settlement_amount" numeric(78, 0) NOT NULL,
  "split_id" char(66) NOT NULL,
  "platform_fee" numeric(78, 0) NOT NULL,
  "valid_after" timestamp with time zone NOT NULL,
  "payer_restriction" char(42) NOT NULL,
  "metadata_hash" char(66) NOT NULL,
  "chain_id" integer NOT NULL,
  "router_address" char(42) NOT NULL,
  "signer_address" char(42) NOT NULL,
  "signature" text NOT NULL,
  "typed_data" jsonb NOT NULL,
  "status" "payment_intent_status" DEFAULT 'created' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "metadata" jsonb NOT NULL,
  "payer_address" char(42),
  "input_token" char(42),
  "input_amount" numeric(78, 0),
  "platform_fee_amount" numeric(78, 0),
  "payment_transaction_hash" char(66),
  "payment_block_number" bigint,
  "payment_block_hash" char(66),
  "payment_log_index" integer,
  "chain_verified_at" timestamp with time zone,
  "expected_settlement_recipients" jsonb NOT NULL,
  "settlement_recipients" jsonb,
  "refunded_amount" numeric(78, 0) DEFAULT '0' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payment_intents_amount_positive" CHECK ("payment_intents"."settlement_amount" > 0),
  CONSTRAINT "payment_intents_fee_nonnegative" CHECK ("payment_intents"."platform_fee" >= 0)
);
--> statement-breakpoint
CREATE TABLE "refund_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "refund_id" char(66) NOT NULL,
  "payment_intent_id" uuid NOT NULL,
  "merchant_id" uuid NOT NULL,
  "idempotency_key" varchar(255) NOT NULL,
  "amount" numeric(78, 0) NOT NULL,
  "reason" varchar(500),
  "status" "refund_status" DEFAULT 'requested' NOT NULL,
  "transaction_hash" char(66),
  "block_number" bigint,
  "block_hash" char(66),
  "log_index" integer,
  "chain_verified_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "refund_requests_amount_positive" CHECK ("refund_requests"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "merchant_id" uuid NOT NULL,
  "url" text NOT NULL,
  "description" varchar(200),
  "secret_ciphertext" text NOT NULL,
  "secret_last_four" char(4) NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "merchant_id" uuid NOT NULL,
  "event_type" varchar(100) NOT NULL,
  "aggregate_id" uuid NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL,
  "endpoint_id" uuid NOT NULL,
  "status" "webhook_delivery_status" DEFAULT 'pending' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "lease_expires_at" timestamp with time zone,
  "response_status" integer,
  "response_body" varchar(1000),
  "last_error" varchar(1000),
  "delivered_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chain_cursors" (
  "chain_id" integer NOT NULL,
  "contract_address" char(42) NOT NULL,
  "next_block_number" bigint NOT NULL,
  "last_block_hash" char(66),
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chain_cursors_pk" PRIMARY KEY("chain_id","contract_address")
);
--> statement-breakpoint
CREATE TABLE "chain_blocks" (
  "chain_id" integer NOT NULL,
  "block_number" bigint NOT NULL,
  "block_hash" char(66) NOT NULL,
  "parent_hash" char(66) NOT NULL,
  "processed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chain_blocks_pk" PRIMARY KEY("chain_id","block_number")
);
--> statement-breakpoint
CREATE TABLE "chain_events" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "chain_id" integer NOT NULL,
  "contract_address" char(42) NOT NULL,
  "transaction_hash" char(66) NOT NULL,
  "log_index" integer NOT NULL,
  "block_number" bigint NOT NULL,
  "block_hash" char(66) NOT NULL,
  "event_name" varchar(100) NOT NULL,
  "merchant_address" char(42) NOT NULL,
  "aggregate_id" char(66) NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chain_events_merchant_address_lowercase" CHECK ("chain_events"."merchant_address" = lower("chain_events"."merchant_address"))
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_payment_intent_id_payment_intents_id_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_event_id_webhook_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."webhook_events"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;
CREATE UNIQUE INDEX "merchants_admin_address_uq" ON "merchants" USING btree ("admin_address");
CREATE UNIQUE INDEX "api_keys_hash_uq" ON "api_keys" USING btree ("key_hash");
CREATE UNIQUE INDEX "api_keys_merchant_idempotency_uq" ON "api_keys" USING btree ("merchant_id","idempotency_key");
CREATE INDEX "api_keys_merchant_idx" ON "api_keys" USING btree ("merchant_id");
CREATE UNIQUE INDEX "auth_nonces_hash_uq" ON "auth_nonces" USING btree ("nonce_hash");
CREATE INDEX "auth_nonces_expiry_idx" ON "auth_nonces" USING btree ("expires_at");
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");
CREATE INDEX "sessions_merchant_idx" ON "sessions" USING btree ("merchant_id");
CREATE INDEX "sessions_expiry_idx" ON "sessions" USING btree ("expires_at");
CREATE UNIQUE INDEX "payment_intents_merchant_payment_id_uq" ON "payment_intents" USING btree ("merchant_id","payment_id");
CREATE UNIQUE INDEX "payment_intents_merchant_idempotency_uq" ON "payment_intents" USING btree ("merchant_id","idempotency_key");
CREATE INDEX "payment_intents_merchant_created_idx" ON "payment_intents" USING btree ("merchant_id","created_at");
CREATE INDEX "payment_intents_status_idx" ON "payment_intents" USING btree ("status");
CREATE INDEX "payment_intents_expiry_idx" ON "payment_intents" USING btree ("expires_at");
CREATE UNIQUE INDEX "refund_requests_payment_refund_id_uq" ON "refund_requests" USING btree ("payment_intent_id","refund_id");
CREATE UNIQUE INDEX "refund_requests_merchant_idempotency_uq" ON "refund_requests" USING btree ("merchant_id","idempotency_key");
CREATE UNIQUE INDEX "refund_requests_one_pending_per_payment_uq" ON "refund_requests" USING btree ("payment_intent_id") WHERE "status" = 'requested';
CREATE INDEX "refund_requests_payment_idx" ON "refund_requests" USING btree ("payment_intent_id");
CREATE UNIQUE INDEX "webhook_endpoints_merchant_url_uq" ON "webhook_endpoints" USING btree ("merchant_id","url");
CREATE INDEX "webhook_endpoints_merchant_idx" ON "webhook_endpoints" USING btree ("merchant_id");
CREATE INDEX "webhook_events_type_aggregate_idx" ON "webhook_events" USING btree ("event_type","aggregate_id");
CREATE INDEX "webhook_events_merchant_idx" ON "webhook_events" USING btree ("merchant_id");
CREATE UNIQUE INDEX "webhook_deliveries_event_endpoint_uq" ON "webhook_deliveries" USING btree ("event_id","endpoint_id");
CREATE INDEX "webhook_deliveries_due_idx" ON "webhook_deliveries" USING btree ("status","next_attempt_at");
CREATE UNIQUE INDEX "chain_blocks_chain_hash_uq" ON "chain_blocks" USING btree ("chain_id","block_hash");
CREATE UNIQUE INDEX "chain_events_log_uq" ON "chain_events" USING btree ("chain_id","transaction_hash","log_index");
CREATE INDEX "chain_events_block_idx" ON "chain_events" USING btree ("chain_id","block_number");
CREATE INDEX "chain_events_aggregate_idx" ON "chain_events" USING btree ("merchant_address","aggregate_id");
