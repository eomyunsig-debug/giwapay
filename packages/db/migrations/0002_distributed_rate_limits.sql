CREATE UNLOGGED TABLE "request_rate_limits" (
  "rate_key" char(64) NOT NULL,
  "window_start" bigint NOT NULL,
  "request_count" integer DEFAULT 1 NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "request_rate_limits_pk" PRIMARY KEY("rate_key","window_start"),
  CONSTRAINT "request_rate_limits_positive_count" CHECK ("request_count" > 0)
);
--> statement-breakpoint
CREATE INDEX "request_rate_limits_expiry_idx" ON "request_rate_limits" USING btree ("expires_at");
