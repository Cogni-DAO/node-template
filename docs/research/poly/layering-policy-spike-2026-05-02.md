---
id: poly-layering-policy-spike-2026-05-02
type: research
title: "Research: Condition-Aware Polymarket Mirror Layering Policy"
status: draft
trust: draft
summary: "Designs a condition-aware mirror follow-up policy for RN1/swisstony so sub-percentile target fills can be followed only when target and mirror position context make the bet meaningful."
read_when: "Changing Polymarket copy-trade sizing, hedge-followup, same-token layering, or target-position thresholds."
owner: derekg1729
created: 2026-05-02
implements: spike.5000
tags: [poly, copy-trade, sizing, research]
---

# Condition-Aware Layering Policy Spike - 2026-05-02

## Question

The current RN1/swisstony mirror policy uses a per-target percentile floor (`target_percentile_scaled`) to skip low-notional fills before sizing an accepted fill from market minimum to the per-position cap. That catches the large majority of target notional but misses target behavior that is condition-local rather than fill-local: RN1 often builds or hedges a position through many below-percentile fills on the same `conditionId`. The question is when a fill that would otherwise skip as `below_target_percentile` should be upgraded to follow without reopening random tiny-trade noise.

## Recommended policy

Ship a gated `condition_layering_v1` sizing-policy extension behind a per-target config flag:

```ts
layering: {
  enabled: boolean;
  minLayerFillUsdc: 1;
  lookbackMinutes: 120;
  minClusterFills: 3;
  minClusterNotional: "target_percentile_floor";
}
```

For a target BUY fill whose `targetSizeUsdc` is below the existing percentile floor, follow only when all predicates pass:

1. `layering.enabled` is true for this target wallet.
2. The fill has a `condition_id`/`market_id`, token id, market minimum metadata, and `targetSizeUsdc >= minLayerFillUsdc`.
3. There is no active resting mirror order on the same `(billing_account_id, target_id, market_id)`. Do not bypass the existing `already_resting` gate; layering should add exposure only after the prior order has filled, partially filled, or closed its resting slot.
4. The condition is anchored by either:
   - our state: `poly_copy_trade_fills` already shows active committed exposure on this `(billing_account_id, target_id, condition_id)`; or
   - target state: Data API `/trades` shows at least `minClusterFills` target BUY fills on this `conditionId` in the last `lookbackMinutes`, and their cumulative target notional including the current fill is at least this target wallet's configured percentile floor.
5. The remaining per-condition mirror budget can still place at least the market floor.

The anchor rule is deliberately a combination. "We already hold this condition" follows target management after our own entry. The cluster-notional fallback catches pure scale-ins where no single fill cleared the global percentile but the condition-level campaign did. Requiring both count and cumulative notional keeps one-off $1 dust out.

Sizing:

- Same-token scale-in: place `min(max(marketFloorUsdc, targetSizeUsdc), remainingConditionCap)`.
- Opposite-token hedge on a condition where we hold the other token: place the same formula, additionally capped by our active exposure on the opposite token so the hedge cannot exceed the primary leg.
- If `targetSizeUsdc < marketFloorUsdc`, allow the floor only because predicate 2 already filters out sub-$1 dust and predicate 5 caps total condition exposure.

Per-target calibration should be mostly inherited from the existing wallet statistic. RN1 and swisstony can share `minClusterFills=3`, `lookbackMinutes=120`, and `minLayerFillUsdc=$1`, but `minClusterNotional` must resolve through each target's own percentile floor rather than a global dollar value. The code already has per-target percentile snapshots; this policy should add only a per-target enable flag plus optional overrides for the three small knobs.

This policy uses only data already in hand or cheap to derive: the current target fill, recent target `/trades` or `/activity` rows for the same wallet, `poly_copy_trade_fills` by target/condition for our state, and market minimums from the metadata cache.

## Rejected alternatives

### N fills in T minutes only

Following any condition with 3+ recent fills is too loose. RN1's feed contains bursts of small same-condition activity where the total dollar signal is still negligible. Count alone identifies "busy", not "conviction". It would also over-trigger on low-price markets where a trader can spray many fills with little economic intent.

### Already-open condition only

Using only our open state is safer, but it misses the exact scale-in pattern where RN1 builds a condition through many below-percentile fills before any one fill would have caused us to enter. It also makes the policy path-dependent on whether our first order filled. The cluster-notional fallback is the minimum extra predicate needed to catch these campaigns without following unrelated dust.

## Replay / sanity check

I replayed the latest 1000 public Data API trades for RN1 and swisstony on 2026-05-02. This is a back-of-envelope target-feed replay, not a full production replay: it does not know our actual filled rows, market-min edge cases, or the current candidate-a ledger state.

