---
id: design.poly-redeem-chain-authority
type: design
status: needs_implement
created: 2026-05-04
updated: 2026-05-04
tags: [poly, redeem, dashboard, lifecycle, read-model, observability]
implements: poly-redeem-data-incongruity-2026-05-04
---

# Poly Redeem — Chain Authority Alignment

## Outcome

Success is when **every "Redeem" button shown on the poly dashboard succeeds when clicked, and every row whose chain-policy decision is `losing_outcome / zero_balance / unresolved` is classified into the correct dashboard bucket without a separate manual click ever returning `no_redeemable_position`.** A user sees one consistent label, status, and action across `Open`, `Markets`, and `History`, and the manual-redeem 409 path always logs the condition + reason so future drift is debuggable in Loki.

## Problem (observed 2026-05-04 in production)

Production user clicks `Redeem` on rows the dashboard labels `redeemable`, and the manual-redeem route returns `409 not_redeemable / no_redeemable_position` or `losing_outcome` on rows with positive PnL. The dashboard also renders `Redeem` as the button label for rows whose `lifecycleState` disqualifies them from being redeemable, and the 409 path logs nothing useful (no `condition_id`, no `reason`).

Confirmed in Loki: `poly.wallet.positions.redeem` has 5 distinct user clicks at 22:26–22:32 UTC, each `status=409`, `durationMs<400ms`, and **no observability beyond `request received` / `request complete`**.

## Root cause: split-brain on "redeemable"

Two independent authorities decide whether a position is redeemable, and they disagree.

| Path                  | File                                                                | Source of truth                                                                     | Drives                                          |
| --------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------- |
| Read-model (display)  | `nodes/poly/app/src/features/wallet-analysis/server/current-position-read-model.ts:238-257` | DB-cached Polymarket Data-API `raw.redeemable` flag **OR** ledger `lifecycleState="winner"` | Dashboard `status="redeemable"` and Action button |
| Redeem route (action) | `nodes/poly/app/src/features/redeem/resolve-redeem-decision.ts`     | Live Data-API `/positions` + on-chain CTF `payoutNumerator/Denominator/balanceOf`   | What actually executes                          |

`raw.redeemable=true` from Polymarket Data API means **"market resolved AND you held shares at snapshot time"** — *not* "you have a winner." Loser shares are technically `redeemable` for $0 in CTF terms (`payoutNumerator=0`). The Polymarket UI shows a "Redeem" button on losing positions too; we mistook that signal for actionability.

This violates `docs/spec/poly-order-position-lifecycle.md` § Required Matrix, which states `lifecycle="winner"` is the **only** axis that produces a `Redeemable asset / Actionable redeem row` classification.

## Symptom map

1. **`Redeem` button → `no_redeemable_position`**: `raw.redeemable=true` in DB, but live `listUserPositions(funder)` returns `[]` for that condition (already-redeemed elsewhere, or wallet/funder mismatch via Safe-proxy, or Data-API delisted post-resolution).
2. **`losing_outcome` on positive PnL**: Polymarket flags both winner and loser sides as `redeemable=true` once resolved; on-chain `payoutNumerator=0` for the loser side. Positive PnL is stale Data-API mid-pricing on a resolved-loser side.
3. **Disabled `Redeem` button on non-redeemable rows**: `columns.tsx:467-471` falls through to `actionLabel("redeemable") = "Redeem"` when `isRedeemable=false` and `isCloseable=false`, leaving a disabled button labeled `Redeem` — visual lie.
4. **Held=0m on recovered rows**: `openedAt = last_observed_at` (sync time), not entry time.
5. **Zero observability on the 409 path**: route returns `{error:"not_redeemable", reason}` and logs only the request envelope.

## Approach

**Solution**: Make `lifecycleState` the **sole** redeemable authority — comply with the existing spec — and add one new pipeline trigger so observation-derived resolutions mirror to ledger lifecycle automatically.

**Reuses**:

- `resolveRedeemCandidatesForCondition()` (existing) — already runs `decideRedeem` policy (the route uses this)
- `decisionToEnqueueInput()` + `mirrorRedeemLifecycleToLedger()` (existing) — already correctly translate `RedeemDecision → poly_redeem_jobs` row + `position_lifecycle` mirror
- `RedeemSubscriber.handleConditionResolution()` (existing) — same handler pattern; we just add a fourth invocation path
- `wrapRouteHandlerWithLogging` (existing) — already gives `ctx.log`; route 409 path just needs to call it
- accent-color utility classes already present in homepage `Connect` button (`Button` variant) — reuse, no new design tokens

**Rejected alternatives**:

