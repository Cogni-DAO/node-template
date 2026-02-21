CREATE TABLE "activity_curation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"epoch_id" bigint NOT NULL,
	"event_id" text NOT NULL,
	"user_id" text,
	"included" boolean DEFAULT true NOT NULL,
	"weight_override_milli" bigint,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_events" (
	"node_id" uuid NOT NULL,
	"id" text NOT NULL,
	"source" text NOT NULL,
	"event_type" text NOT NULL,
	"platform_user_id" text NOT NULL,
	"platform_login" text,
	"artifact_url" text,
	"metadata" jsonb,
	"payload_hash" text NOT NULL,
	"producer" text NOT NULL,
	"producer_version" text NOT NULL,
	"event_time" timestamp with time zone NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_events_node_id_id_pk" PRIMARY KEY("node_id","id")
);
--> statement-breakpoint
CREATE TABLE "epoch_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"epoch_id" bigint NOT NULL,
	"user_id" text NOT NULL,
	"proposed_units" bigint NOT NULL,
	"final_units" bigint,
	"override_reason" text,
	"activity_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_cursors" (
	"node_id" uuid NOT NULL,
	"source" text NOT NULL,
	"stream" text NOT NULL,
	"scope" text NOT NULL,
	"cursor_value" text NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "source_cursors_node_id_source_stream_scope_pk" PRIMARY KEY("node_id","source","stream","scope")
);
--> statement-breakpoint
CREATE TABLE "statement_signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"statement_id" uuid NOT NULL,
	"signer_wallet" text NOT NULL,
	"signature" text NOT NULL,
	"signed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ledger_issuers" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "receipt_events" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_receipts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "ledger_issuers" CASCADE;--> statement-breakpoint
DROP TABLE "receipt_events" CASCADE;--> statement-breakpoint
DROP TABLE "work_receipts" CASCADE;--> statement-breakpoint
ALTER TABLE "payout_statements" DROP CONSTRAINT "payout_statements_epoch_id_unique";--> statement-breakpoint
DROP INDEX "epochs_one_open_unique";--> statement-breakpoint
ALTER TABLE "epoch_pool_components" ADD COLUMN "node_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "epochs" ADD COLUMN "node_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "epochs" ADD COLUMN "period_start" timestamp with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "epochs" ADD COLUMN "period_end" timestamp with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "epochs" ADD COLUMN "weight_config" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_statements" ADD COLUMN "node_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_statements" ADD COLUMN "allocation_set_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_statements" ADD COLUMN "supersedes_statement_id" uuid;--> statement-breakpoint
ALTER TABLE "activity_curation" ADD CONSTRAINT "activity_curation_epoch_id_epochs_id_fk" FOREIGN KEY ("epoch_id") REFERENCES "public"."epochs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_curation" ADD CONSTRAINT "activity_curation_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epoch_allocations" ADD CONSTRAINT "epoch_allocations_epoch_id_epochs_id_fk" FOREIGN KEY ("epoch_id") REFERENCES "public"."epochs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epoch_allocations" ADD CONSTRAINT "epoch_allocations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_signatures" ADD CONSTRAINT "statement_signatures_statement_id_payout_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."payout_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_curation_epoch_event_unique" ON "activity_curation" USING btree ("epoch_id","event_id");--> statement-breakpoint
CREATE INDEX "activity_curation_epoch_idx" ON "activity_curation" USING btree ("epoch_id");--> statement-breakpoint
CREATE INDEX "activity_events_node_time_idx" ON "activity_events" USING btree ("node_id","event_time");--> statement-breakpoint
CREATE INDEX "activity_events_source_type_idx" ON "activity_events" USING btree ("source","event_type");--> statement-breakpoint
CREATE INDEX "activity_events_platform_user_idx" ON "activity_events" USING btree ("platform_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "epoch_allocations_epoch_user_unique" ON "epoch_allocations" USING btree ("epoch_id","user_id");--> statement-breakpoint
CREATE INDEX "epoch_allocations_epoch_idx" ON "epoch_allocations" USING btree ("epoch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "statement_signatures_statement_signer_unique" ON "statement_signatures" USING btree ("statement_id","signer_wallet");--> statement-breakpoint
ALTER TABLE "payout_statements" ADD CONSTRAINT "payout_statements_supersedes_statement_id_payout_statements_id_fk" FOREIGN KEY ("supersedes_statement_id") REFERENCES "public"."payout_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "epochs_window_unique" ON "epochs" USING btree ("node_id","period_start","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "epochs_one_open_per_node" ON "epochs" USING btree ("node_id","status") WHERE "epochs"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "payout_statements_node_epoch_unique" ON "payout_statements" USING btree ("node_id","epoch_id");--> statement-breakpoint
ALTER TABLE "epochs" DROP COLUMN "policy_repo";--> statement-breakpoint
ALTER TABLE "epochs" DROP COLUMN "policy_commit_sha";--> statement-breakpoint
ALTER TABLE "epochs" DROP COLUMN "policy_path";--> statement-breakpoint
ALTER TABLE "epochs" DROP COLUMN "policy_content_hash";--> statement-breakpoint
ALTER TABLE "payout_statements" DROP COLUMN "policy_content_hash";--> statement-breakpoint
ALTER TABLE "payout_statements" DROP COLUMN "receipt_set_hash";