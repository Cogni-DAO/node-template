---
id: bug.0436
type: bug
title: "Grafana can't answer 'what does the wallet/chain/DB actually look like right now' for poly tenants — every debug session needs raw RPC + kubectl"
status: needs_triage
priority: 2
rank: 8
estimate: 5
created: 2026-04-30
updated: 2026-04-30
summary: "During a candidate-a debug session for task.0429, every load-bearing question — 'how much USDC.e is on chain at the funder', 'what positions does data-api list for this user', 'how many poly_redeem_jobs are stuck' — required SSH + `psql` and direct `curl` to Polygon RPC + Polymarket data-API. Loki has the app logs, but the moment a question crosses into 'what's the actual state outside the app', the agent (and any oncall) is back to manual CLI. This is fine when one user has problems for an hour; it's a hard scaling block when N tenants need triage."
outcome: "An on-call agent can answer 'is funder X drained / does this user hold the winning side / are there stuck redeem jobs' from Grafana panels alone — without touching SSH, kubectl, RPC, or data-api manually. Two new datasources + one dashboard cover the gap: (1) Postgres datasource for read-only queries against the per-node DB (poly_redeem_jobs, poly_wallet_connections, poly_copy_trade_*), (2) periodic on-chain balance snapshots (USDC.e, pUSD, POL per known funder) ingested into Prometheus or Loki and graphable per tenant. The dashboard joins these with existing Loki app-log streams so a single time range answers app-state + chain-state + DB-state simultaneously."
assignees: []
spec_refs:
  - observability
  - poly-redeem-pipeline
project: proj.cicd-services-gitops
deploy_verified: false
labels: [observability, grafana, poly, debugging, scaling-blocker]
external_refs:
  - work/items/task.0429.poly-auto-wrap-usdce-to-pusd.md
  - https://github.com/Cogni-DAO/node-template/pull/1149
---

# bug.0436 — Grafana observability gap: chain-state + DB-state invisible

## Why this exists

PR #1149 / task.0429 candidate-a validation hit this wall repeatedly:

| Question                                          | What we used                  | Why Grafana failed                                                                          |
| ------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------- |
| "USDC.e at funder right now?"                     | `curl polygon-rpc.com`        | No on-chain datasource. App logs `usdc_e: 10.58` but that's `USDC.e + pUSD` (separate bug). |
| "Is poly_redeem_jobs row stuck?"                  | SSH → `psql` → SELECT         | No Postgres datasource. App logs an event _per_ row enqueue; aggregating 50+ rows over hours is hostile through Loki. |
| "Does this user hold the winner side on chain?"   | Polygon RPC `balanceOf` + `payoutNumerators` | Same as above — chain reads have no Grafana surface. |
| "What does Polymarket data-api show for them?"    | `curl data-api.polymarket.com` | Same — third-party data has no datasource. |
| "Why is `usdc_available` dropping over time?"     | Loki time-series of overview logs | Possible but awkward; needs `| json | unwrap usdc_available` and the route only logs on user request, not periodically. |

Net: every triage session for a money-related symptom requires the agent to construct a curl pipeline + an SSH + a psql query. Each is one-off. Each has to be re-discovered next time. Each leaks shape across debug sessions.

## Today's pain (concrete)

PR #1149 thread (2026-04-30, ~20:30 UTC) burned ~30 minutes resolving "Derek says he has $10 USDC.e but loop reads 0":

1. Read `wallet.balances` Loki line → `usdc_e: 10.58` ❌ wrong (sums USDC.e + pUSD; separate bug, fixed in PR #1149 cleanup)
2. Read `wallet.overview` Loki line → `usdc_available: 7.00` ❌ inconsistent with balances
3. SSH + curl Polygon RPC × 3 chains → confirmed on-chain USDC.e=0
4. Curl Polymarket data-api → confirmed 71 positions, 56 redeemable
5. Then sample on-chain `balanceOf` for individual position IDs to verify the data-api claim

A unified Grafana panel ("Tenant Wallet State") showing `[on-chain USDC.e | pUSD | POL] · [data-api position count: open / redeemable] · [DB redeem-job state] · [recent app-log events]` would have answered the entire investigation in one screen.

## Fix shape

Three layers, each independently shippable:

1. **Postgres datasource** (Grafana): point at the per-node Postgres in candidate-a / preview / prod (read-only role). Adds a `Variables` selector for `node` (poly/operator/resy) and `tenant_billing_account_id`. Trivial: Grafana Cloud supports Postgres directly.
2. **On-chain balance scraper**: a small cron (one per chain) that periodically reads `[USDC.e, pUSD, POL]` for every active funder in `poly_wallet_connections` and emits Prometheus gauges (`poly_funder_usdce_atomic{billing_account_id="..."}`). Cron lives in scheduler-worker; gauges scraped by the existing Alloy/Prometheus stack.
3. **Polymarket data-api ingest**: same pattern, pulling each funder's `positions` count + sum mtm into a gauge. Useful for the "are open positions decreasing as we close them" loop.

(2) and (3) are bounded-cardinality (only known funders → < 100 active series total). No PII is added; addresses are already in Loki labels.

## Validation

After landing: an oncall agent debugging "user X says auto-wrap not working" opens **one** Grafana dashboard, picks the tenant from a dropdown, and sees:

- Latest USDC.e + pUSD + POL on chain (per-30s scrape)
- Open / redeemable positions count from data-api
- Last 10 `poly_redeem_jobs` rows for this funder (state + lifecycle_state)
- Last 50 app log lines tagged with this `billing_account_id`

…on a single screen, with a single time range. No SSH, no curl.

## Out of scope

- A general-purpose "every external system has a Grafana datasource" effort. Stick to: per-node Postgres + Polygon chain reads + Polymarket data-api. Other nodes file their own bugs.
- Replacing Loki for app logs — Loki is still the right home for them.
- Real-time chain reads (block-level events) — periodic scrapes are sufficient for triage; tx-level investigation can stay manual via block explorer.

## Notes

- Filed during PR #1149 candidate-a validation. The investigation that triggered the filing also produced bug.0435 (redeem-worker burns losing positions) — both are downstream of "we couldn't see the truth fast enough."
- Related, but distinct: the agent observability story (Langfuse traces for AI calls) covers the LLM side. This bug is about money/chain/DB visibility.
