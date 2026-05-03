---
id: design.poly-copy-target-performance-benchmark
type: design
status: review
created: 2026-05-03
updated: 2026-05-03
tags: [poly, copy-trading, benchmarks, sizing, rn1, swisstony]
implements: task.5005
---

# Poly Copy Target Performance Benchmark

## Design

### Outcome

Success is when the existing poly research UI can compare RN1/swisstony target style, VWAP, position outcomes, and PnL deltas against Cogni copied/skipped/resting/error responses, with active gap reason codes for target positions Cogni is not addressing.

### MVP Path

Ship task.5005 as a research UI extension, not a new dashboard and not another planner change.

The shortest useful path is:

1. Persist observed RN1/swisstony target activity and Cogni comparison-wallet snapshots into Postgres read-model tables.
2. Attribute each observed target fill or target position to Cogni's existing mirror decision/fill ledger.
3. Extend the existing wallet research detail pages at `/research/w/[addr]` with three panels:
   - benchmark summary;
   - per-market VWAP attribution;
   - active gaps.
4. Reuse PR #1137's order-flow distributions as the style context on those same wallet research pages.

PR #1137 only impacted specific wallet research pages and only populates the new distributions for RN1 and swisstony. That is fine for this MVP: task.5005 should start with those same two copy targets, then add Cogni comparison wallets as a separate selector or pinned comparison set.

### 24h Fast Path

The first implementation should make the last 24 hours useful before it tries to be a complete historical accounting system.

This is the easy path for "I made 200 trades yesterday; compare us against RN1/swisstony now":

1. Pull recent RN1/swisstony Data API trades with `takerOnly=false`, paginating until `timestamp < now - 24h`.
2. Pull current RN1/swisstony positions for the markets touched by those trades.
3. Pull Cogni `poly_copy_trade_decisions` and `poly_copy_trade_fills` from the same 24h window.
4. Group by `(target_wallet, condition_id, token_id)`.
5. Compute target 24h VWAP, Cogni 24h VWAP, target size, Cogni size, copy capture ratio, latest decision reason, and marked current value.
6. Render this as a `1D` benchmark mode on the RN1/swisstony research pages.

This fast path does not require:

- final market resolution;
- full lifetime wallet backfill;
- historical snapshots before the 24h window;
- a new streaming system.

It does require idempotent target-trade storage, because a 200-trade day will be fetched repeatedly while the operator refreshes the page.

### Current Evidence

Measured on 2026-05-03 against Polymarket public APIs.

#### Target Wallet PnL Curve Deltas

Source: `https://user-pnl-api.polymarket.com/user-pnl`.

| Wallet                                                 |  1d delta |  1w delta |    1m delta | Current PnL chart value |
| ------------------------------------------------------ | --------: | --------: | ----------: | ----------------------: |
| RN1 `0x2005d16a84ceefa912d4e380cd32e7ff827875ea`       | +$199,183 | +$539,049 | +$1,352,022 |              $8,152,673 |
| swisstony `0x204f72f35326db932158cba6adff0b9a1da95e14` | +$159,419 | +$796,718 | +$1,630,803 |              $7,322,721 |

These are chart-service PnL values. They are useful headline benchmarks but not sufficient for per-market copy-trade attribution.

#### Cogni Wallet PnL Curve Deltas

Known Cogni wallets from existing work items and handoffs:

| Wallet                                                              | 1d delta | 1w delta | 1m delta | Current PnL chart value | Notes                                               |
| ------------------------------------------------------------------- | -------: | -------: | -------: | ----------------------: | --------------------------------------------------- |
| prod funder `0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134`            |  +$38.98 |  +$10.37 |  +$24.88 |                  $18.73 | Small base; percentages are misleading around zero. |
| Derek candidate tenant `0x9A9e7276b3C4d6E7c9a866EB6FEB8CFaB82C160A` |   -$6.09 |  -$30.30 |  -$30.29 |                 -$30.59 | Candidate/test wallet from task.0318 validation.    |
| old shared operator `0x7A3347D25A69e735f6E3a793ecbdca08F97A0aEB`    |    $0.00 |   +$0.22 |  -$13.17 |                 -$13.42 | Legacy prototype wallet.                            |

#### Open-Position Scale

Source: Polymarket Data API `/positions?sizeThreshold=...`, capped at the first 500 rows by the endpoint query used here.

| Wallet                 | Open rows at threshold 0 | Cost basis in returned rows | Current value in returned rows |
| ---------------------- | -----------------------: | --------------------------: | -----------------------------: |
| RN1                    |                     500+ |               $1,293,335.96 |                    $579,940.84 |
| swisstony              |                     500+ |                 $260,886.95 |                    $266,878.97 |
| prod funder            |                      166 |                     $526.59 |                        $228.70 |
| Derek candidate tenant |                       89 |                     $148.72 |                         $11.84 |
| old shared operator    |                        3 |                       $5.47 |                          $4.41 |

