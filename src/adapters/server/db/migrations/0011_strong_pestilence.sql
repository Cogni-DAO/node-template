DROP INDEX "receipt_events_receipt_created_idx";--> statement-breakpoint
CREATE INDEX "receipt_events_receipt_created_idx" ON "receipt_events" USING btree ("receipt_id","created_at" DESC NULLS LAST);