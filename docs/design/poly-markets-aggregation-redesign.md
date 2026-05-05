---
id: poly-markets-aggregation-redesign
type: design
title: "Poly Dashboard — Markets Aggregation Redesign"
status: needs_review
created: 2026-05-05
updated: 2026-05-05
supersedes: poly-dashboard-market-aggregation.md
---

# Poly Dashboard — Markets Aggregation Redesign

## TL;DR

Today's Markets table (image-v5) lets a user spot that they hold position
$X in a market a target also holds — but it does **not** let them
answer the three questions that matter:

1. Which market is bleeding the most alpha right now?
2. Is the bleed a return-rate gap (we picked badly) or a size gap (we
   under-deployed)?
3. When did the gap open, and which trade(s) drove it?

This brief proposes:

- A **two-axis** comparison metric — separate **per-share return %** from
  **size-scaled dollar gap on our position** — replacing today's single
  `edgeGapPct` denominated by _our_ (often tiny) cost basis.
- A **portfolio strip + table-with-bento-expansion** layout, where the
  expansion embeds the same chart shape from the Research P/L tab
  (image-v4) scoped to one condition.
- One **net-new SQL aggregate endpoint** for the per-market P/L series.
  Replaces the current `WalletExecutionMarketGroup.edgeGapPct` semantics
  in place — no v2 contract.

The math, the visual shape, and the drill-down are all chosen to make the
3-question scan resolvable in **<10 seconds without scrolling**.

> **Status: needs_review.** Do not implement until Derek signs off on
> §3 (the formula), §4 (the visual), and §6 (open questions).

---

## 1. What's broken today

Walking image-v5 against the 3 questions:

### Q1 (worst-bleeding market): unanswerable

Top row: `EPL CHE NOT` — Our value $0.00, Target value $408,065,
edgeGap = **−1,750,709.9%**. The number is a divide-by-near-zero artifact.
It bubbles to the top of the sort but tells the trader nothing
they can act on (we have no exposure on that line; the gap is just an
artifact of cost-basis rounding).

The next row: `UCL ARS Atm1` — edge gap −82,362.9%. Also unactionable in
the same way.

Meanwhile, deep in the body, a row like `Spread: Arsenal FC (-2.5)`
shows our $22.99 vs target $4.12 — _our_ size is bigger here — and gets
an edge gap of +51.9%. A trader scanning top-to-bottom **never sees
the actually-meaningful comparisons** because they're sorted last.

**Root cause**: `edgeGapPct = (targetPnl − ourPnl) / |ourCostBasis|`.
When `ourCostBasis ≈ 0`, the percentage explodes; when target's exposure
is 850× ours, the dollar numerator is huge while the denominator is small.
The denominator and numerator describe different traders' books.

### Q2 (return gap vs size noise): not separable

Today, all evidence collapses into the single column `Edge Gap`. There's
no way to tell whether a +700% gap is "target picked the right side
and we picked the wrong one" (information we should act on by adjusting
copy policy) versus "target deployed 100× our cost basis, we just
rode the same direction with a tenth of the size" (information that
either copy-policy bet-sizing should fix, or simply isn't a bug).

### Q3 (when did the gap open): no time axis at all

The expanded sub-table is dense numbers, no chart, no timestamps beyond
"last observed at". The trader cannot localize the divergence in time,
let alone associate it with a specific fill.

### Secondary issues

- **Mixed-shape columns**: `Targets` shows current _value_, `P/L` shows
  our _delta_. Eye has to context-switch.
- **4-orders-of-magnitude** dollar columns ($0.12 next to $50,580) make
  alignment + visual comparison meaningless. The eye gives up.
- The `Alpha leak only` toggle is the single useful filter, but it gates
  on `pnl<0 AND targetPnl>0` — it misses "we made +$5 but target made
  +$5,000" which is the real alpha leak.

---

## 2. The 3 questions, restated as design constraints

| Q   | Need to surface                                            | Type of answer                                                                    |
| --- | ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1   | "Which market is most underperforming the targets I copy?" | **Single sortable scalar** with comparable units across all markets.              |
| 2   | "Is the gap return-rate or size?"                          | **Two scalars side-by-side**: rate-gap (independent of size) + size-scaled $ gap. |
| 3   | "When did the gap open?"                                   | **Time-axis chart** for one (condition × my-wallet × target-wallet[]).            |

