ALTER TABLE "poly_copy_trade_targets"
  ADD COLUMN IF NOT EXISTS "mirror_filter_percentile" integer NOT NULL DEFAULT 75,
  ADD COLUMN IF NOT EXISTS "mirror_max_usdc_per_trade" numeric(10, 2) NOT NULL DEFAULT '5.00';--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'poly_copy_trade_targets_filter_percentile_range'
  ) THEN
    ALTER TABLE "poly_copy_trade_targets"
      ADD CONSTRAINT "poly_copy_trade_targets_filter_percentile_range"
      CHECK ("mirror_filter_percentile" >= 50 AND "mirror_filter_percentile" <= 99);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'poly_copy_trade_targets_max_bet_positive'
  ) THEN
    ALTER TABLE "poly_copy_trade_targets"
      ADD CONSTRAINT "poly_copy_trade_targets_max_bet_positive"
      CHECK ("mirror_max_usdc_per_trade" > 0);
  END IF;
END $$;
