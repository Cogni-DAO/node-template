-- Append-only trigger for identity_events (APPEND_ONLY_EVENTS invariant).
-- Reuses ledger_reject_mutation() function from migration 0011.
-- Idempotent: safe to rerun.

DROP TRIGGER IF EXISTS identity_events_append_only ON "identity_events";--> statement-breakpoint
CREATE TRIGGER identity_events_append_only
  BEFORE UPDATE OR DELETE ON "identity_events"
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_mutation();--> statement-breakpoint

-- Backfill: create user_bindings rows for existing users with wallet_address.
-- Idempotent: ON CONFLICT skips already-bound wallets.
-- Only emits identity_events for actually-inserted bindings.
WITH inserted AS (
  INSERT INTO user_bindings (id, user_id, provider, external_id, created_at)
  SELECT
    gen_random_uuid()::text,
    u.id,
    'wallet',
    u.wallet_address,
    NOW()
  FROM users u
  WHERE u.wallet_address IS NOT NULL
  ON CONFLICT (provider, external_id) DO NOTHING
  RETURNING user_id, provider, external_id
)
INSERT INTO identity_events (id, user_id, event_type, payload, created_at)
SELECT
  gen_random_uuid()::text,
  i.user_id,
  'bind',
  jsonb_build_object('provider', i.provider, 'external_id', i.external_id, 'method', 'backfill:v0-migration'),
  NOW()
FROM inserted i;