Plus a non-negotiable constraint inherited from the user contract:
**dollar magnitudes must stay comparable to our portfolio**, not to
target's whale book. Showing target's $50k position alongside our $50
position is fine — but the _gap_ metric must be denominated in _our_
size, otherwise it's not actionable.

---

## 3. The math: normalized return + size-scaled dollar gap

> This is the section most likely to break in edge cases. Reviewing this
> first — before the visual — is intentional.

### 3.1 Return-rate definition: cost-basis-deployed return

For one (wallet, condition):

```
positionReturnPct
  = (realizedCash + currentMarkValue − totalBuyNotional) / totalBuyNotional
  where:
    totalBuyNotional  = SUM(size_usdc) over poly_*_fills WHERE side='BUY'
    realizedCash      = SUM(size_usdc) over fills WHERE side='SELL'
    currentMarkValue  = SUM over open legs of (shares × current_price)
```

This is the **Modified-Dietz-style return** with the simplification that
`V_begin = 0` (we never carry an existing position into a copy-trade
condition). It treats every BUY as committed capital and never
double-counts when SELL recovers some of it.

For a copy-target the same formula applies — they're a wallet running
their own (uncoordinated) buys+sells. Both sides become commensurable.

### 3.2 Edge-gap definition: rate-gap + size-scaled $ gap

```
rateGapPct        = targetPositionReturnPct − ourPositionReturnPct
sizeScaledGapUsdc = rateGapPct × ourTotalBuyNotional
```

**Sign convention** (one rule for the whole UI): positive = target
ahead = alpha leaking from me; negative = we're ahead. The descending
sort surfaces the worst leaks at the top of the table without
ambiguity. Every cell, tooltip, and chart axis must follow this
direction or the user will second-guess the sign on every glance.

`rateGapPct` answers Q2-rate. Independent of either trader's size —
purely "did we pick the right side at the right price?".

`sizeScaledGapUsdc` answers Q1 + Q2-size. Denominated in **our**
position size: "if we had matched target's rate of return on our own
capital, we'd be ahead by $X." Stays bounded — for our $74 cost
basis, the max plausible gap is a few hundred dollars, never $1.7M.

> **Q1 sortable column = `sizeScaledGapUsdc`**, descending. Largest
> alpha leak in our actual book, top of the list.

### 3.3 Worked examples

> Notation: `B(n@p)` = BUY n shares at price p (USDC),
> `S(n@p)` = SELL n shares at p, `M(p)` = mark price now.

#### A. Simple long, still open

```
Our:    B(100@0.50) ; M(0.65)
totalBuyNotional   = 100 × 0.50 = $50
realizedCash       = 0
currentMarkValue   = 100 × 0.65 = $65
positionReturnPct  = (0 + 65 − 50) / 50 = +30.0%
```

#### B. Partial close

```
Our:    B(100@0.50) ; S(60@0.60) ; M(0.65)
totalBuyNotional   = $50
realizedCash       = 60 × 0.60 = $36
currentMarkValue   = 40 × 0.65 = $26
positionReturnPct  = (36 + 26 − 50) / 50 = +24.0%
```

Sanity-check: the trader is up $12 on $50 deployed → 24% ✓.
The naive `pnl/costBasis` formula on the snapshot path would
compute `(remaining_cost_basis_open = 40 × 0.50 = $20, mark = $26,
unrealized_pnl = $6) → 30%` and silently lose the realized leg.

#### C. Hedged position

```
Our:    B(50@0.50) on YES ; B(30@0.55) on NO ; M_yes(0.65), M_no(0.35)
totalBuyNotional   = 50×0.50 + 30×0.55 = $25 + $16.50 = $41.50
realizedCash       = 0
currentMarkValue   = 50×0.65 + 30×0.35 = $32.50 + $10.50 = $43.00
positionReturnPct  = (0 + 43.00 − 41.50) / 41.50 = +3.6%
```

Both legs aggregated in the _same_ condition — the formula stays a
single scalar, no special hedge handling. That's the point: we sum
fills first, divide once.

#### D. Paired us-vs-target with full edge-gap math

Same condition `XYZ`. Our wallet and one target both traded it.

