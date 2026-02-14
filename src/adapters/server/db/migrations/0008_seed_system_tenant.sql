-- Seed: system tenant bootstrap data (idempotent)
-- Per docs/spec/system-tenant.md: SYSTEM_TENANT_STARTUP_CHECK

-- Set RLS context to the system principal (transaction-local)
SELECT set_config('app.current_user_id', 'cogni_system_principal', true);
--> statement-breakpoint

-- Service principal (no wallet — app-level owner, not a user)
INSERT INTO "users" ("id", "wallet_address")
VALUES ('cogni_system_principal', NULL)
ON CONFLICT ("id") DO NOTHING;

-- System tenant billing account
INSERT INTO "billing_accounts" ("id", "owner_user_id", "is_system_tenant", "balance_credits", "created_at")
VALUES ('cogni_system', 'cogni_system_principal', true, 0, now())
ON CONFLICT ("id") DO NOTHING;

-- Default virtual key for system tenant (required by credit_ledger FK)
INSERT INTO "virtual_keys" ("billing_account_id", "label", "is_default", "active")
VALUES ('cogni_system', 'System Default', true, true)
ON CONFLICT DO NOTHING;