The target wallets operate at a different scale. A research surface that only shows target style or only shows our ledger cannot answer whether Cogni is tracking the live target opportunity set.

### Existing Flow To Preserve

- `docs/design/poly-bet-sizer-v1.md` is the current as-built sizing spec.
- `docs/design/poly-mirror-position-projection.md` is the current as-built mirror-position/VWAP projection spec.
- PR #1137 / `task.0431` is the order-flow distributions foundation on wallet research pages. It explains target style, but it is not the copy-performance attribution store.
- `TOP_TARGET_SIZE_SNAPSHOTS` in `copy-trade-mirror.job.ts` hardcodes RN1 and swisstony p50/p75/p90/p95/p99 position cost-basis snapshots.
- Default copied target policy is p75 and `$5` max per trade.
- The pXX gate compares the target's current token-position cost basis, not the individual trigger order.
- `planMirrorFromFill()` remains pure. Target and mirror position context is supplied in `RuntimeState`.
- Our VWAP is derived from local intent rows in `poly_copy_trade_fills` through `OrderLedger.snapshotState()` and `aggregatePositionRows()`.
- Target position context is currently live Data API context only. Durable target activity persistence is the missing task.5005 read-model work.

### Approach

**Solution**: Add a Postgres operational read model for copy-target activity and derived attribution, then expose a small benchmark API slice consumed by the existing wallet research detail surface.

**Reuses**:

- Existing Polymarket Data API client and user-PnL fetch path from `features/wallet-analysis`.
- Existing `poly_copy_trade_fills` and `poly_copy_trade_decisions` as Cogni execution truth.
- Existing `MirrorPositionView` / `aggregatePositionRows()` as Cogni VWAP and position projection.
- Existing wallet research route and PR #1137 `DistributionsBlock` for target-style context.
- Existing Pino/Loki event flow for validation and candidate-a verification.

**Rejected**:

- Extra `trader_kind` column on `poly_copy_trade_fills`: target wallet activity is not a Cogni order lifecycle and does not have CLOB status, tenant intent, or client order IDs.
- Separate "copy target dashboard": duplicates the research surface and delays the core comparison.
- New planner or hedge-sizing policy in this task: #1187/#1188/#1199/#1203 already shipped target pXX sizing, mirror VWAP, layer follow-ups, and hedge follow-ups.
- Doltgres target activity storage: this is append-mostly operational telemetry, not curated knowledge.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] RESEARCH_UI_FIRST: Task.5005 extends `/research/w/[addr]`; it does not create a separate dashboard for the MVP.
- [ ] RN1_SWISSTONY_FIRST: The MVP target set is RN1 and swisstony, matching PR #1137's populated research surface.
- [ ] TWENTY_FOUR_HOUR_FAST_PATH: The MVP supports a `1D` benchmark from recent target trades, current target positions, and same-window Cogni decisions/fills before complete historical outcome accounting.
- [ ] DO_NOT_OVERLOAD_MIRROR_LEDGER: Target wallet fills and positions are not inserted into `poly_copy_trade_fills`.
- [ ] POSTGRES_OPERATIONAL_TRUTH: Target activity, position snapshots, and attribution live in poly Postgres tables, not Doltgres.
- [ ] CONTRACT_FIRST_HTTP: Any new research API response shape is defined in `nodes/poly/app/src/contracts/*.contract.ts` and routes parse input/output with Zod.
- [ ] PLANNER_STAYS_PURE: `planMirrorFromFill()` receives context; it does not read target attribution tables or perform I/O.
- [ ] EXISTING_EXECUTION_TRUTH: Cogni VWAP and response status derive from `poly_copy_trade_decisions`, `poly_copy_trade_fills`, and existing order-ledger projection helpers.
- [ ] BOUNDED_GAP_REASONS: Active-gap reasons are bounded enum values suitable for UI display and Loki labels.
- [ ] PAGINATED_TARGET_INGESTION: Data API ingestion handles paginated trades/positions and dedupes by native source identifiers.
- [ ] OBSERVABILITY_REQUIRED: Candidate validation must show target ingestion, mirror decision, and attribution write logs at the deployed SHA.
- [ ] SIMPLE_SOLUTION: Leverages existing wallet-analysis, copy-trade, and order-ledger patterns over bespoke analytics infrastructure.
- [ ] ARCHITECTURE_ALIGNMENT: Routes stay in `app/api`, UI in `features/wallet-analysis`, copy-trade policy in `features/copy-trade`, and schema in `@cogni/poly-db-schema`.