```
Our:    B(40@0.50) ; B(60@0.55) ; M(0.62)
        totalBuyNotional   = 20 + 33 = $53
        realizedCash       = 0
        currentMarkValue   = 100 × 0.62 = $62
        ourReturnPct       = (0 + 62 − 53) / 53 = +17.0%

Target: B(800@0.45) ; B(1200@0.48) ; M(0.62)
        totalBuyNotional   = 360 + 576 = $936
        realizedCash       = 0
        currentMarkValue   = 2000 × 0.62 = $1,240
        targetReturnPct    = (0 + 1240 − 936) / 936 = +32.5%

rateGapPct          = +32.5% − +17.0% = +15.5pp     (target ahead)
sizeScaledGapUsdc   = +15.5% × $53     = +$8.22     (cost on our book)
```

Reading: target picked the same side at meaningfully better entries
(VWAP 0.468 vs ours 0.530); on **our** $53 deployment that's an
$8.22 unrealized leak, even though target's absolute book is 18× ours.
The dollar gap stays in our scale; the percentage gap surfaces the
pick-quality story.

#### E. Multi-fill at varying prices (averaging up, then closing)

```
Our:    B(40@0.50) ; B(60@0.55) ; S(50@0.62) ; M(0.58)
totalBuyNotional   = 40×0.50 + 60×0.55 = $20 + $33 = $53
realizedCash       = 50×0.62 = $31
currentMarkValue   = 50×0.58 = $29       (40+60−50 = 50 shares open)
positionReturnPct  = (31 + 29 − 53) / 53 = +13.2%
```

VWAP-based formulas would conflate the pre-close vs post-close avg
price; this one doesn't because it walks total-in vs total-out.

> **UI label**: per row, this metric is "**round-trip USDC return on
> this condition**" in tooltips. A perfectly-hedged 50/50 position
> resolves to ~0% by this formula even when both legs were "correct"
> picks (Example C); the tooltip prevents the user from misreading
> 0% as bad pick-quality. The participants grid in the bento expansion
> still shows per-leg returns for full transparency.

#### F. Edge cases

- **Zero buy notional** (`totalBuyNotional = 0`): formula is undefined.
  Render `—` in UI; never `Infinity` or `NaN`. Both
  `positionReturnPct` and `rateGapPct` must be `null` for that row.
- **All-sold-out closed position with PnL**: same formula works
  (`currentMarkValue = 0`, `totalBuyNotional > 0`).
- **SELL-only fills (impossible in a buy-only-funded copy-trade
  position)**: would produce `totalBuyNotional = 0`. Treat as data bug;
  log warning, surface row with null metrics.
- **Currency rounding**: `numeric(20,8)` in fills, `numeric(18,8)` for
  prices. Round the final percentage to 4 decimals (matches today's
  `roundPrice`). Round dollars to 2.

### 3.4 What stays in `WalletExecutionMarketGroup`

Replaced (in place — no v2 contract):

```diff
- edgeGapUsdc:  number | null   /* targetPnl − ourPnl */
- edgeGapPct:   number | null   /* edgeGapUsdc / |ourCostBasis| */
+ ourReturnPct:        number | null   /* §3.1 */
+ targetReturnPct:     number | null   /* §3.1, weighted across active targets — see §3.5 */
+ rateGapPct:          number | null   /* §3.2 */
+ sizeScaledGapUsdc:   number | null   /* §3.2 */
```

The legacy fields are dropped, not deprecated — per CLAUDE.md
"No v2 contract for an app with no users."

### 3.5 Multi-target weighting

A market may have multiple active copy-targets. We need a single
`targetReturnPct` per (wallet × condition) for the headline cell.

Proposed: **cost-basis-weighted average across active targets**:

```
targetReturnPct
  = SUM over active targets of (target_buy_notional × target_returnPct)
  / SUM over active targets of (target_buy_notional)
```

Rationale: matches "what return would I have gotten if I copied
_every_ active target proportional to their conviction." Caveat in §6
open questions.

**Worked example (2 targets, divergent outcomes):**

```
Target A: totalBuyNotional = $400, returnPct = +30%   (the winner)
Target B: totalBuyNotional = $100, returnPct = −20%   (the loser)

targetReturnPct (blended)
  = (400 × 0.30 + 100 × (−0.20)) / (400 + 100)
  = (120 − 20) / 500
  = +20.0%
```

