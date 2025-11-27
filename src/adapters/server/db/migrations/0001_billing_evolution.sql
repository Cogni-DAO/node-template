-- Convert credits to BIGINT and set defaults at DB level
ALTER TABLE "billing_accounts" ALTER COLUMN "balance_credits" TYPE bigint;
ALTER TABLE "billing_accounts" ALTER COLUMN "balance_credits" SET DEFAULT 0;
ALTER TABLE "billing_accounts" ALTER COLUMN "balance_credits" SET NOT NULL;
UPDATE "billing_accounts" SET "balance_credits" = 0 WHERE "balance_credits" IS NULL;

ALTER TABLE "credit_ledger" ALTER COLUMN "amount" TYPE bigint;
ALTER TABLE "credit_ledger" ALTER COLUMN "amount" SET NOT NULL;

ALTER TABLE "credit_ledger" ALTER COLUMN "balance_after" TYPE bigint;
ALTER TABLE "credit_ledger" ALTER COLUMN "balance_after" SET DEFAULT 0;
ALTER TABLE "credit_ledger" ALTER COLUMN "balance_after" SET NOT NULL;
UPDATE "credit_ledger" SET "balance_after" = 0 WHERE "balance_after" IS NULL;

-- Create llm_usage table with credits-centric schema
CREATE TABLE IF NOT EXISTS "llm_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"billing_account_id" text NOT NULL,
	"virtual_key_id" uuid NOT NULL,
	"request_id" text,
	"model" text,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"provider_cost_usd" numeric NOT NULL,
	"provider_cost_credits" bigint NOT NULL,
	"user_price_credits" bigint NOT NULL,
	"markup_factor" numeric NOT NULL,
	"usage" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_billing_account_id_billing_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_virtual_key_id_virtual_keys_id_fk" FOREIGN KEY ("virtual_key_id") REFERENCES "public"."virtual_keys"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "llm_usage_billing_account_idx" ON "llm_usage" ("billing_account_id");
CREATE INDEX IF NOT EXISTS "llm_usage_virtual_key_idx" ON "llm_usage" ("virtual_key_id");
CREATE INDEX IF NOT EXISTS "llm_usage_request_idx" ON "llm_usage" ("request_id");
