---
id: design.poly-bet-sizer-v1
type: design
status: draft
created: 2026-05-02
updated: 2026-05-02
tags: [poly, copy-trading, bet-sizer, rn1, swisstony]
implements: task.5005
---

# Poly Bet-Sizer v1

## One Screen

This policy only has percentile distributions for the two pre-researched target
wallets:

| Wallet                                       | Label     | p75     | p90     | p95     | p100      |
| -------------------------------------------- | --------- | ------- | ------- | ------- | --------- |
| `0x2005d16a84ceefa912d4e380cd32e7ff827875ea` | RN1       | $117.65 | $427.81 | $702.30 | $2,660.08 |
| `0x204f72f35326db932158cba6adff0b9a1da95e14` | swisstony | $114.57 | $321.62 | $805.05 | $4,811.89 |

Snapshot source in code:
`nodes/poly/app/src/bootstrap/jobs/copy-trade-mirror.job.ts`
`TOP_TARGET_SIZE_SNAPSHOTS`.

Snapshot metadata: latest 1000 observed fills per wallet, captured at
`2026-05-02T01:51:56Z`.

## Mental Model

```text
target bet size

  below selected pXX        selected pXX                     p100+
  ------------------|-----------------------------|------------->
        SKIP              mirror market min bet       mirror max bet
                           \_____________________/
                              scales linearly
```

Example with `p75` selected and `$5.00` max:

```text
target bets less than p75      -> skip
target bet exactly p75         -> place market minimum
target bet halfway p75 to p100 -> place halfway between min and $5.00
target bet p100 or larger      -> place $5.00, subject to grant caps
```

## Formula

For snapshot-backed wallets, the planner uses `target_percentile_scaled`:

```text
threshold = snapshot[pXX]
max_target = snapshot[p100]
floor = market minimum bet for this market

if target_usdc < threshold:
  skip below_target_percentile

ratio = clamp((target_usdc - threshold) / (max_target - threshold), 0, 1)
mirror_usdc = floor + (user_max_usdc - floor) * ratio
mirror_usdc = apply market floors, then clamp to user_max_usdc
```

If the market minimum is already above the user max, the plan skips as
`below_market_min`.

## User Controls

Both controls are stored per active copied target:

| Control                     | Meaning                            | Default |
| --------------------------- | ---------------------------------- | ------- |
| `mirror_filter_percentile`  | Which pXX threshold starts copying | `75`    |
| `mirror_max_usdc_per_trade` | Mirror size at p100 and above      | `5.00`  |

These are persisted on `poly_copy_trade_targets`. The distribution itself is
not in the database today; only the user's selected pXX and max bet are.

Wallets without a saved snapshot use explicit `min_bet` sizing. They do not
silently pretend to have percentile sizing.

## Boundaries

- Wallet detection does not decide sizing.
- Websocket/Data-API normalization does not decide sizing.
- Collateral wrapping does not decide sizing.
- The CLOB adapter only executes an already planned order.
- `planMirrorFromFill()` is the pure decision point.
- `authorizeIntent()` remains the downstream grant/cap enforcement point.

## Code Pointers

- Snapshot distributions and bootstrap policy:
  `nodes/poly/app/src/bootstrap/jobs/copy-trade-mirror.job.ts`
- Sizing math:
  `nodes/poly/app/src/features/copy-trade/plan-mirror.ts`
- Policy types/schema:
  `nodes/poly/app/src/features/copy-trade/types.ts`
- DB columns:
  `nodes/poly/packages/db-schema/src/copy-trade.ts`
- DB migration:
  `nodes/poly/app/src/adapters/server/db/migrations/0038_poly_copy_trade_target_policy.sql`
- API contract:
  `nodes/poly/packages/node-contracts/src/poly.copy-trade.targets.v1.contract.ts`
- API routes:
  `nodes/poly/app/src/app/api/v1/poly/copy-trade/targets/route.ts`
  `nodes/poly/app/src/app/api/v1/poly/copy-trade/targets/[id]/route.ts`
- Money page controls:
  `nodes/poly/app/src/components/kit/policy/TargetCopyPolicyControls.tsx`
  `nodes/poly/app/src/app/(app)/credits/PolicyPanel.tsx`
