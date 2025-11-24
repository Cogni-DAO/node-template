CREATE INDEX IF NOT EXISTS "credit_ledger_reference_reason_idx"
  ON "credit_ledger" ("reference", "reason");
