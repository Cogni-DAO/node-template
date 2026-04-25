---
id: bug.0373
type: bug
title: poly CTF redeem sweep burns POL on a runaway loop, re-redeeming already-redeemed positions
status: needs_implement
priority: 0
rank: 1
estimate: 2
branch: fix/bug-poly-redeem-sweep-gas-drain
summary: Mirror-pipeline CTF redeem sweep keeps re-submitting `redeemPositions` for the same condition_ids every ~30s; trading wallet drained 0.425 POL in 20 minutes (00:47–01:07 UTC 2026-04-25) and is now at 0.0029 POL.
outcome: Sweep dedups against actual on-chain redemption state (or a short-lived in-process guard) and stops re-submitting no-op redemptions. POL drain on `0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134` returns to zero outside legitimate, one-shot redemptions.
spec_refs:
assignees: []
credit:
project:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-25
updated: 2026-04-25
labels: [poly, copy-trade, gas, incident]
external_refs:
---

# poly CTF redeem sweep burns POL on a runaway loop

## Requirements

### Observed

The CTF redeem sweep on the prod poly node is hot-looping `redeemPositions`
against the same condition_ids every ~30 seconds, draining native POL gas from
the operator trading wallet `0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134`.

**On-chain evidence (Polygon, Blockscout, last 20 min sample):**

- 50 successful `redeemPositions` txs to CTF `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`
  between `2026-04-25T00:47:30Z` and `2026-04-25T01:07:34Z`.
- Total fee burned: **0.425 POL** in 20 min (~$0.040 at ~$0.093/POL).
- Avg fee: 0.0085 POL/tx. Rate: ~2.5 tx/min → projected **~30 POL/day** drain.
- Two distinct `gas_used` values alternate in pairs: `65230` and `72659` —
  consistent with the same two condition_ids being re-submitted every tick.
- All txs `status: ok`, `value: 0`. Polygon `eth_getBalance` now returns
  `0xa49d78abbb4fe` = 0.002896 POL.
- Sample tx: `0x4765f49bc03af618ee8f99d912522b3e5cd414363fb0f31ddeb7689167f617b4`.

**Loki evidence (`{env="production",pod=~"poly-node-app-.*"}`, same window):**

- 18× `poly.ctf.redeem.sweep_skip` for a different condition_id
  (`0x2f76…aeb9`) — fails at `eth_estimateGas` with `Missing or invalid parameters`.
  Estimation reverts on the node, no tx submitted, no gas burned. Noisy but
  not the source of the drain.
- The successful drain txs above are NOT logged as `poly.ctf.redeem.ok` in
  the same window — i.e. the sweep is firing successful txs without the
  expected info-level event, OR the event is being emitted but at a different
  pod than `poly-node-app-db778595-dmf2b`.

**Code pointers:**

- Sweep entrypoint: `nodes/poly/app/src/bootstrap/container.ts:831` —
  `redeemSweep` calls `executor.redeemAllRedeemableResolvedPositions()` on
  every mirror-pipeline tick.
- Sweep loop: `nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts:657-691`
  (`redeemAllRedeemableResolvedPositions`). It iterates `dataApiClient.listUserPositions(funderAddress)`,
  filters by `p.redeemable`, and dedupes by normalized `conditionId` **only
  within a single sweep call** (the `seen` Set is local to the function).
- Per-condition redeem: `redeemResolvedPosition` at `poly-trade-executor.ts:580-655`
  — calls `walletClient.writeContract({ functionName: "redeemPositions", … })`
  unconditionally as long as `p.redeemable === true` from the data-api.
- Tick driver: `nodes/poly/app/src/features/copy-trade/mirror-pipeline.ts:163-175`
  — `redeemSweep` runs at the end of every mirror tick (no rate-limit, no
  cooldown, no “already attempted within last N seconds” guard).

**Root cause hypothesis:** Polymarket Data-API keeps returning `redeemable: true`
for positions that the node has already submitted a `redeemPositions` tx for,
either because (a) Data-API state lags on-chain settlement, or (b) the
position is genuinely still redeemable on-chain (CTF `redeemPositions` is a
no-op-success when the payout balance is 0 — it doesn’t revert). With no
in-process dedup across ticks, every mirror-pipeline tick re-submits the same
two condition_ids, paying ~0.017 POL/tick forever.

### Expected

- The sweep submits `redeemPositions` **at most once per condition_id** until
  the data-api stops reporting it as `redeemable` OR a cooldown elapses.
- A failed `eth_estimateGas` (case 1, the sweep_skip path) does not retry
  every tick — same condition_id should be backed off.
