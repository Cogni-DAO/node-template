---
id: bug.0342
type: bug
title: poly copy-trade places sub-min orders — CLOB rejects silently (success=undefined, orderID=<missing>, errorMsg="")
status: needs_design
priority: 2
rank: 20
estimate: 2
summary: "`buildMirrorTargetConfig` hardcodes `mirror_usdc: 1`, and the copy-trade executor submits whatever the target config says without consulting Polymarket's per-market `orderMinSize`. On 5-share-min markets (most sports + many news markets, ~all top-volume as of 2026-04-20) a $1 BUY at price 0.64 → 1.5625 shares < 5-share min → CLOB returns `{}` (no `success`, no `orderID`, no `errorMsg`). Adapter classifies as `rejected`, fill is recorded as `placement_failed`, then mirror-coordinator shrugs and skips future ticks with `reason: already_placed` — the target's trade is silently unmirrored. `orderMinSize` is a per-market integer in **shares**, not USDC; effective USDC minimum varies with price."
outcome: "Copy-trade pre-flights every intent against the market's live `orderMinSize` (Gamma) and either (a) scales the intent up to the share-denominated minimum, bounded by a user-explicit per-trade ceiling, or (b) skips with `reason: below_market_min` so we never emit a sub-min order to CLOB. `success=undefined, orderID=<missing>` rejections drop to zero in Loki on candidate-a."
spec_refs:
  - poly-copy-trade-phase1
assignees: derekg1729
credit:
project: proj.poly-copy-trading
branch: fix/bug-0342-poly-clob-dynamic-min-order-size
pr:
reviewer:
revision: 0
blocked_by:
created: 2026-04-20
updated: 2026-04-20
labels: [poly, polymarket, copy-trading, clob, candidate-a]
external_refs:
  - packages/market-provider/src/adapters/polymarket/polymarket.clob.adapter.ts
  - nodes/poly/app/src/bootstrap/jobs/copy-trade-mirror.job.ts
  - nodes/poly/app/src/features/copy-trade/mirror-coordinator.ts
---

# poly copy-trade places sub-min orders — CLOB rejects silently

> Surfaced during candidate-a validation of PR #962 (bug.0339) on 2026-04-20 22:32 UTC. The operator wallet `0x7A3347…0aEB` tried to mirror a $1 BUY on "Will CA Vélez Sarsfield win on 2026-04-20?" at price 0.64; CLOB returned `{}`. Target wallet `0x37c1874a…`, client_order_id `0x21c77033…`, target_id `65a48f44-be04-52a9-bc8d-df55a94fb6a8`.

## Reproducer

1. POST a tracked wallet via `/api/v1/poly/copy-trade/targets` (defaults apply: `mirror_usdc=1`).
2. Target wallet fills a BUY on any market with `orderMinSize >= 2` shares at price `p` such that `1/p < orderMinSize` (i.e. ~all top-volume markets as of 2026-04-20).
3. Mirror-coordinator emits `poly.mirror.decision outcome=error reason=placement_failed`.
4. Loki: `{namespace="cogni-candidate-a"} |~ "CLOB rejected order" |~ "success=undefined"` returns one line per failed mirror.

## Evidence (live)

```
22:32:04.540  copy-trade-executor  execute: start           client_order_id=0x21c7703307…
22:32:04.540  poly-clob-adapter    placeOrder: start        size_usdc=1  limit_price=0.64  side=BUY
22:32:05.845  poly-clob-adapter    placeOrder: rejected     duration=1305ms
                                     error: "CLOB rejected order (success=undefined, orderID=<missing>, errorMsg=\"\")"
22:32:05.846  copy-trade-executor  execute: rejected
22:32:05.861  mirror-coordinator   poly.mirror.decision  outcome=error  reason=placement_failed
# all subsequent ticks (22:32:34, 22:33:04, 22:33:34, …)
                                   poly.mirror.decision  outcome=skipped  reason=already_placed
```

Market: `gamma-api.polymarket.com/markets?condition_ids=0x5438c021…` → `orderMinSize: 5`, `orderPriceMinTickSize: 0.01`. Sampled 20 top-volume markets on 2026-04-20: **all** returned `orderMinSize: 5`. User reports older markets were $1-min → threshold appears to have tightened recently.

