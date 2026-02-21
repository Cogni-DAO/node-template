-- Ledger append-only invariants (manual SQL — Drizzle cannot express triggers)
-- Idempotent: safe to rerun.
--
-- RECEIPTS_IMMUTABLE: reject UPDATE/DELETE on work_receipts
-- EVENTS_APPEND_ONLY: reject UPDATE/DELETE on receipt_events
-- POOL_IMMUTABLE:     reject UPDATE/DELETE on epoch_pool_components

CREATE OR REPLACE FUNCTION ledger_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% not allowed on %', TG_OP, TG_TABLE_NAME;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS work_receipts_immutable ON "work_receipts";--> statement-breakpoint
CREATE TRIGGER work_receipts_immutable
  BEFORE UPDATE OR DELETE ON "work_receipts"
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_mutation();--> statement-breakpoint

DROP TRIGGER IF EXISTS receipt_events_append_only ON "receipt_events";--> statement-breakpoint
CREATE TRIGGER receipt_events_append_only
  BEFORE UPDATE OR DELETE ON "receipt_events"
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_mutation();--> statement-breakpoint

DROP TRIGGER IF EXISTS epoch_pool_components_immutable ON "epoch_pool_components";--> statement-breakpoint
CREATE TRIGGER epoch_pool_components_immutable
  BEFORE UPDATE OR DELETE ON "epoch_pool_components"
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_mutation();
