CREATE TABLE "identity_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_events_event_type_check" CHECK ("identity_events"."event_type" IN ('bind', 'revoke', 'merge'))
);
--> statement-breakpoint
CREATE TABLE "user_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_bindings_provider_check" CHECK ("user_bindings"."provider" IN ('wallet', 'discord', 'github'))
);
--> statement-breakpoint
ALTER TABLE "identity_events" ADD CONSTRAINT "identity_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_bindings" ADD CONSTRAINT "user_bindings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "identity_events_user_id_idx" ON "identity_events" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_bindings_provider_external_id_unique" ON "user_bindings" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "user_bindings_user_id_idx" ON "user_bindings" USING btree ("user_id");