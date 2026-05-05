-- Spike for docs/design/poly-markets-aggregation-redesign.md §6.3 + §6.6.
-- Read-only. Run against candidate-a Postgres via the SSH-tunnelled psql per
-- docs/guides/poly-target-backfill.md.
--
--   ssh -i ~/.local/candidate-a-vm-key -f -N -L 55433:localhost:5432 \
--     root@$(cat ~/.local/candidate-a-vm-ip)
--   PGPASSWORD=$(grep POSTGRES_ROOT_PASSWORD ~/.env.canary | cut -d= -f2) \
--     psql postgresql://postgres:$PGPASSWORD@localhost:55433/cogni_poly \
--     -f docs/design/_spikes/poly-markets-aggregation-snapshot-density.sql
--
-- Paste the output back into §9 of the design brief.

\echo '== §6.3 snapshot density per (trader, condition) per hour, last 24h =='

WITH hourly_buckets AS (
  SELECT trader_wallet_id, condition_id,
         DATE_TRUNC('hour', captured_at) AS hour,
         COUNT(*) AS snapshots_in_hour
  FROM poly_trader_position_snapshots
  WHERE captured_at >= NOW() - INTERVAL '24 hours'
  GROUP BY trader_wallet_id, condition_id, DATE_TRUNC('hour', captured_at)
)
SELECT
  MIN(snapshots_in_hour)                                              AS min_per_hour,
  PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY snapshots_in_hour)     AS p25,
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY snapshots_in_hour)     AS p50,
  PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY snapshots_in_hour)     AS p75,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY snapshots_in_hour)     AS p99,
  MAX(snapshots_in_hour)                                              AS max_per_hour,
  COUNT(*) FILTER (WHERE snapshots_in_hour = 0)                       AS zero_buckets,
  COUNT(*)                                                            AS total_buckets
FROM hourly_buckets;

\echo '== §6.3 same shape, last 7d =='

WITH hourly_buckets AS (
  SELECT trader_wallet_id, condition_id,
         DATE_TRUNC('hour', captured_at) AS hour,
         COUNT(*) AS snapshots_in_hour
  FROM poly_trader_position_snapshots
  WHERE captured_at >= NOW() - INTERVAL '7 days'
  GROUP BY trader_wallet_id, condition_id, DATE_TRUNC('hour', captured_at)
)
SELECT
  MIN(snapshots_in_hour)                                              AS min_per_hour,
  PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY snapshots_in_hour)     AS p25,
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY snapshots_in_hour)     AS p50,
  PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY snapshots_in_hour)     AS p75,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY snapshots_in_hour)     AS p99,
  MAX(snapshots_in_hour)                                              AS max_per_hour,
  COUNT(*) FILTER (WHERE snapshots_in_hour = 0)                       AS zero_buckets,
  COUNT(*)                                                            AS total_buckets
FROM hourly_buckets;

\echo '== §6.6 fills-vs-snapshots backfill coverage per active (trader, condition) =='

SELECT
  w.id AS trader_wallet_id,
  w.wallet_address,
  (SELECT MIN(observed_at)  FROM poly_trader_fills              WHERE trader_wallet_id = w.id) AS earliest_fill,
  (SELECT MIN(captured_at)  FROM poly_trader_position_snapshots WHERE trader_wallet_id = w.id) AS earliest_snapshot,
  CASE
    WHEN (SELECT MIN(observed_at) FROM poly_trader_fills WHERE trader_wallet_id = w.id)
       < (SELECT MIN(captured_at) FROM poly_trader_position_snapshots WHERE trader_wallet_id = w.id)
    THEN 'BACKFILL_INCOMPLETE'
    ELSE 'OK'
  END AS coverage_status
FROM poly_trader_wallets w
WHERE EXISTS (
  SELECT 1 FROM poly_trader_current_positions
  WHERE trader_wallet_id = w.id AND active = true
)
ORDER BY earliest_fill;
