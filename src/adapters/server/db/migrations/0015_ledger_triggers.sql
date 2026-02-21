-- Ledger immutability triggers (manual SQL — Drizzle cannot express triggers)
-- Idempotent: safe to rerun.
--
-- ACTIVITY_APPEND_ONLY:     reject UPDATE/DELETE on activity_events
-- POOL_IMMUTABLE:           reject UPDATE/DELETE on epoch_pool_components
-- CURATION_FREEZE_ON_CLOSE: reject INSERT/UPDATE/DELETE on activity_curation when epoch is closed

-- Shared reject-mutation function (recreated — 0013 depends on it)
CREATE OR REPLACE FUNCTION ledger_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% not allowed on %', TG_OP, TG_TABLE_NAME;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS activity_events_immutable ON "activity_events";--> statement-breakpoint
CREATE TRIGGER activity_events_immutable
  BEFORE UPDATE OR DELETE ON "activity_events"
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_mutation();--> statement-breakpoint

DROP TRIGGER IF EXISTS epoch_pool_components_immutable ON "epoch_pool_components";--> statement-breakpoint
CREATE TRIGGER epoch_pool_components_immutable
  BEFORE UPDATE OR DELETE ON "epoch_pool_components"
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_mutation();--> statement-breakpoint

-- Curation freeze: reject INSERT/UPDATE/DELETE when the referenced epoch is closed
CREATE OR REPLACE FUNCTION curation_freeze_on_close() RETURNS trigger AS $$
DECLARE
  epoch_status text;
BEGIN
  -- For DELETE, use OLD; for INSERT/UPDATE, use NEW
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO epoch_status FROM epochs WHERE id = OLD.epoch_id;
  ELSE
    SELECT status INTO epoch_status FROM epochs WHERE id = NEW.epoch_id;
  END IF;

  IF epoch_status = 'closed' THEN
    RAISE EXCEPTION 'Cannot % activity_curation: epoch % is closed', TG_OP, COALESCE(NEW.epoch_id::text, OLD.epoch_id::text);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS activity_curation_freeze ON "activity_curation";--> statement-breakpoint
CREATE TRIGGER activity_curation_freeze
  BEFORE INSERT OR UPDATE OR DELETE ON "activity_curation"
  FOR EACH ROW EXECUTE FUNCTION curation_freeze_on_close();
