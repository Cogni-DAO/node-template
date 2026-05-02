---
id: design.poly-bet-sizer-v1
type: design
status: draft
created: 2026-05-02
tags: [poly, copy-trading, bet-sizer, rn1, swisstony]
implements: task.5005
---

# Poly Bet-Sizer v1

## Decision

Ship the Pareto path as a new `SizingPolicy` variant on the existing pure
planner boundary:

```ts
{
  kind: ("target_percentile", statistic, max_usdc_per_trade);
}
```

The first production config applies it only to RN1 and swisstony. All other
tracked wallets keep the existing `min_bet` behavior.

## Why This Shape

- **Composable:** `planMirrorFromFill()` already accepts a discriminated sizing
  policy. Adding one policy keeps the planner pure and avoids touching
  wallet-watch, normalizer, CLOB adapter, or ledger write order.
- **Reusable:** the policy carries a wallet-stat snapshot, not hardcoded
  wallet logic. Future UI/API work can persist the same shape once task.0347
  moves sizing config out of bootstrap code.
- **No silent drift:** each wallet gets exactly the configured sizing policy.
  Unknown wallets stay on the explicit `min_bet` default; a configured
  percentile policy does not silently fall back to another policy.

## Policy Semantics

1. Compute target fill notional from normalized `Fill.size_usdc`.
2. Skip when `target_fill_usdc < statistic.min_target_usdc`.
3. Size accepted fills as the market min bet.
4. Raise to market floor (`minUsdcNotional`, `minShares × price`) when needed.
5. Clamp to `max_usdc_per_trade`.
6. Skip if the market floor itself exceeds `max_usdc_per_trade`.

Default v1 parameters:

| Wallet                                       |     Label |                   Snapshot | Slider | Threshold |
| -------------------------------------------- | --------: | -------------------------: | -----: | --------: |
| `0x2005d16a84ceefa912d4e380cd32e7ff827875ea` |       RN1 | latest 1000 Data-API fills |    p75 |    $64.11 |
| `0x204f72f35326db932158cba6adff0b9a1da95e14` | swisstony | latest 1000 Data-API fills |    p75 |    $73.37 |

`max_usdc_per_trade = 5`. The p75 slider filters low bets while still leaving
enough signal for the current 30s poll loop. Relative sizing is intentionally
deferred to vNext as a separate policy.

## Validation

exercise:

- Unit: `pnpm --filter @cogni/poly-app test -- tests/unit/features/copy-trade/plan-mirror-sizing-target-percentile.test.ts tests/unit/bootstrap/jobs/copy-trade-mirror-sizing.test.ts`
- Candidate-a: track RN1 or swisstony, wait for a target fill above the
  configured p75 threshold, and confirm a mirror decision places with
  `mirror_usdc <= 5`; confirm a fill below threshold records
  `skip/below_target_percentile`.

observability:

- Loki LogQL: `{namespace="cogni-candidate-a"} | json | event="poly.mirror.decision" | reason=~"ok|below_target_percentile|below_market_min"`
- DB readback: `poly_copy_trade_decisions.reason` includes
  `below_target_percentile` for low target fills and `poly_copy_trade_fills`
  rows for accepted fills preserve `intent.size_usdc <= 5`.