## Root cause

Two gaps compose:

1. **Adapter doesn't pre-flight size**. `PolymarketClobAdapter.placeOrder` (`packages/market-provider/src/adapters/polymarket/polymarket.clob.adapter.ts`) fetches `tickSize`, `negRisk`, `feeRateBps` from the CLOB client but never pulls `orderMinSize`. Any below-min intent goes straight to `createAndPostOrder`.
2. **CLOB rejects size violations with empty body**. The SDK (`@polymarket/clob-client.createAndPostOrder`) returns `{}` for below-min orders — no `success`, no `orderID`, no `errorMsg`. Our adapter's B2 branch fires `success=undefined, orderID=<missing>, errorMsg=""` — accurate description, but opaque to ops + missing a stable error code.

`buildMirrorTargetConfig` (`nodes/poly/app/src/bootstrap/jobs/copy-trade-mirror.job.ts:72`) hardcodes `mirror_usdc: 1` — a defensible scaffolding default but now unconditionally sub-min on top-volume markets.

Note: `orderMinSize` is in **shares**, not USDC. Effective USDC minimum = `orderMinSize × limit_price`. A 5-share-min market is $5 min at price 1.0, $0.50 min at price 0.10, and $0.05 min at price 0.01.

## Design sketch — two viable paths

Both add a pre-flight step in the mirror-coordinator (before `placeIntent`) that reads `orderMinSize` for the token's market. They differ in what happens on a below-min intent.

**Option A — Skip, never overbet** (safest, loses trades):

```ts
const minUsdc = market.orderMinSize * intent.limit_price;
if (intent.size_usdc < minUsdc) return decision("skipped", "below_market_min");
```

- Zero risk of unexpected spend.
- User configured $1 → never bets more than $1.
- Cost: misses every fill on a 5-share-min market whenever config < market min. In today's market landscape, that's almost every copy-trade.

**Option B — Scale up to min, bounded by explicit ceiling** (user-opt-in):

Add `max_usdc_per_trade` to `TargetConfig` (default = `mirror_usdc`, i.e. "no scaling unless user opts in"). Pre-flight:

```ts
const minUsdc = market.orderMinSize * intent.limit_price;
const effective = Math.max(intent.size_usdc, Math.ceil(minUsdc * 100) / 100);
if (effective > target.max_usdc_per_trade) return decision("skipped", "above_user_ceiling");
intent.size_usdc = effective;
```

- User knows their ceiling. Defaulting `max_usdc_per_trade === mirror_usdc` preserves current "only bet $N" behavior for existing targets (they just skip instead of failing).
- New targets can opt in to scaling by setting `max_usdc_per_trade > mirror_usdc` in their POST body.
- Obeys `max_daily_usdc` unchanged.

Recommend **Option B** — it's what "dynamic min bet" means, and the explicit ceiling is the safety rail.

## Not in scope

- Adapter-level retry on empty CLOB response. The empty body IS the reject signal; pre-flight eliminates the need.
- Reading `orderMinSize` from CLOB (`/markets/{conditionId}`) vs Gamma. Gamma is our existing seam; use it.
- Raising `MIRROR_USDC` default. That's a band-aid — still fails on $10+ markets, breaks the "only risk $1" promise.
- Changing `poly_copy_trade_decisions` schema. New `reason` codes fit the existing `reason TEXT` field.

## Validation

- **exercise**: Two agents follow the same high-volume target wallet (e.g. rank-1 DAY volume leaderboard trader) on candidate-a; target fills a BUY at `p=0.64` on a 5-share-min market. Agent A keeps `max_usdc_per_trade === mirror_usdc = 1` (opt-out). Agent B sets `max_usdc_per_trade = 5` (opt-in to scaling).
- **observability**:
  - `{namespace="cogni-candidate-a"} |~ "CLOB rejected order" |~ "success=undefined"` returns zero lines at the deployed SHA.
  - Agent A: `poly.mirror.decision outcome=skipped reason=below_market_min` with `userId=<agent-A>`.
  - Agent B: `placeOrder: ok` with `filled_size_usdc >= 3.20` (5 shares × 0.64), `userId=<agent-B>` on the envelope.
