---
id: bug.0383
type: bug
title: poly CTF redeem sweep loops on losing-outcome ERC1155 — bug.0376 fix-of-fix
status: needs_implement
priority: 0
rank: 1
estimate: 2
branch: bug/0376-redeem-still-reverts
summary: bug.0376's "ERC1155 balance > 0" predicate also fires for losing-outcome tokens. `redeemPositions(indexSets=[1,2])` on losers succeeds with payout=0, doesn't burn, balance stays > 0, sweep loops every tick. 334 of 339 redeem txs in 24h on `0x95e4…5134` were no-ops; ~1.9 POL drained.
outcome: Redeem sweep only fires `redeemPositions` when the funder's held position is the *winning* outcome (`payoutNumerators(conditionId, outcomeIndex) > 0`). On-chain POL spend on `0x95e4…5134` traces 1:1 to USDC.e payouts.
spec_refs:
assignees: []
credit:
project: proj.poly-web3-security-hardening
pr:
reviewer:
revision: 1
blocked_by:
deploy_verified: false
created: 2026-04-25
updated: 2026-04-25
labels: [poly, gas, web3, incident, redeem]
external_refs:
---

# poly CTF redeem sweep loops on losing-outcome ERC1155 — bug.0376 fix-of-fix

## Requirements

### Observed

After bug.0376's fix (`ab0fc108e`, deployed prod 2026-04-25 09:08 UTC), the
sweep now correctly uses chain truth (`balanceOf > 0`) as the predicate. But
the predicate fires for **every outcome token the funder holds**, including
the losing side of resolved markets. `redeemPositions` on a losing position
succeeds with payout=0 and burns nothing — so the wallet's ERC1155 balance for
that positionId is unchanged and the next sweep tick re-fires the same call
forever.

**On-chain evidence (Polygon, wallet `0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134`, last 24h):**

- 339 outbound `redeemPositions` txs (nonce 12 → 351).
- Net POL spend ~1.902 POL (bal 0.904 + 1.0 MATIC inbound − 0.001 now).
- Inbound USDC.e from CTF `0x4d97…6045`: 5 transfers, 27.14 USDC total.
- 5 of 339 redeems paid out; **334 (98.5%) were no-op success calls.**
- Avg gas per no-op: 72,659. Avg gas per paying: 109,528.

**Receipt diff (smoking gun):**

- No-op tx `0x00f15e1268dc0ce2c1681df7a668e692e7d8cdc6b87fcf15901a304d85aecd67`:
  status=success, gasUsed=72,659, **2 logs**: `PayoutRedemption(payout=0)` from
  CTF + Polygon gas-burn. **No ERC1155 TransferSingle. No USDC Transfer.** The
  funder's position-token balance is unchanged after the call.
- Paying tx `0x6af03644d5d206acee7ace9c0ccfa5c59a267efa9e8c9a27228bfaa77d813f3b`:
  status=success, gasUsed=109,528, 4 logs: ERC1155 TransferSingle (winning
  tokens burned) + USDC Transfer (7.14 paid) + PayoutRedemption + gas-burn.
  Balance for that positionId goes to 0; not picked up next sweep ✓.

**Loki evidence:**

- 14,555 `poly.ctf.redeem.error` events post-promo over ~8.5h, all of form
  `"no redeemable position for conditionId=…"` — these are cheap (no RPC),
  but they correspond to the same condition-ids the sweep fires `balanceOf > 0`
  on and then trips the inner Data-API guard. Symptom of the same root cause.
- 111 `poly.ctf.redeem.ok` events post-promo == on-chain nonce delta exactly.
  All 111 burned gas; all but ~1 returned 0 USDC.

**Code pointers:**

- Sweep: `nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts:670-770`
  (`redeemAllRedeemableResolvedPositions`). After bug.0376, predicate is
  `multicall.balanceOf(funder, positionId) > 0`. No outcome-side check.
- Per-condition write: same file `:580-665` (`redeemResolvedPosition`) calls
  `walletClient.writeContract({ functionName: "redeemPositions", args: [USDC, 0x0, conditionId, [1n, 2n]] })`.
  Index sets `[1, 2]` mean "redeem both YES and NO"; CTF returns 0 for the side
  we don't hold AND for the side that lost.
- ABI: `packages/market-provider/src/adapters/polymarket/polymarket.ctf.ts` —
  exposes `balanceOf` and `redeemPositions` only. Missing `payoutNumerators`.