- A successful redemption that is actually a no-op on-chain (zero payout
  transfer in the tx receipt) should be detected and the condition_id
  marked “do not retry” for a sane window.
- POL gas spend on the operator trading wallet trends to ~0 outside genuine
  one-time redemptions.

### Reproduction

1. Deploy poly node with mirror pipeline enabled (`PRIVY_USER_WALLETS_*` +
   `POLY_WALLET_AEAD_*` configured) so `redeemSweep` is wired in
   `container.ts:831`.
2. Have at least one position on the operator funder wallet that the
   Polymarket Data-API reports as `redeemable: true` (resolved market that
   was already redeemed, or zero-payout redeem).
3. Watch the wallet on Polygonscan: `redeemPositions` will fire every
   mirror tick (~30s) indefinitely, each consuming ~0.008 POL.

Code path: `mirror-pipeline.ts:163` → `container.ts:831` →
`poly-trade-executor.ts:657` (`redeemAllRedeemableResolvedPositions`) →
`poly-trade-executor.ts:614` (`walletClient.writeContract` redeemPositions).

### Impact

- **Severity: priority 0.** Direct, unbounded loss of operator funds on the
  shared trading wallet. ~30 POL/day at current cadence; wallet is already
  empty (0.0029 POL) and any top-up will be drained within hours unless the
  sweep is disabled or fixed.
- Secondary: noisy `poly.ctf.redeem.sweep_skip` warns flood Loki, masking
  real errors.
- Tertiary: every mirror-pipeline tick is artificially slow because it
  serializes a real on-chain `writeContract` + `waitForTransactionReceipt`
  per redeemable condition_id.

## Design

### Outcome

The poly node stops burning POL gas on no-op `redeemPositions` calls. After the
fix, `0x95e4…5134`'s POL balance does not decrease while the mirror pipeline is
running unless a position is genuinely redeemable on-chain (non-zero CTF
ERC1155 balance for the position token).

### Approach

**Solution — three layers, smallest first:**

1. **Kill switch (deploy first, today).** Add `POLY_CTF_REDEEM_SWEEP_ENABLED`
   env flag, default `false`. Read at sweep wiring in
   `nodes/poly/app/src/bootstrap/container.ts:831`. If `false`, do not register
   the `redeemSweep` callback at all (mirror pipeline already treats it as
   optional — see `mirror-pipeline.ts:163`). Flip to `false` in the production
   overlay to stop the bleed without requiring a code-review-paced rollout of
   the correctness fix. Default-off is safe: missing a redemption is always
   recoverable; burning gas forever is not.

