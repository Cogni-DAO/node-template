---
id: bug.0435
type: bug
title: "Poly redeem-worker never burns resolved-losing positions, leaving them on /money UI as 'open' forever"
status: needs_triage
priority: 2
rank: 7
estimate: 3
created: 2026-04-30
updated: 2026-04-30
summary: "Today the redeem-worker only claims rows whose lifecycle_state='winner' AND status='pending'. Resolved positions where the user holds the LOSING side are written by `decisionToEnqueueInput` as `status='skipped'/lifecycle_state='loser'` and never picked up. Polymarket's `redeemPositions` works for losing tokens too — it returns 0 payout but burns the ERC-1155 shares so the position drops off the data-API. Without that burn step, /money UI keeps showing 50+ resolved-but-unburned positions as still-open forever, and the user has no way to clean them up because the wallet is Privy-custodied (can't redeem manually on Polymarket's site)."
outcome: "The redeem-worker calls `redeemPositions(...)` for resolved-losing rows too, with `expectedShares` read from chain at claim time. Successful tx burns the worthless tokens; data-api stops listing them; /money UI position count drops to only-still-open. Worker still distinguishes winner (writes to ledger as redeemed-with-payout) vs loser (writes as redeemed-zero) for accounting. Net: a Privy-custodied user can fully clear their resolved-position drawer through the loop, no manual UI step required."
assignees: []
spec_refs:
  - poly-redeem-pipeline
project: proj.poly-copy-trading
deploy_verified: false
labels: [poly, redeem, dust, ui-stale-positions, privy-custody]
external_refs:
  - work/items/task.0429.poly-auto-wrap-usdce-to-pusd.md
  - https://github.com/Cogni-DAO/node-template/pull/1149
---

# bug.0435 — Redeem-worker leaves resolved-losing positions un-burned

## Why this exists (Derek, 2026-04-30 candidate-a investigation)

User has 71 positions on Polymarket: 56 redeemable (resolved), 15 still-open. Of the 56:

- **2 are real winners** (`currentValue ≈ $5 each`, total $9.91)
- **54 are resolved losers** (`currentValue ≈ 0`, ERC-1155 tokens still on chain)

`/money` UI shows all 71 as "open positions" because the data-API still lists them — Polymarket's data-API only drops a position when the underlying ERC-1155 balance hits 0, which only happens after a `redeemPositions` call burns them.

Today's policy in `decision-to-enqueue-input.ts`:

```ts
if (c.decision.kind === "skip") {
  const lifecycleState =
    c.decision.reason === "losing_outcome" ? "loser" : "redeemed";
  return {
    ...base,
    flavor: ...,
    indexSet: [],
    expectedShares: "0",
    expectedPayoutUsdc: "0",
    lifecycleState,
    status: "skipped",   // <-- worker filters status='pending' only
  };
}
```

`status: "skipped"` means `claimNextPending` never picks them up. Worker never submits `redeemPositions`. Tokens stay on chain. UI stays cluttered.

The cluttered UI is not just cosmetic — it hides the actual still-tradable positions inside a wall of dust, and the Privy custody model means the user **physically cannot** click "redeem" on Polymarket's site to burn them manually. The worker is the only path.

## Repro

On candidate-a (2026-04-30, sha `d03b5c8e6`):

```bash
# 1) Polymarket says 56 redeemable for funder 0x9A9e7276...:
curl 'https://data-api.polymarket.com/positions?user=0x9A9e7276…' | jq '[.[]|select(.redeemable==true)] | length'  # → 56

# 2) DB has 56 rows, all status=skipped lifecycle=loser, never claimed:
SELECT count(*) FROM poly_redeem_jobs
 WHERE funder_address='0x9A9e7276…' AND status='skipped' AND lifecycle_state='loser';  # → 54+
```

## Fix shape

Three options, in increasing scope:

1. **Minimal** — change `decisionToEnqueueInput` to write losing-outcome rows with `status='pending'/lifecycle_state='loser'` so worker claims them. Worker, at claim time, re-reads chain and either:
   - submits `redeemPositions` with `[balance, 0]` index set (burns losing side), OR
   - writes `lifecycle_state='redeemed_zero'` ledger entry on confirm.
   Risk: doubles worker load; need to confirm CTF accepts a redeem with 0-payout side correctly.
2. **Sweep job** — separate "burn-losing-tokens" sweep distinct from the winner-payout worker. Runs once per resolved condition. Lower risk because it isolates the new path from the existing payout path.
3. **Lazy / on-demand** — UI-side button per resolved-losing position that hits a new `/api/v1/poly/wallet/burn-losing/[conditionId]` route. User-driven, no autonomous sweep. Lowest risk + most user control, but doesn't auto-clean.

v0 ships option 1 (re-classify as pending) + a feature flag so the autonomous behavior can be killed if `redeemPositions(loser-side)` produces unexpected costs. v1 evaluates the gas overhead and decides whether to keep the autonomous loop or pivot to option 3.

## Validation

- After landing: `SELECT count(*) FROM poly_redeem_jobs WHERE status='skipped' AND lifecycle_state='loser'` → 0 (after a sweep cycle)
- Polymarket data-api position count drops to only-still-open per tenant
- /money UI shows accurate "X open positions, Y resolved-pending-burn"
- No regressions in winner-payout path (existing 2 winners for Derek still redeem with full payout)

## Out of scope

- Redoing the classifier (bug.0431 already correct)
- Auto-wrap loop (task.0429) — works; this just unblocks the upstream USDC.e arrival from any actual winners
- Selling open positions (different path; CLOB SELL via `bug.0329` CTF approval fix)

## Notes

- Filed during PR #1149 (task.0429) candidate-a validation. Symptoms surfaced when user wanted "zero open positions, ready for looped trading" and we discovered the worker has no path to clear losing dust.
- `bug.0433` (filed earlier in PR #1149 thread) was based on a mistaken claim that all 50 stuck rows were winners. On-chain verification shows only 2 are winners; the other 54 are correctly classified losers. bug.0433 should be **closed as not-a-bug** in the same closeout that lands bug.0435's fix; the work it described (recovery sweep for stale loser rows) was a misdiagnosis.