The blended cell tells the table user "the wallets I copy averaged
+20% on this market, weighted by their conviction." The bento
expansion (§4.4) **must** show A and B separately so the user can
see the +30% / −20% split — otherwise the headline silently hides a
target that picked badly. Per-target rows in the participants grid
already do this; we just need to surface their individual `returnPct`
columns alongside the existing leg breakdown.

---

## 4. Visual shape: portfolio strip + bento expansion

### 4.1 Why not the alternatives

- **Cards**: forfeits sortability + keyboard-driven scan. Fails Q1.
- **Pivot grid (markets × wallets)**: too sparse — most copy targets
  trade no markets we hold; matrix would be 90% empty.
- **Side-by-side wallet columns**: today's hedge-table-inside-the-table
  is exactly this and it's image-v5. Doesn't scale past 2 traders.
- **Just bento dashboards**: loses density; can't compare 30+ markets.

We keep the **table-as-spine** and add a **chart-in-expansion** so each
market gets an in-place narrative. Tables and charts each do the part
they're good at.

### 4.2 Wireframe (ASCII; designer can ignore styling)

```
┌─ MARKETS ──────────────────────────────────────────────────────────────┐
│                                                                        │
│ ┌─ Portfolio strip ────────────────────────────────────────────────┐  │
│ │ Our return    Target-blend    Rate gap    Size-scaled $ gap      │  │
│ │  +12.4%        +18.7%          +6.3%       +$184.20              │  │
│ │  on $1,847     blend of 3      ↘ alpha     on our book           │  │
│ │  deployed      targets         leaking      (positive = leak)    │  │
│ └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│ [filters]  [Alpha leak only ▾]  [Rate-gap > 5% ▾]  [Live only ▾]      │
│                                                                        │
│ ┌──────────────────────────────────────────────────────────────────┐  │
│ │ Market           Our  Tgt   Our    Tgt     Rate    $ gap        │  │
│ │                  $    $     ret%   ret%    gap     on us         │  │
│ │ ──────────────────────────────────────────────────────────────── │  │
│ │ ▼ ARS-ATM 0/0  $74  $184k  +2.1%  +43.1%  +41.0% +$30.34       │  │
│ │   ┌──────────────────────────────────────────────────────────┐  │  │
│ │   │  Cumulative return % over time, scoped to this market    │  │  │
│ │   │                                ╱─── target +43%          │  │  │
│ │   │                          ╱────╯                          │  │  │
│ │   │   ────────────────────╯  ▲ target BUY 50 sh @0.62        │  │  │
│ │   │  ●─────●  us +2%        ▼ us BUY 80 sh @0.71             │  │  │
│ │   │  Apr 28  Apr 30  May 1   May 3   May 5                   │  │  │
│ │   │  participants table (existing) under chart               │  │  │
│ │   └──────────────────────────────────────────────────────────┘  │  │
│ │                                                                  │  │
│ │ ▶ NBA MIN SAS    $76  $48k  +24%   +18%    −6.0%  −$4.56        │  │
│ │ ▶ MLB CIN/SF    $13   $0    +12%   —       —      —             │  │
│ │ ▶ ...                                                            │  │
│ └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘

Sort: descending by `$ gap on us` (column 7), so the top row is the
worst alpha leak (positive = target ahead). NBA MIN SAS sorts below
because we're ahead of target there (negative gap).
```

### 4.3 Walking the 3 questions on this wireframe

**Q1 — "which is bleeding most"?**
Sort the table by `$ gap on us` desc (default). Top row is
`ARS-ATM 0/0` at +$30.34 (positive = target ahead = leak).
The user reads one row, zero scrolling.
**Time to answer: ~2 seconds.**

**Q2 — "rate gap or size noise?"**
Same row exposes both:

- `Rate gap +41pp` says target had a 41-percentage-point better
  return on the same market. Big pick-quality signal.
- `$ gap on us +$30.34` says on _our_ deployment ($74) the rate gap
  cost us thirty bucks.
  Both columns are sortable; eye reads them adjacent. No extra glyph.
  **Time to answer: ~5 seconds.**

**Q3 — "when did the gap open?"**
Click the row chevron. The mini-chart shows target's cumulative P/L
diverging from ours; the eye finds the slope discontinuity instantly
(in the wireframe, around May 3). Entry-marker triangles pin the
divergence to a specific BUY by the target before our matching one.
**Time to answer: ~7 seconds.**