### Storage Design

Use Postgres read-model tables in `@cogni/poly-db-schema`; generate the migration under the poly app DB migrations directory.

| Table                            | Grain                                                       | Purpose                                                                                                                                                                                                                                           |
| -------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `poly_trader_wallets`            | one row per wallet address                                  | Canonical trader identity: `kind in ('copy_target','cogni_funder')`, label, source, active flag.                                                                                                                                                  |
| `poly_trader_fills`              | one normalized fill per trader                              | Data API or future WS/on-chain fills. Includes `trader_wallet_id`, `source`, `native_id`, `condition_id`, `token_id`, `side`, `price`, `shares`, `size_usdc`, `tx_hash`, `observed_at`, `raw`. Unique on `(trader_wallet_id, source, native_id)`. |
| `poly_trader_position_snapshots` | one row per trader/condition/token/snapshot                 | Position snapshots: shares, cost basis, current value, avg price, captured_at, raw. Powers the active-gaps panel.                                                                                                                                 |
| `poly_copy_trade_attribution`    | one row per target fill or target position x Cogni response | Joins target observation to our decision/fill response: `copied`, `partial`, `missed`, `resting`, `skipped`, `error`, `no_response_yet`. Carries bounded reason and Cogni VWAP fields when available.                                             |
| `poly_market_outcomes`           | one row per condition/token resolution                      | Final outcome, payout, close/resolution time. Needed for realized attribution.                                                                                                                                                                    |

This keeps joins explicit:

- `target fill -> attribution -> poly_copy_trade_decisions/poly_copy_trade_fills`
- `target position snapshot -> MirrorPositionView -> active gap reason`
- `target fill/position/outcome -> target VWAP/outcome`
- `Cogni fill/position/outcome -> Cogni VWAP/outcome`

### API And UI Requirements

The existing wallet research page should load one benchmark bundle for the viewed wallet. For RN1/swisstony, the bundle includes target metrics plus comparison against selected Cogni wallets. For non-target wallets, the bundle may return empty attribution while the existing wallet research surface still renders.

#### Benchmark Panel

Show RN1, swisstony, and selected Cogni comparison wallets over 1d, 1w, 1m:

- target PnL chart delta;
- Cogni PnL chart delta;
- target open cost basis and current value;
- Cogni open cost basis and current value;
- copy capture ratio: `cogni_size_usdc / target_size_usdc`;
- missed edge: target marked or realized PnL on markets where Cogni did not place;
- adverse copy: Cogni loss on markets where the target was flat or profitable.

The `1D` view is the fast path. It should label results as "marked" when the market has not resolved and should favor recent-trade completeness over perfect lifetime attribution.

#### Per-Market Attribution Table

One row per `(target_wallet, condition_id, token_id)`:

- target VWAP, shares, cost basis, current value, marked or realized PnL;
- Cogni VWAP, shares, cost basis, current value, marked or realized PnL;
- copy status: `copied`, `partial`, `missed`, `resting`, `skipped`, `error`;
- latest reason from `poly_copy_trade_decisions` or the generated active-gap classifier;
- policy branch: `new_entry`, `layer`, `hedge`, `sell_close`;
- current pXX threshold and target position cost basis;
- time since target first opened and last modified the position.

#### Active Gaps Table

A target position appears when:

- target has non-dust current exposure;
- Cogni has no matching active exposure or resting order; and
- the target position is above p50, or above p75 for the default actionable view.

Reason codes must be generated from state, not hand-written:

- `below_selected_pxx`
- `market_floor_above_user_max`
- `position_cap_reached`
- `already_resting`
- `target_hedge_ratio_below_min`
- `target_hedge_usdc_below_min`
- `mirror_position_too_small_for_followup`
- `no_wallet_grant`
- `wallet_not_trading_ready`
- `placement_error`
- `not_seen_by_ingestion`
- `no_response_yet`

### Live Decision Streaming vNext

For the later live stream in the research UI, split visibility from actionability:

- stream every target position or fill at or above p50 into the research UI;
- mark p75 and above as actionable by default;
- mark p90 and above as urgent review;
- only auto-consider hedge follow-ups when the as-built position-follow-up predicates pass:
  - target opposite-token cost basis >= `$5`;
  - target hedge ratio >= `0.02`;
  - our mirror exposure >= `max($5, market_floor * 5)`;
  - proposed hedge <= `25%` of our current mirror exposure;
  - cumulative market intent remains <= per-target `mirror_max_usdc_per_trade`.

Do not create a second hedge-size pXX gate. The selected pXX remains the conviction gate. Hedge-specific thresholds are risk controls for whether the opposite-token position is meaningful enough to mirror.