- Position type: `packages/market-provider/src/adapters/polymarket/polymarket.data-api.types.ts:68-115`
  has `asset` (positionId), `conditionId`, and `outcomeIndex` (0/1 for binary).

**Root cause:** The chain-truth predicate from bug.0376 is correct in spirit
but uses the wrong variable. Holding ERC1155 balance for _some_ outcome
doesn't mean we hold a _winning_ outcome. CTF's `redeemPositions` is
intentionally idempotent on losers — it pays 0, burns nothing, returns
success. The predicate must additionally consult
`payoutNumerators(conditionId, outcomeIndex)`.

### Expected

- For each (`conditionId`, `outcomeIndex`, `positionId`) the funder holds:
  fire `redeemPositions` only when **both** `balanceOf(funder, positionId) > 0`
  **and** `payoutNumerators(conditionId, outcomeIndex) > 0`.
- Losing-outcome positions log `poly.ctf.redeem.skip_losing_outcome` (info)
  and never hit chain.
- Unresolved markets (denominator == 0) are already excluded by data-api's
  `position.redeemable` filter on the upstream side; if they slip through, our
  `payoutNumerators == 0` check skips them too.
- After this fix: every `poly.ctf.redeem.ok` corresponds to a non-zero USDC
  inbound to the funder. POL gas burn ≤ 1 paying-redeem worth per resolved
  winning position, ever.

### Reproduction

1. Funder wallet holds ERC1155 balance for the _losing_ outcome of a resolved
   binary market (any of the 100s of positionIds currently held by
   `0x95e4…5134`).
2. Mirror tick runs `redeemSweep`.
3. Current code: `balanceOf > 0` ⇒ submits `redeemPositions(USDC, 0x0, c, [1, 2])`.
4. Tx confirms, payout=0, ERC1155 not burned, ~73k gas spent.
5. Next tick (≤30s later): same balance, same submit, same waste. Forever.

### Impact

- **Severity: priority 0.** Direct, unbounded loss of operator funds. Current
  burn rate ≈ 1 POL per refill cycle (1 POL drained in ~20 min after the 09:14
  refill). The wallet auto-empties any top-up within an hour as long as it
  holds _any_ losing-outcome position from prior copy-trade or mirror activity.
- Secondary: 14k+/day `poly.ctf.redeem.error` log spam in Loki masks real
  errors.
- Tertiary: every mirror-pipeline tick is artificially slow (sequential on-chain
  writes per held position).

## Design

### Outcome

The poly node's redeem sweep stops paying gas on no-op `redeemPositions`
calls. After this ships, on-chain POL spend on the operator funder traces 1:1
to USDC.e inbound payouts within the same tx. Losing-outcome positions
accumulate harmlessly (zero gas, zero on-chain calls) until they are sold or
swept by a separate cleanup task (out of scope here).

### Approach

**Extend the existing `balanceOf` multicall with a paired `payoutNumerators`
read; skip when the held outcome is a loser.** Same multicall pattern,
same ABI module, no new infrastructure.

Concretely, in `redeemAllRedeemableResolvedPositions`
(`nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts:667+`):

1. Carry `outcomeIndex` from each `Position` into the candidate tuple
   alongside `conditionId` + `asset`. (`outcomeIndex` is already on the
   Data-API `Position` type — `polymarket.data-api.types.ts:78`.)
2. The existing multicall builds N `balanceOf(funder, asset)` calls. Extend
   it to 2N: also call `payoutNumerators(conditionId, outcomeIndex)` per
   candidate. Same `publicClient.multicall({ allowFailure: true })` shape.
3. For each candidate, skip with a structured log if **either**:
   - `balanceOf == 0` → existing `poly.ctf.redeem.skip_zero_balance` (kept).
   - `payoutNumerators == 0` → new `poly.ctf.redeem.skip_losing_outcome`
     (info-level, fields: `condition_id`, `asset`, `outcome_index`, `funder`).
4. Only when both checks pass, invoke `redeemResolvedPosition({ condition_id })`
   — write path is unchanged.

**Reuses:**

- `publicClient.multicall` with `allowFailure: true` (already used in
  `redeemAllRedeemableResolvedPositions`).
- `polymarketCtfRedeemAbi` ABI module — append one fragment:
  `function payoutNumerators(bytes32 conditionId, uint256 outcomeIndex) view returns (uint256)`.
- `Position.outcomeIndex` (already in the validated zod type).
- Existing `poly.ctf.redeem.skip_*` logger event family.
- bug.0376's chain-truth principle (`CHAIN_TRUTH_SOURCE`) — this fix
  strengthens it, doesn't replace it.

