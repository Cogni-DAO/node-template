CREATE TABLE "work_items" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"node" text DEFAULT 'shared' NOT NULL,
	"project_id" text,
	"parent_id" text,
	"priority" integer,
	"rank" integer,
	"estimate" integer,
	"summary" text,
	"outcome" text,
	"branch" text,
	"pr" text,
	"reviewer" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"blocked_by" text,
	"deploy_verified" boolean DEFAULT false NOT NULL,
	"claimed_by_run" text,
	"claimed_at" timestamp with time zone,
	"last_command" text,
	"assignees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"external_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"spec_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_work_items_type" ON "work_items" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_work_items_status" ON "work_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_work_items_node" ON "work_items" USING btree ("node");--> statement-breakpoint
CREATE INDEX "idx_work_items_project_id" ON "work_items" USING btree ("project_id");