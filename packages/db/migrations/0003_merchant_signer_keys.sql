CREATE TABLE "merchant_signer_keys" (
  "merchant_id" uuid PRIMARY KEY NOT NULL,
  "provider" varchar(32) NOT NULL,
  "key_id" varchar(2048) NOT NULL,
  "signer_address" char(42) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "merchant_signer_keys_provider_aws_kms" CHECK ("merchant_signer_keys"."provider" = 'aws-kms'),
  CONSTRAINT "merchant_signer_keys_key_id_not_blank" CHECK (length(btrim("merchant_signer_keys"."key_id")) > 0),
  CONSTRAINT "merchant_signer_keys_address_lowercase" CHECK ("merchant_signer_keys"."signer_address" = lower("merchant_signer_keys"."signer_address"))
);
--> statement-breakpoint
ALTER TABLE "merchant_signer_keys"
ADD CONSTRAINT "merchant_signer_keys_merchant_id_merchants_id_fk"
FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id")
ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_signer_keys_key_id_uq"
ON "merchant_signer_keys" USING btree ("key_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_signer_keys_signer_address_uq"
ON "merchant_signer_keys" USING btree ("signer_address");
