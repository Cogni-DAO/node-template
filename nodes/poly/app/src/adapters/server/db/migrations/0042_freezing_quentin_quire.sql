-- task.5012: Move trader PnL history off live Polymarket /user-pnl onto a saved DB read model.
-- New observation table: time-series user-pnl points written by the trader-observation tick,
-- read by getPnlSlice for page-load. Two fidelities ('1h','1d') cover all UI windows from one
-- stored series; reader picks the densest fidelity covering the requested window.

CREATE TABLE IF NOT EXISTS "poly_trader_user_pnl_points" (
	"trader_wallet_id" uuid NOT NULL,
	"fidelity" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"pnl_usdc" numeric(20, 8) NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poly_trader_user_pnl_points_trader_wallet_id_fidelity_ts_pk"
		PRIMARY KEY("trader_wallet_id","fidelity","ts"),
	CONSTRAINT "poly_trader_user_pnl_points_fidelity_check"
		CHECK ("poly_trader_user_pnl_points"."fidelity" IN ('1h','1d'))
);
--> statement-breakpoint

ALTER TABLE "poly_trader_user_pnl_points"
	ADD CONSTRAINT "poly_trader_user_pnl_points_trader_wallet_id_poly_trader_wallets_id_fk"
	FOREIGN KEY ("trader_wallet_id")
	REFERENCES "public"."poly_trader_wallets"("id")
	ON DELETE cascade
	ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "poly_trader_user_pnl_points_read_idx"
	ON "poly_trader_user_pnl_points"
	USING btree ("trader_wallet_id","fidelity","ts");
