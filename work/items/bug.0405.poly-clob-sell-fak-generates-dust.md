---
id: bug.0405
type: bug
title: "Polymarket BUY GTC partial-fills land below min_order_size — produces structurally unsellable dust"
status: needs_implement
priority: 1
rank: 5
estimate: 2
summary: "Mirror BUYs go to Polymarket CLOB as `OrderType.GTC` limit orders. The sizing policy (`applySizingPolicy`) correctly clamps the *intent* size up to the market floor, but GTC matches against whatever depth is at the inside ask *right now* and rests the remainder. The matched portion settles to our wallet *with no min_order_size check on the matched amount* — Polymarket only enforces the floor on order placement, not on partial-fill matched amounts. When depth is thin (most Polymarket markets outside the top ~50), the matched amount lands below `min_order_size`. The resting remainder either fails to fill (price moved) or auto-cancels (sub-min stub). Result: a position below the market floor on chain, neither sellable (preflight rejects sub-min) nor redeemable until market resolution. Today's two stranded positions on the user's tenant (`4.88` + `2.20` shares) are exactly this shape."
outcome: 'After this PR, every mirror BUY uses `OrderType.FOK` (Fill-Or-Kill) by default — atomic-or-nothing relative to the floor, enforced by the exchange. No partial fills, no sub-min settlements, no new dust on chain. Mirror divergence (FOK fails on thin books → no position taken) is acceptable: the *next* signal recovers, and divergence is recoverable while dust isn''t. The choice surfaces as a per-target `executionMode: "fok" | "gtc"` dial on `MirrorTargetConfig` (default `"fok"`) and is exposed in the policy control panel alongside the sizing policy. Existing dust is left to redeem at market resolution via task.0412 (free, automatic, winning-side only — losing-side is a write-off).'
spec_refs:
  - poly-copy-trade-phase1
  - poly-positions
assignees: [derekg1729]
project: proj.poly-copy-trading
branch: fix/poly-clob-sell-fak-dust
created: 2026-04-28
updated: 2026-04-28
deploy_verified: false
labels: [poly, polymarket, clob, buy, fok, gtc, dust, copy-trading, bet-sizer]
external_refs:
  - work/items/bug.0342.poly-clob-dynamic-min-order-size.md
  - work/items/task.0404.poly-bet-sizer-v0.md
  - work/items/task.0412.poly-redeem-multi-tenant-fanout.md
---

# bug.0405 — BUY GTC partial-fills below floor produce unsellable dust

> Surfaced 2026-04-28 during candidate-a validation of [task.0412](task.0412.poly-redeem-multi-tenant-fanout.md). Derek's tenant `0x9A9e…160A` held two stranded positions (`4.88` and `2.20` shares, both below `min_order_size = 5`) on open markets that the close button could not exit:
>
> ```
> PolymarketClobAdapter.sellPositionAtMarket: share balance below market floor (gotShares=4.88, minShares=5, tokenId=98988…)
> PolymarketClobAdapter.sellPositionAtMarket: share balance below market floor (gotShares=2.1978, minShares=5, tokenId=10816…)
> ```

## Root cause — the structural invariant we're missing

**A fill must never land below `min_order_size`.** Today, intent size respects the floor but execution doesn't.

`packages/market-provider/src/adapters/polymarket/polymarket.clob.adapter.ts:309` sends BUY orders as `OrderType.GTC`. GTC means: place a limit at price X, match against whatever ask-side depth exists at-or-below X right now, rest the remainder as a resting bid until it fills, expires, or is cancelled.

