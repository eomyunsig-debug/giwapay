ALTER TABLE "merchants" ADD COLUMN "onchain_merchant_address" char(42);
--> statement-breakpoint
UPDATE "merchants" SET "onchain_merchant_address" = "admin_address";
--> statement-breakpoint
ALTER TABLE "merchants" ALTER COLUMN "onchain_merchant_address" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_onchain_address_lowercase" CHECK ("merchants"."onchain_merchant_address" = lower("merchants"."onchain_merchant_address"));
--> statement-breakpoint
CREATE UNIQUE INDEX "merchants_onchain_address_uq" ON "merchants" USING btree ("onchain_merchant_address");
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "wallet_address" char(42);
--> statement-breakpoint
UPDATE "sessions"
SET "wallet_address" = "merchants"."admin_address"
FROM "merchants"
WHERE "sessions"."merchant_id" = "merchants"."id";
--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "wallet_address" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_wallet_address_lowercase" CHECK ("sessions"."wallet_address" = lower("sessions"."wallet_address"));
