---
id: task.0404
type: task
title: "Poly bet sizer v0 — `min_bet` SizingPolicy variant"
status: needs_implement
priority: 1
rank: 5
estimate: 2
summary: "Add a `{ kind: 'min_bet' }` variant to the existing `SizingPolicy` discriminated union. Use the market's `minUsdcNotional` as the bet size instead of the hardcoded `MIRROR_USDC = 1` constant. FCFS budget gating remains in `authorizeIntent` (CAPS_LIVE_IN_GRANT). No new port, no new schema, no UI."
outcome: "A user copy-trading multiple targets on a small grant cap places real min-bet orders on every market regardless of the market's specific minimum, instead of silently skipping markets with `minUsdcNotional > 1`. The `MIRROR_USDC` and `MIRROR_MAX_USDC_PER_TRADE` env-driven constants are gone; sizing is sourced from the market itself."
spec_refs:
  - poly-copy-trade-phase1
  - poly-multi-tenant-auth
assignees: [derekg1729]
credit:
project: proj.poly-bet-sizer
branch: feat/task-0404-poly-bet-sizer-v0
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-04-27
updated: 2026-04-27
labels: [poly, polymarket, copy-trading, sizing, policy]
external_refs:
  - nodes/poly/app/src/features/copy-trade/types.ts
  - nodes/poly/app/src/features/copy-trade/plan-mirror.ts
  - nodes/poly/app/src/bootstrap/jobs/copy-trade-mirror.job.ts
---

# task.0404 — Poly bet sizer v0

## Why this exists

`MIRROR_USDC = 1` is hardcoded at [`copy-trade-mirror.job.ts:56`](../../nodes/poly/app/src/bootstrap/jobs/copy-trade-mirror.job.ts) and is the only signal that decides bet size. Two failure modes today:

1. **Markets with `minUsdcNotional > MIRROR_MAX_USDC_PER_TRADE` silently skip.** The current `{ kind: "fixed" }` policy returns `below_market_min` when share-space math forces notional above `max_usdc_per_trade = 5`. Every fill on those markets is a no-op, even though the user's grant would allow it.
2. **Multi-target copy-trading is incoherent across markets.** A user copying 3 targets sees fills on cheap markets fire at $1 and fills on $10-min markets silently disappear. There's no single answer to "what is the user's min-bet on this market" — there's a constant `$1` that doesn't know about market floors.

v0 fixes both by sourcing the bet size from `minUsdcNotional` directly, via a new `SizingPolicy` variant. **FCFS** is the existing behaviour of `authorizeIntent` rejecting fills once `dailyUsdcCap` is consumed — we are not adding a budget allocator.

## Design

### Outcome

Every poly copy-trade order's `size_usdc` is the market's `minUsdcNotional` for tenants on the new `{ kind: "min_bet" }` policy. The `MIRROR_USDC` and `MIRROR_MAX_USDC_PER_TRADE` env-driven constants are deleted. FCFS gating is preserved by the existing grants layer.

### Approach

**Solution:** Add a new variant to the existing `SizingPolicy` discriminated union:

```ts
export const MinBetSizingPolicySchema = z.object({
  kind: z.literal("min_bet"),
});
export const SizingPolicySchema = z.discriminatedUnion("kind", [
  FixedSizingPolicySchema,
  MinBetSizingPolicySchema,
]);
```

Extend `applySizingPolicy` switch in `plan-mirror.ts` with a `case "min_bet"` that returns `minUsdcNotional` directly, or `{ ok: false, reason: "below_market_min" }` when `minUsdcNotional` is undefined (market constraints unknown — fail closed).

In bootstrap, swap the `{ kind: "fixed", mirror_usdc: 1, max_usdc_per_trade: 5 }` config for `{ kind: "min_bet" }`. Delete the `MIRROR_USDC` and `MIRROR_MAX_USDC_PER_TRADE` constants and their env reads.

**Reuses:**

- Existing `SizingPolicy` discriminated union — the seam already exists, the [`SIZING_POLICY_IS_DISCRIMINATED`](../../nodes/poly/app/src/features/copy-trade/types.ts) invariant explicitly directs new policies to be variants.
- Existing `applySizingPolicy` dispatcher — already does share-space math against `minUsdcNotional`.
- Existing `getMarketConstraints` adapter call — already wired into the mirror pipeline; surfaces `minUsdcNotional` per token.
- Existing `authorizeIntent` cap enforcement — handles FCFS naturally (per-order, daily, hourly caps on the grant row).

**Rejected:**