Current live-sample notional distribution:

| target    | trades | conditions | total notional | p75 |  p90 |  p95 |    p99 |
| --------- | -----: | ---------: | -------------: | --: | ---: | ---: | -----: |
| RN1       |   1000 |         70 |        $98,553 | $49 | $251 | $464 | $1,219 |
| swisstony |   1000 |        132 |        $67,148 | $15 | $110 | $252 |   $897 |

For RN1, the top five conditions were dense campaigns, not isolated bets:

| condition example      | fills | sub-p75 fills | target notional | window |
| ---------------------- | ----: | ------------: | --------------: | ------ |
| Barcelona win          |   194 |           124 |         $28,023 | 20m    |
| Osasuna/Barcelona draw |   113 |            83 |          $7,346 | 19m    |
| Reds/Pirates           |    72 |            57 |         $19,274 | 16m    |
| Visker/Mmoh            |    53 |            43 |          $5,847 | 17m    |
| Osasuna win            |    42 |            25 |          $4,087 | 19m    |

With `N=3`, `T=120m`, cumulative condition notional >= p75, and `minLayerFillUsdc=$1`, the replay found:

| target    | base p75 follow count | base target notional | sub-p75 upgraded candidates | upgraded target notional | under-$1 candidates skipped |
| --------- | --------------------: | -------------------: | --------------------------: | -----------------------: | --------------------------: |
| RN1       |                   254 |              $91,389 |                         475 |                   $6,068 |                         109 |
| swisstony |                   253 |              $64,880 |                         360 |                   $1,525 |                         250 |

That looks like a lot of extra events, but not a lot of target dollars. Simulating the current $5 condition cap with a $1 market floor bounded the extra mirror placements to roughly 79 RN1 layer orders ($79) and 124 swisstony layer orders ($124) in the 1000-trade sample. The policy therefore changes entry/VWAP on active conditions without turning every skipped tiny fill into unlimited exposure.

Failure modes:

- Market-min oversizing is real. A $1.05 target layer becomes at least a $1 mirror layer, which can overweight tiny target management. The `$1` floor and condition cap are the guardrails.
- Cluster bursts can be churn, not conviction. A trader can place many small fills while probing liquidity. The cumulative-notional threshold reduces but does not eliminate this.
- The existing `already_resting` gate means some layers still skip while our prior GTC limit is open. That is acceptable for v1; removing it would fight the DB dedupe invariant.
- Stale Data API pages can undercount the target cluster during high-volume bursts. Phase 4 WebSocket will improve this, but this policy should remain poll-compatible.

## Open questions for /design phase

- Should the condition budget remain the existing `max_usdc_per_trade` field, or should layering get an explicit `max_usdc_per_condition` name before implementation?
- Should hedge legs add a distinct decision reason such as `layered_hedge` while same-token scale-ins use `layered_scale_in`, or should both collapse to one bounded `condition_layering` reason?
- Should implementation persist a compact target-condition rolling state, or derive it each tick from the current Data API page? Deriving is simpler; persistence is safer if bursts exceed the page limit.
- Should SELL fills be handled by the existing close path only, or should sub-percentile BUY hedges be explicitly marked as hedge exposure for later close/redeem behavior?

## Rollout plan + success metric

Roll out only for RN1 first:

1. Add `condition_layering_v1` behind a per-target gate, default off.
2. Enable on candidate-a for RN1 with `minLayerFillUsdc=$1`, `minClusterFills=3`, `lookbackMinutes=120`, and `minClusterNotional=target_percentile_floor`.
3. Run for 24h, then compare pre/post overlapping-condition VWAP on fills where the target had a below-percentile layer after an anchored condition.

Success metric: `condition_layer_vwap_gap_pp`.

For each `(target_wallet, condition_id, token_id)` where both target and mirror have BUY exposure during the 24h window:

```sql
mirror_vwap =
  sum((attributes->>'size_usdc')::numeric)
  / sum((attributes->>'size_usdc')::numeric / (attributes->>'limit_price')::numeric)
```

Compare that to target VWAP from Data API rows for the same `(conditionId, asset)`:

```text
target_vwap = sum(size * price) / sum(size)
gap_pp = abs(mirror_vwap - target_vwap) * 100
```

The 24h success condition is: on anchored conditions with sub-percentile target layers, notional-weighted `gap_pp` improves versus the prior 24h baseline, while `poly.mirror.decision` does not show a spike in `position_cap_reached`, `already_resting`, or wrong-token condition exposure. The dashboard query should also report `layer_follow_count`, `layer_follow_usdc`, and `layer_skip_under_min_usdc` so we can tell whether the policy is improving VWAP or merely generating capped skips.