| Layer                                                        | Floor check?                                                                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `applySizingPolicy` (intent)                                 | ✅ Clamps `intent.size_usdc` up to `floor = max(minShares × price, minUsdcNotional)`. Correct.                                       |
| Polymarket CLOB on order placement                           | ✅ Rejects sub-min orders (returns `{}`; `bug.0342`'s symptom).                                                                      |
| **Polymarket CLOB on the matched portion of a partial fill** | ❌ **No floor enforcement.** Whatever the orderbook actually had at our price settles to us, even if that amount is below the floor. |

The third row is the bug. GTC turns a "5-share intent" into "whatever matched now + a sub-min resting stub." When the matched amount is below `min_order_size`, we hold dust the moment settlement clears. The resting remainder is also sub-min and either:

- **(a)** fails to fill because the inside ask moved up after our match
- **(b)** is auto-cancelled by Polymarket because it's a sub-min order
- **(c)** sits indefinitely if the market is dead

In all three cases, the matched-but-sub-min portion stays in our wallet permanently. SELL preflight then rejects every exit attempt (sub-min). Redemption only recovers it on market resolution, and only if we're on the winning side.

**Why depth pre-check doesn't fix this:** the orderbook moves between check and submit. TOCTOU. You can verify depth at moment N and still partial-fill at moment N+1. Don't bother.

## Fix — push the floor invariant into the execution primitive

**`OrderType.FOK` on BUY.** Atomic-or-nothing. The exchange itself enforces "fill the entire intent at the limit price, or fill nothing." No partial fills, no sub-min settlements, no new dust ever.

The trade-off is real but worth taking:

- **FOK fails on thin books** → mirror skips this signal → mirror diverges from target.
- **Divergence is recoverable.** The next observed fill from the target re-enters the pipeline. We trade "follow the target perfectly" for "never accumulate stranded dust," and the loss from the former is bounded by the next-signal latency.

The opposite (`gtc`) stays available for callers who explicitly want best-effort matching — paper mode, agent-driven trades, or operators who know the orderbook. It's not the default.

## Where the dial lives — slotting into task.0404 (bet sizer)

`MirrorTargetConfig.sizing` already carries the per-target sizing policy (`fixed | min_bet`). `executionMode` is **orthogonal to sizing** — it controls how the sized intent reaches CLOB, regardless of whether the size came from `fixed` or `min_bet`. So it's a sibling of `sizing` on `MirrorTargetConfig`, not nested inside the policy variants.

```ts
// nodes/poly/app/src/features/copy-trade/types.ts (sketch)
export const ExecutionModeSchema = z.enum(["fok", "gtc"]);
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

export const MirrorTargetConfigSchema = z.object({
  // ... existing fields ...
  sizing: SizingPolicySchema,
  /** How the sized intent is sent to CLOB. Default `"fok"` — atomic-or-nothing,
   *  prevents sub-floor partial fills (bug.0405). `"gtc"` allows resting limit
   *  orders that may partial-fill; only use when the caller is willing to
   *  accept dust risk in exchange for follow-rate guarantees. */
  executionMode: ExecutionModeSchema.default("fok"),
});
```

The dial is per-target, same scope as `sizing`. A user can have aggressive FOK on high-conviction targets and GTC on opportunistic ones, etc.

## Files to touch

**Contract / type — adds the dial:**

- `nodes/poly/app/src/features/copy-trade/types.ts`
  - Add `ExecutionModeSchema` (`"fok" | "gtc"`, default `"fok"`).
  - Add `executionMode` field to `MirrorTargetConfigSchema`.

**Pipeline — propagates the dial to the adapter:**

- `nodes/poly/app/src/features/copy-trade/plan-mirror.ts` — `buildIntent` carries `executionMode` into `OrderIntent.attributes` (or a typed sibling field) so the adapter can read it.
- `nodes/poly/app/src/features/copy-trade/mirror-pipeline.ts` — passes `config.executionMode` through.

**Adapter — selects FOK vs GTC at the CLOB call:**

- `packages/market-provider/src/adapters/polymarket/polymarket.clob.adapter.ts`
  - In `placeOrder` (line ~300), branch on the intent's `executionMode`:
    - `"fok"` → `OrderType.FOK`
    - `"gtc"` → `OrderType.GTC` (current behavior)
  - The existing intent-side `min_order_size` preflight stays — FOK still needs it because the exchange floor is checked at placement.
  - Map FOK rejections (`success=false`, "not enough depth"-style errors) to a typed reason `"fok_no_match"` distinct from real errors so the coordinator skips cleanly rather than retrying.

**Coordinator — handles the FOK skip case:**

- `nodes/poly/app/src/features/copy-trade/mirror-coordinator.ts` (or wherever placement results are processed)
  - When the receipt carries `status: "rejected"` with `reason: "fok_no_match"`, mark the fill row as `placement_failed` with reason `fok_no_match` and emit a `poly.mirror.skipped reason=fok_no_match` log. Don't retry — the next observed fill from the target is the recovery path.

**DB — persists the per-target dial:**

- `nodes/poly/app/src/adapters/server/db/schema/poly_copy_trade_targets.ts` (or wherever the targets table lives) — add `execution_mode` column with default `'fok'`.
- A new drizzle migration `nodes/poly/app/src/adapters/server/db/migrations/00XX_poly_copy_trade_execution_mode.sql`.

**API — exposes the dial:**

- `packages/node-contracts/src/poly.copy-trade-targets.v1.contract.ts` (or equivalent) — add `executionMode` to the create / update payload.
- `nodes/poly/app/src/app/api/v1/poly/copy-trade/targets/route.ts` and `[id]/route.ts` — accept and persist the field.

**UI — surfaces the dial in the policy control panel (REQUIRED — user-controllable):**

- `nodes/poly/app/src/components/kit/policy/PolicyControls.tsx` — add an "Execution mode" toggle next to the sizing policy controls. Default `FOK (safe)`; `GTC (best-effort, may strand dust)` as the alternative with a warning copy.
- `nodes/poly/app/src/app/(app)/.../...settings...` (target edit page; track down the actual location) — wire the new control through.

**Tests:**

- Unit: `tests/unit/features/copy-trade/plan-mirror.test.ts` — assert `executionMode` propagates from config to intent.
- Unit: `tests/unit/adapters/polymarket-clob-execution-mode.test.ts` — given an intent with `executionMode: "fok"`, the CLOB call uses `OrderType.FOK`. Same with `"gtc"`.
- Component: extend the existing CLOB component test with an FOK-no-match scenario; assert the coordinator marks the fill `placement_failed reason=fok_no_match`.

## Out of scope

- **Existing stranded dust cleanup.** Wait for market resolution; the redeem pipeline (PR #1106) recovers winning-side dust automatically. Losing-side is a write-off. No code path needed.
- **SELL execution mode dial.** SELL is a separate analysis — once we have FOK BUYs, no new dust is created, and existing positions can be sold whole at any time (they'll always be ≥ floor by construction). Revisit only if observation shows SELL-side dust generation outside the BUY-fill mechanism.
- **Depth pre-check.** TOCTOU; the exchange-side FOK invariant supersedes any client-side depth analysis.
- **Dashboard "stranded — awaiting resolution" affordance.** Real UX gap, but downstream of source fix. File as `task.NNNN.poly-dashboard-stranded-dust-affordance` after this lands.
- **bug.0329 (neg-risk SELL empty reject).** Different failure mode, different bug.

## Validation

**exercise:**

On candidate-a, with a tenant configured for `executionMode: "fok"` (the default after this lands):

1. Trigger a mirror BUY for a market with thin orderbook depth at the inside ask (e.g. via a target wallet that just opened a niche market).
2. Confirm Loki shows either:
   - Full match: `event="poly.clob.place" side="BUY" status="filled" filled_size_usdc≈intent.size_usdc`, OR
   - Skip: `event="poly.mirror.skipped" reason="fok_no_match"`
3. Confirm `GET /api/v1/poly/wallet/positions` for the tenant shows ONLY positions with `size ≥ min_order_size` for the market in question. No sub-min entries appear.
4. Toggle the same target to `executionMode: "gtc"` via the policy panel; observe a subsequent BUY uses GTC and may produce a sub-min position (expected; this is the explicit opt-in).

**observability:**

```logql
# Should trend to zero at the deployed SHA
{env="candidate-a",service="app"} | json
  | reason=~".*share balance below market floor.*"

# New skip reason from FOK no-match — appears on thin-book scenarios
{env="candidate-a",service="app"} | json
  | event="poly.mirror.skipped"
  | reason="fok_no_match"

# Existing successful BUY events should now ALL have filled_size_usdc within
# epsilon of intent.size_usdc — partial-fill log signature disappears
{env="candidate-a",service="app"} | json
  | event="poly.clob.place" | side="BUY" | phase="ok"
```