### Files

- Create: `nodes/poly/packages/db-schema/src/trader-activity.ts` — Drizzle schema for target/Cogni trader read-model tables.
- Modify: `nodes/poly/packages/db-schema/src/index.ts` and package exports — expose the new schema slice.
- Create: `nodes/poly/app/src/adapters/server/db/migrations/<next>_poly_trader_activity.sql` — generated migration for the new Postgres tables.
- Create: `nodes/poly/app/src/contracts/poly.copy-target-benchmark.v1.contract.ts` — Zod request/response contract for the research benchmark bundle.
- Create: `nodes/poly/app/src/features/wallet-analysis/server/copy-target-benchmark-service.ts` — server-side read model and aggregation service.
- Modify: `nodes/poly/app/src/app/api/v1/poly/wallets/[addr]/route.ts` or add a sibling benchmark route — attach the benchmark bundle without bypassing contracts.
- Modify: `nodes/poly/app/src/features/wallet-analysis/` components — render benchmark, attribution, and active-gap panels on `/research/w/[addr]`.
- Modify: `nodes/poly/app/src/bootstrap/jobs/copy-trade-mirror.job.ts` and/or the existing mirror pipeline wiring — upsert target observations and attribution records while preserving pure planner boundaries.
- Test: `nodes/poly/app/tests/unit/features/wallet-analysis/` — aggregation math, gap reason classification, and empty-bundle behavior.
- Test: `nodes/poly/app/tests/unit/features/copy-trade/` — attribution does not alter planner decisions.
- Test: `nodes/poly/app/tests/component/` or API contract tests — benchmark route parses and returns bounded shapes.

### Implementation Sequence

1. Schema and migration for trader wallets, observed fills, position snapshots, attribution, and market outcomes.
2. Backfill command/job for RN1, swisstony, prod funder, Derek candidate tenant, and old shared operator from Data API/user-PnL API.
3. Attribution write path from target observation and existing mirror decision/fill rows.
4. Benchmark API contract and service returning an empty-safe bundle for non-target wallets.
5. Research UI panels on `/research/w/[addr]`, reusing #1137 distributions for RN1/swisstony.
6. Candidate-a validation with one new observed target fill and Loki evidence.

### Validation

exercise: On candidate-a, backfill RN1, swisstony, and one Cogni funder, then let the mirror process at least one new target fill. Open `/research/w/0x2005d16a84ceefa912d4e380cd32e7ff827875ea` and `/research/w/0x204f72f35326db932158cba6adff0b9a1da95e14`; verify target headline deltas, Cogni deltas, PR #1137 order-flow distributions, per-market VWAP comparison, and active gap reason codes render for the exercised wallets.

observability: Query Loki for the deployed SHA and confirm ingestion logs `poly.copy_target.ingest` for RN1/swisstony, mirror logs `poly.mirror.decision` with `position_branch` fields, and attribution write logs `poly.copy_target.attribution` include the target fill id plus the Cogni decision id for the agent's own exercised fill.

## Design Review

### Scorecard

| Dimension              | Score   | Rationale                                                                                                                                |
| ---------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Simplicity             | PASS    | The MVP is three panels on the existing wallet research detail page and avoids a new dashboard or planner rewrite.                       |
| OSS-First              | PASS    | No bespoke charting or stream framework is required; the design reuses existing React/query/table patterns and upstream Polymarket APIs. |
| Architecture Alignment | PASS    | Schema, contracts, API route, feature service, and UI are placed in existing repo layers.                                                |
| Boundary Placement     | PASS    | Shared table definitions live in `@cogni/poly-db-schema`; runtime ingestion and UI stay in the app.                                      |
| Content Boundaries     | PASS    | This doc owns design and invariants; task.5005 owns execution status; #1137 remains linked as UI foundation.                             |
| Scope Discipline       | PASS    | The task is scoped to benchmark attribution and active gaps, not trading policy changes.                                                 |
| Risk Surface           | CONCERN | Data API pagination, rate limits, and 500+ open-position wallets require bounded ingestion and dedupe tests.                             |

### Review Concerns

1. Data API ingestion must be paginated and idempotent before this ships. RN1 and swisstony exceed 500 open rows, so a first-page-only implementation would make the active-gaps panel misleading.
2. PnL chart deltas from `user-pnl-api` should be labeled as upstream chart-service values until market outcome attribution is mature. They are useful headlines, not accounting truth.
3. If the benchmark route is added as a sibling route instead of a slice on `/api/v1/poly/wallets/[addr]`, the route contract still needs to live in `src/contracts` first.

### Verdict

APPROVE for implementation after preserving the pagination/idempotency concern as a test requirement.