### 4.4 Visual rules

- **One denominated number per row** ($ gap on us). No mixing portfolio
  scales across rows; everything is "what does this cost me, on my
  book."
- **Two return-rate cells** (`ourReturn%`, `targetReturn%`) shown
  side-by-side with identical formatting; the eye computes the gap
  visually, the `Rate gap` column makes it numeric.
- **Total $ exposure** (`Our $`, `Tgt $`) stays in the table for
  context but **never participates in the gap math**. Their job is to
  explain why we're not bigger, not to be summed/diffed.
- **Dollar columns right-aligned, tabular-nums, abbreviated** (`$48k`
  not `$48,650.97`) so 4-orders-of-magnitude rows still align.
- **Status badge** (Live/Closed) and **Hedges count** stay, demoted
  to tertiary columns; toggled off by default.

---

## 5. Drill-down: embed the Research P/L chart, scoped to one condition

### 5.1 Decision: extend, don't fork

Image-v4's chart is loved because it's the simplest possible "who's
ahead over time" visual. Recreating that semantic for one market is
exactly the right answer to Q3 — same idiom, different scope.

We **lift the existing chart** (`features/wallet-analysis/components/
TraderComparisonPnlChart` or similar — TBD on exact name; module is
under `features/wallet-analysis`) into a presentational component
that takes `series: { label, points: { ts, pnlUsdc }[] }[]` as input.
The Research view continues to feed it wallet-scoped series. The
Markets-table expansion feeds it condition-scoped series.

### 5.2 Net-new endpoint

```
GET /api/v1/poly/wallet/market-pnl-history
  ?conditionId=…
  &wallet=…&wallet=…&wallet=…   (1-N, capped at 4: us + 3 targets)
  &interval=1D|1W|1M|ALL
→ {
    conditionId: string,
    capturedAt: string,
    series: [
      { walletAddress, label, points: [{ ts, cumulativeReturnPct }] }
    ],
    events: [
      { walletAddress, ts, kind: 'entry'|'add'|'reduce'|'close', price, shares }
    ],
    warnings: [{ code, message }]
  }
```