2. **Pre-flight balance check (the actual correctness fix).** Before calling
   `walletClient.writeContract({ functionName: "redeemPositions", … })`, do a
   read-only `eth_call` on the CTF contract to confirm the funder still holds
   non-zero ERC1155 balance for at least one of the binary position tokens.
   If both balances are 0, log `poly.ctf.redeem.skip_zero_balance` and return
   early (no tx submitted, no gas spent). This is **stateless** (no in-process
   cooldown map to lose on restart, no DB row to migrate) and **authoritative**
   (the chain is the truth, not the Data-API's `redeemable` flag).

   Implementation:
   - Extend `polymarketCtfRedeemAbi` in
     `packages/market-provider/src/adapters/polymarket/polymarket.ctf.redeem.ts`
     with the three CTF view methods we need:
     - `getCollectionId(bytes32 parentCollectionId, bytes32 conditionId, uint256 indexSet) view returns (bytes32)`
     - `getPositionId(address collateralToken, bytes32 collectionId) view returns (uint256)`
     - `balanceOf(address account, uint256 id) view returns (uint256)` (ERC1155
       on the same CTF contract)
   - In `poly-trade-executor.ts:redeemResolvedPosition` (line 580), after the
     `match` lookup but before `walletClient.writeContract`, run a single
     `multicall` (or two parallel `readContract` calls) against the CTF
     contract for the two binary position tokens. If both balances are 0,
     short-circuit with a structured `not_redeemable` outcome (without
     throwing — a zero-balance redeem should be a no-op skip, not an error).
   - In the sweep loop (`redeemAllRedeemableResolvedPositions`, line 657), the
     existing `try/catch` already swallows per-condition errors, so the
     short-circuit is naturally absorbed. Bump the log to `info` for
     skip_zero_balance.

3. **Cadence throttle (defense in depth).** Replace per-tick sweep invocation
   with a per-process minimum interval. Track `lastSweepAt: number | null` on
   the closure that wraps `redeemSweep` in `container.ts:831`. If `now -
lastSweepAt < POLY_CTF_REDEEM_SWEEP_INTERVAL_MS` (default `60_000`), skip.
   This caps worst-case bleed even if the balance check has a bug we missed.

**Reuses:**

- viem `publicClient.readContract` and `multicall` — already constructed and
  used elsewhere in the same file (`createPublicClient` line 320). No new
  RPC client, no new cache.
- The mirror-pipeline tick driver and existing `redeemSweep?: () => Promise<void>`
  optional hook (`mirror-pipeline.ts:118-175`) — no changes to the pipeline
  contract; we only adjust how the sweep is wired and what it does internally.
- The existing `viem.parseAbi` in `polymarket.ctf.redeem.ts` — extend the same
  ABI artifact rather than create a new one.

### Rejected alternatives

- **In-memory cooldown map (`Map<conditionId, last_attempt_ms>`).** Fragile:
  state lost on pod restart, inconsistent across pods if we ever scale
  horizontally, and still issues _one_ wasted tx per restart per condition.
  An on-chain balance read is stateless, authoritative, and free.
- **Post-hoc `Transfer` event scan on the receipt to detect zero-payout
  redemptions.** The bleed has already happened by the time we read the
  receipt. Pre-flight is strictly cheaper.
- **Move `redeemAllRedeemableResolvedPositions` into a Temporal activity /
  separate sweep job.** Real architectural improvement but out of scope for
  an emergency stop-the-bleed fix; defer to a follow-up if anyone wants it.
- **Trust the Data-API `redeemable` flag and just rate-limit retries.** The
  Data-API is the bug source — we should not encode "wait long enough and
  hope it self-heals" into our control loop.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] **CTF_REDEEM_REQUIRES_NONZERO_BALANCE** — `redeemResolvedPosition` MUST NOT
      submit `redeemPositions` when both binary position-token balances are 0
      for the funder. Verified by unit test that mocks the read calls.
- [ ] **KILL_SWITCH_HONORED** — when `POLY_CTF_REDEEM_SWEEP_ENABLED !== "true"`,
      `redeemSweep` MUST NOT be registered with the mirror pipeline. Verified
      by container wiring test.
- [ ] **POLYGON_MAINNET_ONLY** — extended ABI stays pinned to the same CTF
      contract address (spec: `polymarket.ctf.redeem.ts` invariants).
- [ ] **BINARY_INDEX_SETS** — read both `[1, 2]` index-set balances; sum-zero
      means skip. Multi-outcome markets remain out of scope (existing invariant).
- [ ] **AUTHORIZED_PLACE_ONLY** — redeem path is unaffected; `authorizeWalletExit`
      still runs before the eventual write (spec: `poly-trade-executor.ts`).
- [ ] **NO_NEW_PORTS** — fix is contained to the existing `poly-trade-executor`
      capability + the `polymarket.ctf.redeem` ABI module. No new ports,
      adapters, or config layers.
- [ ] **SIMPLE_SOLUTION** — three small changes (env flag, ABI extension,
      pre-flight read). No state machines, no DB migrations, no new packages.
- [ ] **ARCHITECTURE_ALIGNMENT** — extends an existing capability and a market-
      provider adapter ABI; no boundary violations (spec: architecture).

### Files

- Modify: `packages/market-provider/src/adapters/polymarket/polymarket.ctf.redeem.ts`
  — extend `polymarketCtfRedeemAbi` with `getCollectionId`, `getPositionId`,
  `balanceOf`. Export a tiny helper `binaryPositionIds(funder, conditionId)`
  that returns the two `uint256` ids for a binary market (pure ABI math, no
  RPC).
- Modify: `nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts`
  — in `redeemResolvedPosition` (line 580–655), insert a balance precheck
  using the shared `publicClient.multicall` against `POLYGON_CONDITIONAL_TOKENS`.
  Short-circuit with a structured "not redeemable, zero balance" return when
  both balances are 0. Bubble the skip up to the sweep loop without throwing.
- Modify: `nodes/poly/app/src/bootstrap/container.ts` (line 831) — read
  `POLY_CTF_REDEEM_SWEEP_ENABLED` from `serverEnv`. If `!== "true"`, do NOT
  pass `redeemSweep` to `startMirrorPipeline`. Add the
  `POLY_CTF_REDEEM_SWEEP_INTERVAL_MS` throttle wrapper around the registered
  callback.
- Modify: env spec / serverEnv schema (wherever `POLY_*` env vars are declared)
  — add `POLY_CTF_REDEEM_SWEEP_ENABLED` (default `false`) and
  `POLY_CTF_REDEEM_SWEEP_INTERVAL_MS` (default `60000`).
- Modify: `infra/k8s/overlays/production/poly/` (or equivalent ConfigMap) —
  set `POLY_CTF_REDEEM_SWEEP_ENABLED=false` for prod immediately as a separate
  config-only commit landed BEFORE the code fix, so the bleed stops without
  waiting on tests.
- Test: new unit test under `nodes/poly/app/tests/unit/` that asserts:
  (a) zero-balance funder skips the redeem write; (b) non-zero balance
  proceeds with the existing write path; (c) kill switch off → no
  `redeemSweep` registered.

## Allowed Changes

- `nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts`
  (`redeemAllRedeemableResolvedPositions` + `redeemResolvedPosition` — add
  cross-tick dedup / cooldown / no-op detection).
- `nodes/poly/app/src/bootstrap/container.ts` (wiring of `redeemSweep` if a
  cooldown store needs to be injected).
- `nodes/poly/app/src/features/copy-trade/mirror-pipeline.ts` (only if the
  rate-limit lives at the tick boundary).
- Tests under `nodes/poly/app/tests/unit/features/copy-trade/` and
  `packages/market-provider/tests/` that cover the sweep path.

## Plan

- [ ] **Stop the bleed first.** Land a kill-switch env flag
      (`POLY_CTF_REDEEM_SWEEP_ENABLED=false` default-off in prod) so we can
      disable the sweep via config without redeploy churn while the real fix
      is in flight.
- [ ] Add an in-process cooldown map keyed by normalized condition_id
      (`Map<string, { last_attempt_ms, last_outcome }>`) inside
      `redeemAllRedeemableResolvedPositions` (or a small store on the
      executor instance). On each sweep, skip any condition_id attempted
      within the last N minutes regardless of outcome. N starts at 10 min.
- [ ] After a successful tx, parse the receipt for the USDC.e `Transfer`
      event amount. If 0, log `poly.ctf.redeem.no_payout` and extend the
      cooldown to a much longer window (24h+) — this is the "already
      redeemed, Data-API lying" case.
- [ ] On `eth_estimateGas` failure path (already lands as `sweep_skip`),
      apply the same cooldown so the noisy condition_id stops retrying every
      tick.
- [ ] Unit tests: - sweep called twice in a row only submits once per condition_id; - no-payout receipt extends cooldown beyond a normal failed attempt; - kill-switch flag short-circuits the sweep entirely.
- [ ] Add a one-time bounded retry escape hatch (operator API or admin
      endpoint) to force-redeem a specific condition_id, since cooldown will
      otherwise block legitimate redemption retries for the cooldown window.
- [ ] Top up the operator wallet only AFTER fix is flighted to candidate-a
      and the sample tx rate has dropped to zero on the live wallet.

## Validation

**Command:**

```bash
pnpm --filter @cogni/poly-node-app test:unit -- redeem-sweep
```

**Expected:** New tests pass; existing mirror-pipeline tests still green.

**Post-flight on candidate-a (the gate that actually matters):**

```bash
# 1. Confirm sweep enabled in candidate-a config (or kill-switch flipped).
# 2. Watch the operator wallet for 1 hour:
curl -s -X POST https://1rpc.io/matic \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getBalance","params":["0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134","latest"]}'
# 3. Read tx history; expect 0 new redeemPositions txs in the hour, OR at
#    most 1 per genuinely-redeemable condition_id.
# 4. Loki: zero `poly.ctf.redeem.sweep_skip` repeats for the same
#    condition_id within the cooldown window.
```

**Expected:** Wallet balance does not decrease over a 1-hour idle window;
`redeemPositions` cadence drops from 150/hr to ≤1/hr per condition_id.

## Review Checklist

- [ ] **Work Item:** `bug.0373` linked in PR body
- [ ] **Spec:** mirror-pipeline + poly-trade-executor invariants upheld; no
      regression to existing redeem flow on truly-unredeemed positions
- [ ] **Tests:** new unit tests for cooldown + no-payout + kill-switch
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Sample drain tx (Polygonscan): https://polygonscan.com/tx/0x4765f49bc03af618ee8f99d912522b3e5cd414363fb0f31ddeb7689167f617b4
- Operator trading wallet: https://polygonscan.com/address/0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134
- Pod: `poly-node-app-db778595-dmf2b` (cogni-production)

## Attribution

- Reported by: derek (`/logs prod` → `/bug`)