- **New `BetSizerPolicy` port (my own first draft).** Adding a port for a single pure-domain policy in one runtime violates Phase 3a — single runtime, no vendor SDK, pure domain logic stays in app code. It also would have re-implemented the existing `SizingPolicy` seam under a different name. Rejected as bespoke ceremony over reuse.
- **Move sizing to a shared package.** Same reason — only one runtime (poly app) consumes this. Promoting now is premature. The existing in-app discriminated union covers all known P1 policies (allocation %, sub-min handling) as additional variants.
- **Pass `grant.dailyRemainingUsdc` into the sizer for early-skip optimization.** Violates [`CAPS_LIVE_IN_GRANT`](../../nodes/poly/app/src/features/copy-trade/types.ts) — caps are enforced exclusively at `authorizeIntent`. The pure decision must not read cap state.
- **Delete the `fixed` variant.** Tempting but bad. Stack tests, fixtures, and dev/test configs use it. Keeping both variants is one extra `case` and zero migration risk.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] **CAPS_LIVE_IN_GRANT**: The `min_bet` variant must NOT read `poly_wallet_grants` state. Cap enforcement stays in `authorizeIntent`. (spec: poly-copy-trade-phase1, types.ts)
- [ ] **SIZING_POLICY_IS_DISCRIMINATED**: New policy is a variant on `SizingPolicy.kind`, not a flat field added to `MirrorTargetConfig`. (spec: types.ts)
- [ ] **PLAN_IS_PURE**: `applySizingPolicy("min_bet", ...)` is a pure function — no I/O, no env reads, same input → same output. (spec: plan-mirror.ts)
- [ ] **SHARE_SPACE_MATH**: `size_usdc / price >= minShares`. The `min_bet` branch must clamp to `max(minShares * price, minUsdcNotional)` if `minShares` exceeds the USDC floor. (spec: plan-mirror.ts, bug.0342)
- [ ] **MIRROR_REASON_BOUNDED**: New skip reason (if any) added to the bounded enum. v0 reuses `below_market_min`; no new reason needed. (spec: types.ts)
- [ ] **SIMPLE_SOLUTION**: One variant added; no new port, no new package, no new schema. (spec: architecture)
- [ ] **ARCHITECTURE_ALIGNMENT**: App-local pure-domain logic stays app-local per Phase 3a. (spec: packages-architecture)

### Files

- **Modify:** `nodes/poly/app/src/features/copy-trade/types.ts` — add `MinBetSizingPolicySchema`, extend `SizingPolicySchema` discriminated union.
- **Modify:** `nodes/poly/app/src/features/copy-trade/plan-mirror.ts` — extend `applySizingPolicy` switch with `case "min_bet"` (4–8 lines).
- **Modify:** `nodes/poly/app/src/bootstrap/jobs/copy-trade-mirror.job.ts` — swap config to `{ kind: "min_bet" }`; delete `MIRROR_USDC` + `MIRROR_MAX_USDC_PER_TRADE` constants and their env reads.
- **Modify:** existing tests under `nodes/poly/app/src/features/copy-trade/__tests__/` that build a sizing config — update to reference the new variant where appropriate (mostly leave existing `fixed` tests alone; add new `min_bet` cases).
- **Test (new cases in existing file):** unit fixtures for `applySizingPolicy({ kind: "min_bet" }, ...)`:
  - `minUsdcNotional` defined → returns that size
  - `minUsdcNotional` undefined → returns `below_market_min`
  - `minShares * price > minUsdcNotional` → returns `minShares * price` (share-floor clamp)

## Validation

### exercise

- **Local unit:** `pnpm test nodes/poly/app/src/features/copy-trade` — new fixture matrix passes.
- **Local stack:** `pnpm test:stack:dev nodes/poly/app/src/features/copy-trade` — existing mirror-pipeline suite passes; one new case asserts a $2-min market places at $2 instead of skipping.
- **Candidate-a:** with a configured target trading on a market where `minUsdcNotional > 1`, observe one real mirror tick that lands an order. The CLOB receipt's notional matches `minUsdcNotional`. Same target on a $1-min market continues to land at $1.

### observability

- Existing `poly.copy-trade.decide` Pino log line — extend with `sizing_kind` field (`"fixed"` | `"min_bet"`) and `size_usdc`. No new log line.
- Loki query at the deployed SHA: `{node="poly"} |= "poly.copy-trade.decide" | json | sizing_kind="min_bet"` returns my self-validation tick.

## Review Checklist

- [ ] **Work Item:** `task.0404` linked in PR body
- [ ] **Spec:** `CAPS_LIVE_IN_GRANT` + `SIZING_POLICY_IS_DISCRIMINATED` + `PLAN_IS_PURE` + `SHARE_SPACE_MATH` upheld
- [ ] **Tests:** unit fixture matrix for `min_bet` variant
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