**Chart denominator: %, not $.** The series y-axis is
`cumulativeReturnPct` — same %-unit as every other comparison cell in
the table and portfolio strip. Mixing $ on the chart with % in the
table reintroduces the cross-row scale mixing this brief is fixing
(image-v5's symptom), so the chart commits to the same axis as the
sortable column. Per-point math:

```
cumulativeReturnPct(t)
  = (cumulativeRealizedCash(t) + currentMarkValue(t) − cumulativeBuyNotional(t))
  / cumulativeBuyNotional(t)
```

i.e. §3.1 evaluated at each bucket boundary, where each cumulative is
a running sum-up-to-`t` over the wallet's fills and the latest
snapshot for the open shares' mark.

**Tenant scoping (REQUIRED).** This endpoint reads
`poly_trader_fills` and `poly_trader_position_snapshots` — the same
tables as `/wallet/execution`, which already gates by
`billingAccountId` against `poly_copy_trade_targets`. Any new endpoint
**must apply the same gate** to avoid a wallet-state read leak:

- `wallet=` MUST be either (a) the caller's own configured trading
  wallet (per `polyTraderWallets`), or (b) a wallet listed in
  `poly_copy_trade_targets` with `billing_account_id = caller` AND
  `disabled_at IS NULL`. Any other wallet returns 403.
- The handler validates the param set **before** issuing the SQL,
  so an attacker probing `?wallet=arbitrary_addr` never reaches the
  data plane.
- Test: the partial-failure path (one of three wallets is invalid)
  returns 200 with the valid series + a `warnings[]` entry on the
  rejected wallet — never leaks the rejected wallet's data and never
  throws.

Contract file: `poly.wallet.market-pnl.v1.contract.ts`. Standard
research-route shape — Zod request + response, partial-failure-200
with warnings, never throws to the user.

### 5.3 Backing query (SQL aggregation per data-research skill)

For each (wallet, condition):

```sql
WITH bucketed AS (
  SELECT
    s.trader_wallet_id,
    date_trunc('hour', s.captured_at) AS ts,
    s.token_id,
    -- last snapshot per (token_id, hour): we want point-in-time
    -- mark-to-market value, not a sum of the day's overwrites
    last_value(s.current_value_usdc - s.cost_basis_usdc)
      OVER (
        PARTITION BY s.trader_wallet_id, s.token_id, date_trunc('hour', s.captured_at)
        ORDER BY s.captured_at
        ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
      ) AS leg_pnl
  FROM poly_trader_position_snapshots s
  WHERE s.condition_id = $1
    AND s.trader_wallet_id = ANY($2)
    AND s.captured_at >= now() - $3::interval
)
SELECT trader_wallet_id, ts, SUM(leg_pnl) AS pnl_usdc
FROM bucketed
GROUP BY trader_wallet_id, ts
ORDER BY trader_wallet_id, ts;
```

- **Bounded by hours-in-window × wallet-count**, not by fill count.
  Tier-0 worst case: 30d × 24h × 4 wallets ≈ 2,880 rows. V8 hydrates
  these comfortably.
- **Driven by an index** (`poly_trader_position_snapshots_latest_idx`
  on `(trader_wallet_id, captured_at)`); EXPLAIN ANALYZE attached to
  PR per data-research skill §3.
- The query above is a placeholder — the actual %-cumulative shape
  needs `cumulativeBuyNotional(t)` from `poly_trader_fills` joined
  to the snapshot's mark; a full draft follows in PR-A's SQL plan
  once the §6.3 spike validates the snapshot-driven path.
- **`events` array**: sourced from `poly_trader_fills` filtered to the
  same condition. Bounded **by the requested interval** (`WHERE
observed_at >= now() − $interval`), not by a hard row cap; a 30-day
  window with 100 fills/day × 4 wallets ≈ 12k events still fits
  comfortably in a single response (≈600 KB JSON), and capping at 200
  silently drops the events array's value when activity is high. If
  any future caller starts hitting outliers >50k, add server-side
  decimation (sample 1-of-N per bucket) — not truncation.

If the snapshot density isn't fine-grained enough for sub-hour
divergence, we can fall back to joining `poly_trader_fills` ×
`poly_market_price_history` (mark-to-market reconstruction). Open
question — see §6.

### 5.4 Why **not** a separate `/research/market-comparison` page

A new dedicated page forces the user to switch context to answer Q3
("when did the gap open"). The whole point of the Markets table is to
_be_ the one place that holds market-level comparative intelligence.
Drill-down lives in-place; deep research keeps living on `/research`.

---

## 6. Open questions for Derek

These are the calls I won't make alone. Tagging the section number
that's in play.

1. **§3.5 Multi-target weighting**: cost-basis-weighted is one of three
   defensible choices. Alternatives:
   - Simple mean (every target counted equally — penalizes whales).
   - Best-target-only (`max(targetReturnPct)` — answers "did anyone we
     copy crush this?" but is noisier).
   - **Recommendation: cost-basis-weighted.**
2. **§3.1 What counts as `totalBuyNotional` for hedged positions across
   _both legs_?** Proposal in §3.3-C is to sum across legs (treat the
   condition as one bucket). Alternative: separate primary-vs-hedge
   returns. The former is cleaner; the latter preserves the existing
   `primary`/`hedge` UX. **Recommendation: sum across legs at the
   metric level; keep per-leg UI in the participants table for
   transparency.**
3. **§5.3 Snapshot density vs fills × prices reconstruction**: if
   snapshots are written only on change, sparse-trading days won't
   show the chart. Need to spot-check candidate-a's snapshot cadence
   on a real condition before committing.
4. **§4.2 What is the right default sort?** Proposed `sizeScaledGapUsd`
   desc. Alternative: `rateGapPct` desc (treats every market equally
   regardless of our deployment). I lean `sizeScaledGapUsd` because it
   matches "what's costing me the most" rather than "where's my
   pick-quality the worst" — the trader-action gradient is steeper on
   the former.
5. **§4.4 Closed-positions inclusion**: today's `Status` filter
   distinguishes Live vs Closed. For redesign, should closed positions
   show `realizedReturnPct` (final outcome) and stay sortable, or move
   to a History sub-tab? **Recommendation: keep them in-table with a
   default "Live only" filter** so the user can flip between
   "what's bleeding now" and "what bled last week."
6. **§3.2 Negative cost basis**: a target that started a position
   pre-snapshot-window then closed inside it could have negative
   `currentMarkValue − totalBuyNotional` with very small denominator.
   We backfill from `poly_trader_fills` not snapshots — but is the
   fills table guaranteed to span the same window snapshots cover?
   **Spike before implementation.**
7. **Naming**: `rateGapPct` and `sizeScaledGapUsdc` vs just
   `edgeGapPct` (redefined) and `edgeGapUsdc` (redefined)? The
   semantics are different from today's so I'd argue for new names —
   a re-used name with new math is exactly the metric drift the
   data-research skill warns about.

---

## 7. Implementation scoping (after this brief is reviewed)

Three PRs, in order. Each is independently shippable.

> **PR-A scope clarification (per review).** "Drop the legacy fields,
> no UI change" was contradictory: `MarketsTable.tsx`, `columns.tsx`,
> `isAlphaLeak`, and `markets-table-alpha-leak.test.ts` all reference
> `edgeGapUsdc`/`edgeGapPct` — dropping them without UI work breaks
> the build. Per AGENTS.md "purge legacy in place," PR A folds in the
> **minimum UI rename** to keep the tree compiling: rename the
> `Edge Gap` column to `Rate gap` + add the `$ gap on us` column,
> using the new fields with new math. Layout stays as-is (no
> portfolio strip, no chart). PR B is then **layout-only**, free of
> contract risk.

1. **PR A — Math + contract surface + minimum UI rename.**
   - Replace `edgeGapUsdc`/`edgeGapPct` in
     `poly.wallet.execution.v1.contract.ts` with the four new fields
     (§3.4).
   - Implement SQL aggregation in `market-exposure-service.ts`: join
     `poly_copy_trade_fills` for our buy notional + `poly_trader_fills`
     for target buy notional, evaluated against §3.1's formula.
   - Update `MarketsTable.tsx` columns: rename the `Edge Gap` column
     to `Rate gap` (`rateGapPct`), add `$ gap on us`
     (`sizeScaledGapUsdc`) as the new default sort column (desc).
   - Rewrite `isAlphaLeak` against the new fields (positive
     `sizeScaledGapUsdc` AND positive `rateGapPct` ≥ a threshold —
     resurfaces the "we made +$5, target made +$5,000" leaks the
     current predicate misses).
   - Update `markets-table-alpha-leak.test.ts` to match. Parity test
     per data-research skill §5 on synthetic wallets covering
     Examples A–F from §3.3.

2. **PR B — Visual redesign (layout-only).** Portfolio strip header,
   bento expansion shell, two-axis column reordering, dollar
   abbreviation rule (`$48k` not `$48,650.97`). No new fields, no
   new endpoints — pure component-tree refactor against the contract
   PR A landed.

3. **PR C — Drill-down chart.** New endpoint
   `/api/v1/poly/wallet/market-pnl-history` (per §5.2, %-denominated
   series, tenant-scoped), new contract
   `poly.wallet.market-pnl.v1.contract.ts`, lift the existing
   Research P/L chart into a presentational component shared between
   `/research` and the Markets-bento expansion.

Each PR ends in `/validate-candidate` per AGENTS.md.

**Pre-PR-A blockers**:

- §6.3 + §6.6 spikes (snapshot density + fills-window backfill)
  must run on candidate-a, results recorded in §9 of this brief,
  before PR A starts. If snapshots are sparse-on-quiet-days the
  whole snapshot-driven SQL falls back to fills × price-history
  reconstruction — different SQL, different EXPLAIN profile.

---

## 9. Spike status (review pre-PR-A blocker)

| Spike                                                                    | §ref | Status                                             |
| ------------------------------------------------------------------------ | ---- | -------------------------------------------------- |
| Snapshot density per (trader, condition) per hour, 24h + 7d distribution | §6.3 | **BLOCKED on candidate-a credentials** — see below |
| Fills-vs-snapshots time-window coverage per active (trader, condition)   | §6.6 | **BLOCKED on candidate-a credentials** — see below |

**SQL queries to run** (read-only, drafted by the spike subagent against
`docs/guides/poly-target-backfill.md`'s runbook):

```sql
-- §6.3 — snapshot density distribution, last 24h
WITH hourly_buckets AS (
  SELECT trader_wallet_id, condition_id,
         DATE_TRUNC('hour', captured_at) AS hour,
         COUNT(*) AS snapshots_in_hour
  FROM poly_trader_position_snapshots
  WHERE captured_at >= NOW() - INTERVAL '24 hours'
  GROUP BY trader_wallet_id, condition_id, DATE_TRUNC('hour', captured_at)
)
SELECT
  MIN(snapshots_in_hour)                                              AS min_per_hour,
  PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY snapshots_in_hour)     AS p25,
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY snapshots_in_hour)     AS p50,
  PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY snapshots_in_hour)     AS p75,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY snapshots_in_hour)     AS p99,
  MAX(snapshots_in_hour)                                              AS max_per_hour,
  COUNT(*) FILTER (WHERE snapshots_in_hour = 0)                       AS zero_buckets,
  COUNT(*)                                                            AS total_buckets
FROM hourly_buckets;

-- Repeat with INTERVAL '7 days' for sparser-period sanity check.

-- §6.6 — fills-vs-snapshots backfill coverage
SELECT
  w.id AS trader_wallet_id,
  w.wallet_address,
  (SELECT MIN(observed_at) FROM poly_trader_fills WHERE trader_wallet_id = w.id)
    AS earliest_fill,
  (SELECT MIN(captured_at) FROM poly_trader_position_snapshots WHERE trader_wallet_id = w.id)
    AS earliest_snapshot,
  CASE
    WHEN (SELECT MIN(observed_at) FROM poly_trader_fills WHERE trader_wallet_id = w.id)
       < (SELECT MIN(captured_at) FROM poly_trader_position_snapshots WHERE trader_wallet_id = w.id)
    THEN 'BACKFILL_INCOMPLETE'
    ELSE 'OK'
  END AS coverage_status
FROM poly_trader_wallets w
WHERE EXISTS (
  SELECT 1 FROM poly_trader_current_positions
  WHERE trader_wallet_id = w.id AND active = true
)
ORDER BY earliest_fill;
```

**Runbook** (per `docs/guides/poly-target-backfill.md`):

```bash
# Terminal 1 (tunnel)
ssh -i ~/.local/candidate-a-vm-key -f -N -L 55433:localhost:5432 \
  root@$(cat ~/.local/candidate-a-vm-ip)

# Terminal 2 (query)
PGPASSWORD=$(grep POSTGRES_ROOT_PASSWORD ~/.env.canary | cut -d= -f2) \
  psql postgresql://postgres:$PGPASSWORD@localhost:55433/cogni_poly \
  -f docs/design/_spikes/poly-markets-aggregation-snapshot-density.sql
```

**Why this is a hard pre-PR-A blocker**: §3.1's
`positionReturnPct` over time depends on snapshots having sub-hour
density on at least the open-position window. If §6.3 returns
`p50 = 0` (more than half of (trader, condition, hour) buckets empty),
the snapshot-driven SQL plan in §5.3 isn't viable and the chart must
fall back to `poly_trader_fills` × `poly_market_price_history`
mark-to-market reconstruction. Different EXPLAIN profile, different
parity-test surface. Better to learn this before PR A locks in a
contract that assumes one shape.

**Decision tree once results are in**:

| `p50 zero_bucket %` | Plan                                                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| < 20%               | Snapshot-driven SQL (§5.3) is fine. Proceed PR A as scoped.                                                                                         |
| 20–60%              | Snapshot-driven for headline metric (open + close summary), fills-driven for the per-bucket chart. PR A unchanged; PR C uses fills × price-history. |
| > 60%               | Snapshots aren't dense enough for either. Whole brief gets a revision pass to re-anchor §3.1 on fills aggregation directly.                         |

## 8. Cross-references

- Existing design (this redesign supersedes): [`poly-dashboard-market-aggregation.md`](./poly-dashboard-market-aggregation.md)
- Hedge classification policy (still applies): [`poly-hedge-followup-policy.md`](./poly-hedge-followup-policy.md)
- Research P/L chart this redesign reuses: `nodes/poly/app/src/features/wallet-analysis/` (image-v4 in attachments)
- Service this rewrites: `nodes/poly/app/src/features/wallet-analysis/server/market-exposure-service.ts`
- Contract this rewrites: `nodes/poly/packages/node-contracts/src/poly.wallet.execution.v1.contract.ts`
- Data-research skill (governs SQL aggregation discipline): `.claude/skills/data-research/SKILL.md`