- **Live multicall on every dashboard read** (164 chain calls per page-load): correct but slow (~2-3s P95 added) and chatty against the public Polygon RPC. Rejected.
- **New `chain_redeem_*` columns on `poly_trader_current_positions`** (cache the chain decision per row): tempting, but we already have `poly_redeem_jobs` keyed by `(funder, condition_id)` carrying `lifecycle_state`. Adding a parallel cache column would be a third authority and re-introduce the split-brain we are killing. Rejected.
- **Sweep on `raw.redeemable` change** (enumerate all `raw.redeemable=true` rows in a cron tick and fire policy): violates `SWEEP_IS_NOT_AN_ARCHITECTURE` in `redeem-subscriber.ts`. Rejected. The accepted variant below is *event-driven on observation upsert*, not a sweep.

## Files

### Read-model: drop the `raw.redeemable` backdoor

- **Modify**: `nodes/poly/app/src/features/wallet-analysis/server/current-position-read-model.ts`
  - In `deriveCurrentPositionStatus()`, drop `|| input.redeemable` from line 253. Only `lifecycleState === "winner"` produces `status="redeemable"`. The function no longer needs the `redeemable` parameter.
  - When `lifecycleState === null` and the Data-API `raw.endDate` is in the past **and** `raw.redeemable === true`, classify as `status="resolving"` (visible, not actionable, no Redeem button) until the lifecycle write lands. This is the bridge state the spec already names but the code did not emit.
  - Add `firstObservedAt` to the row select; use it for `openedAt` and `heldMinutes` instead of `last_observed_at`.

### Schema: add first-observed timestamp (no migration of existing rows)

- **Modify**: `nodes/poly/packages/db-schema/src/<poly-trader-current-positions schema file>`
  - Add `first_observed_at TIMESTAMPTZ NOT NULL DEFAULT now()` column.
- **Create**: `nodes/poly/app/src/adapters/server/db/migrations/0040_poly_trader_current_positions_first_observed_at.sql`
  - `ALTER TABLE poly_trader_current_positions ADD COLUMN first_observed_at TIMESTAMPTZ NOT NULL DEFAULT now();`
  - Backfill existing rows with `first_observed_at = COALESCE(last_observed_at, now())` in same migration.
- **Modify**: `nodes/poly/app/src/features/wallet-analysis/server/trader-observation-service.ts` `persistObservedCurrentPositions()` — set `first_observed_at` only on `INSERT`, never on `UPDATE` (`ON CONFLICT (...) DO UPDATE SET ... -- exclude first_observed_at`).

### Observation → redeem pipeline trigger (the alignment piece)

- **Modify**: `nodes/poly/app/src/features/wallet-analysis/server/trader-observation-service.ts`
  - After `persistObservedCurrentPositions()` upserts a wallet's positions, collect each `(funder, conditionId)` whose **observation delta** is `raw.redeemable: false→true OR first-insert with raw.redeemable=true`, and which has no existing `poly_redeem_jobs` row for that pair.
  - Pass the resulting set to a new `notifyResolutionsObserved(conditionIds: string[])` method on `RedeemSubscriber`, which delegates to the existing `handleConditionResolution` path. This is event-driven on a real observation transition, not a Data-API enumerate-and-fire — it matches the catchup pattern (`redeem-catchup.ts`) where the source of "this condition resolved" is just a different cursor (Data-API observation instead of chain getLogs).
  - Update `redeem-subscriber.ts` `SWEEP_IS_NOT_AN_ARCHITECTURE` invariant note: clarify that *observation-of-resolved-flag transition* is allowed; *Data-API enumerate-and-fire on every tick* is still forbidden.

### UI: action button label + accent color

- **Modify**: `nodes/poly/app/src/app/(app)/_components/positions-table/columns.tsx`
  - In `PositionActionButton`, when `!isRedeemable && !isCloseable`, set label to `"Settled"` (status is closed) or hide button entirely (lifecycle is `redeem_pending` / `resolving`) — never fall through to `"Redeem"` for a disabled button.
  - When `isRedeemable && actionable && !busy`, swap the outline `<Button>` for the homepage Connect button styling: `variant="default"` with the same accent classes the homepage uses (find via grep on the connect button before implementing — single source of truth, no new tokens).

### Manual-redeem route: 409 observability

- **Modify**: `nodes/poly/app/src/app/api/v1/poly/wallet/positions/redeem/route.ts`
  - Before `return NextResponse.json({ error: "not_redeemable", reason }, { status: 409 })`, call `ctx.log.info({event:"poly.wallet.positions.redeem.not_redeemable", condition_id: conditionId, reason, candidates: candidates.map(c => ({outcomeIndex: c.outcomeIndex, kind: c.decision.kind, ...(c.decision.kind!=="redeem" ? {reason: c.decision.reason}: {})})), funder_address: pipeline.funderAddress, billing_account_id: account.id}, "manual redeem rejected")`.
  - Add the same structured log to the `pipeline_unavailable` and `wallet_adapter_unconfigured` 503 paths.

### Tests

