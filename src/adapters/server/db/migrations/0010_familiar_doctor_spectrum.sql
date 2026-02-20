CREATE TABLE "epoch_pool_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"epoch_id" bigint NOT NULL,
	"component_id" text NOT NULL,
	"algorithm_version" text NOT NULL,
	"inputs_json" jsonb NOT NULL,
	"amount_credits" bigint NOT NULL,
	"evidence_ref" text,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "epochs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"policy_repo" text NOT NULL,
	"policy_commit_sha" text NOT NULL,
	"policy_path" text NOT NULL,
	"policy_content_hash" text NOT NULL,
	"pool_total_credits" bigint,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "epochs_status_check" CHECK ("epochs"."status" IN ('open', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "ledger_issuers" (
	"address" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"can_issue" boolean DEFAULT false NOT NULL,
	"can_approve" boolean DEFAULT false NOT NULL,
	"can_close_epoch" boolean DEFAULT false NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"epoch_id" bigint NOT NULL,
	"policy_content_hash" text NOT NULL,
	"receipt_set_hash" text NOT NULL,
	"pool_total_credits" bigint NOT NULL,
	"payouts_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_statements_epoch_id_unique" UNIQUE("epoch_id")
);
--> statement-breakpoint
CREATE TABLE "receipt_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor_address" text NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipt_events_event_type_check" CHECK ("receipt_events"."event_type" IN ('proposed', 'approved', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "work_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"epoch_id" bigint NOT NULL,
	"user_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"artifact_ref" text NOT NULL,
	"role" text NOT NULL,
	"valuation_units" bigint NOT NULL,
	"rationale_ref" text,
	"issuer_address" text NOT NULL,
	"issuer_id" text NOT NULL,
	"signature" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_receipts_role_check" CHECK ("work_receipts"."role" IN ('author', 'reviewer', 'approver'))
);
--> statement-breakpoint
ALTER TABLE "epoch_pool_components" ADD CONSTRAINT "epoch_pool_components_epoch_id_epochs_id_fk" FOREIGN KEY ("epoch_id") REFERENCES "public"."epochs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_issuers" ADD CONSTRAINT "ledger_issuers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_statements" ADD CONSTRAINT "payout_statements_epoch_id_epochs_id_fk" FOREIGN KEY ("epoch_id") REFERENCES "public"."epochs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_events" ADD CONSTRAINT "receipt_events_receipt_id_work_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."work_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_events" ADD CONSTRAINT "receipt_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_receipts" ADD CONSTRAINT "work_receipts_epoch_id_epochs_id_fk" FOREIGN KEY ("epoch_id") REFERENCES "public"."epochs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_receipts" ADD CONSTRAINT "work_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_receipts" ADD CONSTRAINT "work_receipts_issuer_id_users_id_fk" FOREIGN KEY ("issuer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "epoch_pool_components_epoch_component_unique" ON "epoch_pool_components" USING btree ("epoch_id","component_id");--> statement-breakpoint
CREATE UNIQUE INDEX "epochs_one_open_unique" ON "epochs" USING btree ("status") WHERE "epochs"."status" = 'open';--> statement-breakpoint
CREATE INDEX "receipt_events_receipt_created_idx" ON "receipt_events" USING btree ("receipt_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "work_receipts_idempotency_key_unique" ON "work_receipts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "work_receipts_epoch_id_idx" ON "work_receipts" USING btree ("epoch_id");--> statement-breakpoint

-- Append-only triggers: RECEIPTS_IMMUTABLE
CREATE OR REPLACE FUNCTION ledger_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Mutations are not allowed on %', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER work_receipts_immutable
  BEFORE UPDATE OR DELETE ON "work_receipts"
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_mutation();--> statement-breakpoint

-- Append-only triggers: EVENTS_APPEND_ONLY
CREATE TRIGGER receipt_events_append_only
  BEFORE UPDATE OR DELETE ON "receipt_events"
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_mutation();--> statement-breakpoint

-- Append-only triggers: POOL_IMMUTABLE
CREATE TRIGGER epoch_pool_components_immutable
  BEFORE UPDATE OR DELETE ON "epoch_pool_components"
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_mutation();