**Rejected alternatives:**

- **Receipt-parse cooldown** (inspect prior tx for ERC1155 burn / USDC
  Transfer; cache `condition_id → no-op` for N ticks): requires either
  in-process Set (lost on restart, leaks one wasted redeem per stuck
  condition per pod-start) or persistent Redis cache (new infra, new
  invalidation rules, new failure modes). Doesn't fix the underlying "we
  asked the wrong question" problem — only debounces the symptom.
- **Disable redeem sweep entirely / move to manual close**: stops the
  bleed but loses real winning redemptions and breaks the autonomous
  exit-path UX. Operationally too large a regression for a P0 hotfix.
- **Per-tick blacklist of conditions seen in prior tick**: no chain
  cost, but doesn't survive restart and still wastes one redeem per
  condition per pod uptime; doesn't address why the predicate is wrong.
- **Filter at the Data-API layer (`Position.redeemable`)**: precisely the
  source bug.0376 was filed to escape — Data-API state lags chain and is
  not authoritative.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] WINNING_OUTCOME_PRECHECK: Sweep submits `redeemPositions` only when
      `payoutNumerators(conditionId, outcomeIndex) > 0` for the funder's
      held position. (spec: proj.poly-web3-security-hardening)
- [ ] CHAIN_TRUTH_SOURCE: Predicate inputs come from CTF view calls
      (`balanceOf` + `payoutNumerators`), not from Data-API state flags.
      (spec: bug.0376 invariant, retained)
- [ ] BINARY_INDEX_SETS_WRITE_ONLY: `[1, 2]` index-set assumption stays
      scoped to the `redeemPositions` write call; the new
      `payoutNumerators` read is outcome-cardinality agnostic. (spec:
      `polymarket.ctf.ts` module invariants)
- [ ] SIMPLE_SOLUTION: Extends one existing multicall with one extra ABI
      fragment; no new ports, no new packages, no new infra.
- [ ] ARCHITECTURE_ALIGNMENT: All chain reads continue to flow through the
      `polymarket.ctf.ts` ABI module; sweep wiring stays in
      `bootstrap/capabilities/poly-trade-executor.ts`. (spec:
      docs/spec/architecture.md)

### Files

<!-- High-level scope -->

- Modify: `packages/market-provider/src/adapters/polymarket/polymarket.ctf.ts`
  — append one ABI fragment for
  `payoutNumerators(bytes32, uint256) view returns (uint256)` to
  `polymarketCtfRedeemAbi`. Update module-doc invariants list.
- Modify: `nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts`
  — in `redeemAllRedeemableResolvedPositions`: carry `outcomeIndex` into
  candidate tuple, extend multicall to include `payoutNumerators` per
  candidate, gate redeem on both checks passing, emit
  `poly.ctf.redeem.skip_losing_outcome` for losers.
- Test: `nodes/poly/app/tests/unit/bootstrap/poly-trade-executor.test.ts`
  — add cases:
  (a) balance>0 + numerator==0 (loser) → no redeem call, skip event emitted;
  (b) balance>0 + numerator>0 (winner) → redeem fires;
  (c) multicall returns mixed ok/failure for `payoutNumerators` → graceful
  skip with existing `balance_read_failed`-shape warning;
  (d) multiple positions, only winners redeemed.
- Test: `packages/market-provider/tests/polymarket-ctf.test.ts` — assert
  the new ABI fragment parses and exposes `payoutNumerators` with the
  correct signature.

## Validation

```yaml
exercise: |
  # Anvil-fork validation (out of scope for this PR — covered by task.0378).
  # For this PR: stack-test fixture in tests/unit/bootstrap simulates the
  # multicall result shape and asserts the gating logic.
  pnpm -C nodes/poly/app test -- poly-trade-executor.test.ts

observability: |
  # Post-flight on candidate-a, against funder 0x95e4…5134:
  # 1. Loki: `{env="candidate-a", service="app"} | json | event="poly.ctf.redeem.skip_losing_outcome"` ≥ 1 within first sweep tick.
  # 2. Loki: `{env="candidate-a", service="app"} | json | event="poly.ctf.redeem.ok"` count over 1h ≤ on-chain USDC.e inbounds in same window.
  # 3. On-chain: `eth_getTransactionCount` delta over 1h on the funder ≤ count of `poly.ctf.redeem.ok` in the same window (no surprise txs).

smoke_cmd: |
  pnpm -C nodes/poly/app test -- poly-trade-executor.test.ts
```