- **Modify**: `nodes/poly/app/tests/component/features/wallet-analysis/current-position-read-model.test.ts` (or create unit if no component test exists)
  - Add cases: `lifecycle=null + raw.redeemable=true` → `status="resolving"`, **not** `redeemable`. `lifecycle="winner"` → `status="redeemable"`. `lifecycle="loser" + currentValue>0` → `status="closed"`.
- **Modify**: `nodes/poly/app/tests/contract/app/poly.wallet.positions.redeem.routes.test.ts` (or wherever the route is contract-tested)
  - Assert the new 409 log line shape (`event=poly.wallet.positions.redeem.not_redeemable`, `condition_id`, `reason`, `candidates`).
- **Create**: `nodes/poly/app/tests/component/features/redeem/notify-resolutions-observed.test.ts`
  - Drive `RedeemSubscriber.notifyResolutionsObserved([cid])` against in-memory ports; assert `mirrorRedeemLifecycleToLedger` is called with `lifecycle="winner" | "loser" | "redeemed"` matching `decideRedeem` decision.

### Spec update (out-of-date with task.5007)

- **Modify**: `docs/spec/poly-order-position-lifecycle.md`
  - Update § Dashboard Classification to reflect `poly_trader_current_positions` (current inventory) + `poly_copy_trade_fills` (history). The current text references `execution/route.ts reading all ledger statuses for live/history rows` which is no longer how current positions are read after the task.5007 reconciler shipped.
  - Document the new observation-driven trigger as a fourth lifecycle source under § Redeem State Machine.

## Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] **REDEEMABLE_AUTHORITY_IS_LIFECYCLE**: Read-model and UI never read `raw.redeemable` to decide if a row is `status="redeemable"`. Only `lifecycleState="winner"` produces redeemable. (spec: poly-order-position-lifecycle § Required Matrix)
- [ ] **DECIDE_REDEEM_IS_AUTHORITY**: `nodes/poly/packages/market-provider/src/policy/redeem.ts:decideRedeem` is the only function that decides whether a redeem job enqueues; no caller may inline a substitute. (spec: existing in `resolve-redeem-decision.ts`)
- [ ] **SWEEP_IS_NOT_AN_ARCHITECTURE**: `notifyResolutionsObserved` fires only on observation transition deltas, not on every tick of a population. Reviewer must verify the writer computes a delta from current vs prior `raw.redeemable`. (spec: existing in `redeem-subscriber.ts`)
- [ ] **REDEEM_409_IS_DEBUGGABLE**: every `not_redeemable` / `pipeline_unavailable` / `wallet_adapter_unconfigured` response from `/api/v1/poly/wallet/positions/redeem` emits a structured log line with `condition_id` and `reason`. No silent 409.
- [ ] **FIRST_OBSERVED_IS_IMMUTABLE**: `poly_trader_current_positions.first_observed_at` is set once on insert; subsequent upserts must not touch it. Reviewer must read the upsert SQL.
- [ ] **SIMPLE_SOLUTION**: Reuses `resolveRedeemCandidatesForCondition`, `decisionToEnqueueInput`, `mirrorRedeemLifecycleToLedger`, existing `RedeemSubscriber` handler. No new policy, no new state machine, no new authority column.
- [ ] **ARCHITECTURE_ALIGNMENT**: Brings the read-model into compliance with the existing `poly-order-position-lifecycle` spec; updates the spec where the task.5007 inventory shift left it stale.

## Validation

- **exercise**: On candidate-a, render the dashboard for the multi-tenant test wallet that has ≥1 row showing `Redeem` today. Click `Redeem` on each. Every click must either (a) succeed end-to-end (`tx_submitted` → `confirmed`), or (b) **never appear in the first place** because the row was reclassified as `Settled` / `Resolving` / `Closed`. Spot-check a previously-positive-PnL `losing_outcome` row: it must now show `Settled` with `currentValue=0`, no Redeem button.
- **observability**: Loki queries must show:
  1. `event="poly.ctf.redeem.policy_decision"` lines emitted from observation-triggered evaluations (new fourth source) for newly-resolved conditions, with the new `source="observation"` label.
  2. `event="poly.wallet.positions.redeem.not_redeemable"` lines (zero in the steady state — every previously-failing click is now either gone or succeeds; one or two during transition while ledger lifecycle catches up).
  3. `feature.poly_wallet_execution.complete` line shows `live_positions` count drops to the count of true-open + lifecycle=winner rows; `closed_positions` absorbs the previously-misclassified loser rows.

## Out of scope

- Replacing Polymarket Data API with on-chain or Gamma API as the inventory source (separate effort, `task.0426` resolves column).
- Changing the redeem worker / reaper flow.
- Adding multicall caching for `decideRedeem` chain reads.
- Moving `lifecycle` storage off `poly_copy_trade_fills`.

## Estimated PR size

~6-8 files modified, 1 new migration, 1 new test file, ~200-300 LOC delta. Single PR.
