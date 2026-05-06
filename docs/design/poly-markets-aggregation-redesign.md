---
id: poly-markets-aggregation-redesign
type: design
title: "Poly Dashboard — Markets Aggregation Redesign"
status: ready
created: 2026-05-05
updated: 2026-05-05
supersedes: poly-dashboard-market-aggregation.md
---

# Poly Dashboard — Markets Aggregation Redesign

## TL;DR

Today's Markets table (image-v5) shows that we hold a position alongside
a target — but it does **not** answer the three questions that matter:

1. Which market is bleeding the most alpha right now?
2. Is the bleed a return-rate gap (we picked badly) or a size gap?
3. When did the gap open, and which trade(s) drove it?

Two changes ship this:

- **Replace `edgeGapPct` with two metrics**: a size-independent
  `rateGapPct` and a `sizeScaledGapUsdc` denominated in **our** book.
  Solves Q1 + Q2.
- **Embed the existing Research P/L chart** in the row expansion,
  scoped to one condition by extending `/research/trader-comparison`
  with an optional `conditionId` param. Solves Q3. **No new endpoint.**

Scope: dashboard + query correctness. Backfill correctness is owned
elsewhere; this brief assumes whatever the DB has and degrades
gracefully when data is sparse.

---

## 1. What's broken today

Walking image-v5 against the 3 questions:

### Q1 (worst-bleeding market): unanswerable

Top row: `EPL CHE NOT` — Our value $0.00, Target value $408,065,
edgeGap = **−1,750,709.9%**. Divide-by-near-zero artifact. Bubbles to
the top of the sort and tells the trader nothing actionable.

`Spread: Arsenal FC (-2.5)` — meaningful row where _our_ size is
bigger — sorts last because the percentage there is small.

**Root cause**: `edgeGapPct = (targetPnl − ourPnl) / |ourCostBasis|`.
When `ourCostBasis ≈ 0` the percentage explodes; when target's
exposure is 850× ours, the numerator is huge and the denominator is
tiny. Numerator and denominator describe different traders' books.

### Q2 (return gap vs size noise): not separable

All evidence collapses into one column. No way to tell whether a
+700% gap is "target picked the right side and we didn't" or "target
deployed 100× our cost basis on the same side."

### Q3 (when did the gap open): no time axis

The expanded sub-table is dense numbers, no chart, no timestamps.

### Secondary

- **Mixed-shape columns**: `Targets` shows current _value_, `P/L` shows
  our _delta_ — eye context-switches.
- **4-orders-of-magnitude** dollar columns ($0.12 next to $50,580)
  defeat alignment + visual comparison.
- The `Alpha leak only` toggle gates on `pnl<0 AND targetPnl>0` —
  misses "we made +$5, target made +$5,000," which is the real leak.

---

## 2. The 3 questions, restated as design constraints

| Q   | Need to surface                         | Type of answer                                                                 |
| --- | --------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | "Which market is most underperforming?" | **Single sortable scalar**, comparable across markets.                         |
| 2   | "Rate gap or size?"                     | **Two scalars side-by-side**: rate-gap (size-independent) + size-scaled $ gap. |
| 3   | "When did the gap open?"                | **Time-axis chart** for one (condition × my-wallet × target-wallet[]).         |

Plus an inviolable constraint: **dollar magnitudes must stay
comparable to our portfolio**. Showing target's $50k position next to
our $50 is fine — but the _gap_ metric must be denominated in our
size, otherwise it's not actionable.

---

## 3. The math

### 3.1 Per-position return: cost-basis-deployed (Modified-Dietz, V_begin = 0)

For one (wallet, condition):

```
positionReturnPct
  = (realizedCash + currentMarkValue − totalBuyNotional) / totalBuyNotional

  totalBuyNotional  = SUM(size_usdc) over fills WHERE side='BUY'
  realizedCash      = SUM(size_usdc) over fills WHERE side='SELL'
  currentMarkValue  = SUM over open legs of (shares × current_price)
```

Treats every BUY as committed capital; SELL credits back without
double-counting. Same formula for our wallet and target — both
become commensurable. Pure function over fills + current marks; lives
in a pure module (no DB import) imported by the SQL service.

### 3.2 Edge gap: rate-gap + size-scaled $ gap

```
rateGapPct        = targetPositionReturnPct − ourPositionReturnPct
sizeScaledGapUsdc = rateGapPct × ourTotalBuyNotional
```

**Sign convention** (one rule): positive = target ahead = alpha
leaking from me; negative = we're ahead. Default sort: descending
on `sizeScaledGapUsdc` — top row is the worst leak in our book.

`rateGapPct` → Q2-rate (size-independent pick-quality signal).
`sizeScaledGapUsdc` → Q1 + Q2-size (denominated in our book; never
$1.7M garbage).

### 3.3 Worked examples

> Notation: `B(n@p)` = BUY n shares at price p (USDC),
> `S(n@p)` = SELL, `M(p)` = mark now.

#### A. Simple long, still open

```
Our:  B(100@0.50) ; M(0.65)
totalBuyNotional   = $50
realizedCash       = 0
currentMarkValue   = 100 × 0.65 = $65
positionReturnPct  = (0 + 65 − 50) / 50 = +30.0%
```

#### B. Partial close

```
Our:  B(100@0.50) ; S(60@0.60) ; M(0.65)
totalBuyNotional   = $50
realizedCash       = $36
currentMarkValue   = 40 × 0.65 = $26
positionReturnPct  = (36 + 26 − 50) / 50 = +24.0%
```

The naive `pnl/costBasis` over a snapshot would compute the open
leg's +30% and silently lose the realized leg.

#### C. Hedged position

```
Our:  B(50@0.50) on YES ; B(30@0.55) on NO ; M_yes=0.65, M_no=0.35
totalBuyNotional   = 25 + 16.50 = $41.50
realizedCash       = 0
currentMarkValue   = 32.50 + 10.50 = $43.00
positionReturnPct  = (0 + 43.00 − 41.50) / 41.50 = +3.6%
```

Both legs aggregated into one condition. Sum first, divide once.
No special hedge handling at the metric level. Per-leg rendering
stays in the participants grid.

#### D. Paired us-vs-target with full edge-gap math

Same condition `XYZ`. Our wallet and one target both traded it.

```
Our:    B(40@0.50) ; B(60@0.55) ; M(0.62)
        totalBuyNotional   = 20 + 33 = $53
        currentMarkValue   = 100 × 0.62 = $62
        ourReturnPct       = (0 + 62 − 53) / 53 = +17.0%

Target: B(800@0.45) ; B(1200@0.48) ; M(0.62)
        totalBuyNotional   = 360 + 576 = $936
        currentMarkValue   = 2000 × 0.62 = $1,240
        targetReturnPct    = (0 + 1240 − 936) / 936 = +32.5%

rateGapPct          = +32.5% − +17.0% = +15.5pp     (target ahead)
sizeScaledGapUsdc   = +15.5% × $53     = +$8.22     (cost on our book)
```

Target picked the same side at better entries (VWAP 0.468 vs ours
0.530); on **our** $53 deployment that's an $8.22 unrealized leak
even though target's book is 18× ours.

#### E. Multi-fill at varying prices, then partial close

```
Our:  B(40@0.50) ; B(60@0.55) ; S(50@0.62) ; M(0.58)
totalBuyNotional   = 20 + 33 = $53
realizedCash       = $31
currentMarkValue   = 50 × 0.58 = $29
positionReturnPct  = (31 + 29 − 53) / 53 = +13.2%
```

VWAP-based formulas conflate pre-close vs post-close avg price; this
walks total-in vs total-out and doesn't.

> **UI label** (tooltip): "round-trip USDC return on this condition."
> A perfectly-hedged 50/50 resolves to ~0% even when both legs were
> "correct" picks (Example C); the tooltip prevents the user from
> misreading 0% as bad pick-quality. Per-leg returns stay visible in
> the expansion's participants grid.

#### F. Edge cases

- **`totalBuyNotional = 0`**: formula undefined. Both
  `positionReturnPct` and `rateGapPct` are `null`. Row still appears
  in the table (so the user sees they hold a position with no
  comparable target buy notional); the gap columns render `—`.
- **All-sold-out closed position**: same formula
  (`currentMarkValue = 0`, `totalBuyNotional > 0`) — works.
- **SELL-only fills** on a buy-funded condition: produces
  `totalBuyNotional = 0`. Treat as a data bug; emit `warnings[]`,
  surface row with null metrics.
- **Currency precision**: `numeric(20,8)` × Number coercion in JS
  loses precision past ~$92M; not a real bound for v0. Round
  percentages to 4 decimals, dollars to 2 (matches today).

### 3.4 Contract surface

In `poly.wallet.execution.v1.contract.ts`, replace in place — no v2:

```diff
- edgeGapUsdc:  number | null
- edgeGapPct:   number | null
+ ourReturnPct:        number | null   /* §3.1 */
+ targetReturnPct:     number | null   /* §3.1, blended per §3.5 */
+ rateGapPct:          number | null   /* §3.2 */
+ sizeScaledGapUsdc:   number | null   /* §3.2 */
```

### 3.5 Multi-target blending

A market may have multiple active copy-targets. The headline cell
uses **cost-basis-weighted blend**:

```
targetReturnPct
  = SUM_targets(target_buy_notional × target_returnPct)
  / SUM_targets(target_buy_notional)
```

Worked example (winner + loser):

```
Target A: totalBuyNotional = $400, returnPct = +30%
Target B: totalBuyNotional = $100, returnPct = −20%

blended = (400 × 0.30 + 100 × −0.20) / 500 = +20.0%
```

The blended cell is the headline; the bento expansion shows A and B
separately so the user can see when the blend hides a divergence.
Per-target rows are already in the participants grid — they just
gain a per-target `returnPct` column.

---

## 4. Visual: table-as-spine + bento expansion

Image-v5 has the right skeleton (sortable, dense, scannable). The
bug is the column shape, not the form. Keep the table; replace the
columns; add an in-place expansion containing the chart + the
existing per-leg participants grid.

No portfolio strip. No new dashboards. The sort puts the answer to
Q1 in the top row; that's the entire job.

### 4.1 Why not the alternatives

- **Cards**: forfeits sort + keyboard scan. Fails Q1.
- **Pivot grid (markets × wallets)**: 90% empty.
- **Side-by-side wallet columns**: that's image-v5; doesn't scale
  past 2 traders.
- **Separate `/research/market-comparison` page**: forces context
  switch on Q3. Drill-down belongs in-place.

### 4.2 Wireframe

```
┌─ MARKETS ──────────────────────────────────────────────────────────────┐
│ [Alpha leak only ▾]  [Rate-gap > 5pp ▾]  [Live only ▾]                 │
│                                                                        │
│ ┌──────────────────────────────────────────────────────────────────┐  │
│ │ Market           Our $  Tgt $   Our    Tgt    Rate   $ gap      │  │
│ │                                 ret%   ret%   gap    on us       │  │
│ │ ──────────────────────────────────────────────────────────────── │  │
│ │ ▼ ARS-ATM 0/0    $74    $184k  +2.1%  +43.1%  +41pp  +$30.34    │  │
│ │   ┌──────────────────────────────────────────────────────────┐  │  │
│ │   │ Cumulative return % over time, scoped to this condition │  │  │
│ │   │                                ╱── target +43%          │  │  │
│ │   │                          ╱────╯                          │  │  │
│ │   │                        ▲ target BUY 50sh @0.62           │  │  │
│ │   │  ●─────●  us +2%      ▼ us BUY 80sh @0.71                │  │  │
│ │   │  Apr 28  Apr 30  May 1   May 3   May 5                   │  │  │
│ │   │                                                          │  │  │
│ │   │ Per-leg participants grid (existing component, unchanged)│  │  │
│ │   └──────────────────────────────────────────────────────────┘  │  │
│ │                                                                  │  │
│ │ ▶ NBA MIN SAS    $76    $48k   +24%   +18%    −6pp   −$4.56    │  │
│ │ ▶ MLB CIN/SF     $13    —      +12%   —       —      —         │  │
│ └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘

Default sort: descending by `$ gap on us`.
Top = worst leak (positive = target ahead). NBA MIN SAS sorts below
because we're ahead there (negative gap).
```

### 4.3 Walking the 3 questions

- **Q1**: top row by sort. ~2s.
- **Q2**: read `Rate gap` (pick-quality, +41pp) and `$ gap on us`
  (cost-on-our-book, +$30.34) on the same row. ~5s.
- **Q3**: click chevron, scan the slope-discontinuity in the chart;
  entry-marker triangles pin the gap to a specific BUY. ~7s.

### 4.4 Visual rules

- **One denominated $ per row** (`$ gap on us`). No mixing scales.
- **Two return cells side-by-side** (`Our ret%`, `Tgt ret%`); identical
  formatting; eye computes the gap visually, `Rate gap` makes it numeric.
- **`Our $`, `Tgt $`** stay for context, never participate in gap math.
- **Dollar columns**: right-aligned, tabular-nums, abbreviated
  (`$48k` not `$48,650.97`).
- **Status + Hedges count**: tertiary, hidden by default.
- **Alpha-leak filter** rewritten against new fields: positive
  `sizeScaledGapUsdc` AND `rateGapPct ≥ 5pp` (configurable threshold).

---

## 5. Drill-down: extend `/research/trader-comparison`, no new endpoint

### 5.1 Decision

The existing `/api/v1/poly/research/trader-comparison` already returns
multi-wallet P/L history (`traders[].pnl.history`), is already
tenant-scoped via session auth, and already drives image-v4's chart.
The Markets-table expansion needs the same shape, scoped to one
condition. So extend, don't fork.

**Add**: optional `conditionId` query param. When present, all P/L
math (`pnl.history`, `pnl.usdc`) is computed scoped to that
condition's fills + snapshots only. `tradeSizePnl` is irrelevant
when scoped — return `null` (Zod schema becomes `.nullable()` on that
field) rather than empty buckets.

**Lift the chart**: the Research view's `TraderComparisonPnlChart`
becomes a presentational component taking
`series: { label, points: { ts, cumulativeReturnPct }[] }[]`. Both the
Research view and the Markets-bento expansion consume it. No bespoke
chart.

**Chart denominator**: % (`cumulativeReturnPct`), matching the table.
A $ chart inside a % table reintroduces the cross-row scale-mixing
this brief is fixing.

### 5.2 Backing query

The existing service computes per-wallet P/L history. Adding a
`conditionId` filter is one `WHERE condition_id = $X` push-down on
the underlying snapshot + fills queries. Per-bucket math:

```
cumulativeReturnPct(t)
  = (cumRealizedCash(t) + currentMarkValue(t) − cumBuyNotional(t))
  / cumBuyNotional(t)
```

i.e. §3.1 evaluated at each bucket boundary, where the cumulatives
are running sums-up-to-`t` over `poly_trader_fills` (or
`poly_copy_trade_fills` for our wallet) and the latest snapshot
provides the open-shares mark.

**SQL aggregation discipline** (per data-research skill): bounded by
hours-in-window × wallets, not by fill count. Tier-0 worst case:
30d × 24h × 4 wallets ≈ 2,880 rows. No raw-fill hydration in V8.
Wrap multi-query bundles in `db.transaction(...)`. EXPLAIN ANALYZE
attached to PR.

**Graceful degradation**: when snapshot density is sparse for a given
(wallet, condition), the chart sparses; we don't block. If a series
has zero points, the chart shows the wallet's label with a
`warnings[]` entry ("insufficient data on this condition"). No error
state, no spinner-of-death. Future enhancement: fall back to
`poly_trader_fills` × `poly_market_price_history` for finer mark
points — out of scope for v0.

**Tenant scoping**: unchanged. The existing endpoint already restricts
`wallet=` to the caller's wallet + their `poly_copy_trade_targets`;
the `conditionId` param doesn't widen the scope.

---

## 6. Decisions made

These are not open questions. Implementer follows them as written.

| #   | Decision                                                                                                                                  | Why                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Multi-target blend = cost-basis-weighted** (not simple-mean, not best-target).                                                          | Matches "what return I'd get copying everyone proportional to their conviction." Best-target is noisier; simple-mean penalizes whales. |
| 2   | **Hedged positions: sum across legs at the metric level**, keep per-leg UI in the participants grid.                                      | Single scalar comparable across markets without special-casing. Per-leg detail still visible on click.                                 |
| 3   | **Default sort = `sizeScaledGapUsdc` desc**.                                                                                              | Matches "what's costing me the most" — steeper trader-action gradient than "where's my pick-quality the worst."                        |
| 4   | **Closed positions stay in-table** with a default "Live only" filter.                                                                     | One toggle flips between "what's bleeding now" and "what bled last week"; no second tab.                                               |
| 5   | **Naming = new fields** (`rateGapPct`, `sizeScaledGapUsdc`, `ourReturnPct`, `targetReturnPct`); legacy `edgeGap*` dropped, not redefined. | Re-using a name with new math is the metric drift the data-research skill warns against.                                               |
| 6   | **No new endpoint**; extend `/research/trader-comparison` with `conditionId`.                                                             | One Zod field beats a new route + service + handler + parity-test surface.                                                             |
| 7   | **Math lives in a pure module** (`server/market-return-math.ts`, no DB import) imported by the service.                                   | Easier parity-testing; reusable from future research views.                                                                            |
| 8   | **Snapshot sparsity is graceful-degraded**, not pre-spiked.                                                                               | Backfill correctness is owned elsewhere; this brief's job is dashboard + query correctness against current state.                      |

---

## 7. Implementation: 2 PRs

### PR 1 — Math, contract, columns (one shippable change)

- **Pure math module**: new `nodes/poly/app/src/features/wallet-analysis/server/market-return-math.ts`. Exports `positionReturnPct(fills, currentMarkValue) → number | null`, `edgeGap(our, target) → { rateGapPct, sizeScaledGapUsdc }`. No DB imports. Unit-tested against Examples A–F.
- **Contract**: replace `edgeGapUsdc` / `edgeGapPct` with the four new fields in `poly.wallet.execution.v1.contract.ts` (group + line shapes). No v2.
- **Service**: `market-exposure-service.ts` rewrites the SQL to compute `totalBuyNotional` per (wallet, condition) by summing `poly_copy_trade_fills` (us) and `poly_trader_fills` (targets) `WHERE side = 'BUY'`. Joins to current snapshots for `currentMarkValue`. Calls the pure module to derive the four fields per group. Single Postgres query per group bundle, wrapped in a transaction.
- **UI**: `MarketsTable.tsx` columns: drop `Edge Gap`; add `Our ret%`, `Tgt ret%`, `Rate gap`, `$ gap on us`. Default sort = `$ gap on us` desc. `isAlphaLeak` rewritten against the new fields. Existing bento expansion's per-leg participants grid stays untouched.
- **Tests**: `markets-table-alpha-leak.test.ts` updated. Parity unit tests for the pure module covering Examples A–F.

End-state after PR 1: image-v5 is replaced; Q1 + Q2 answerable in <5s; chart drill-down still TBD.

### PR 2 — Drill-down chart in expansion

- Add optional `conditionId` to `poly.research-trader-comparison.v1.contract.ts` request. Make `tradeSizePnl` nullable on the response when `conditionId` is set.
- Update the trader-comparison service to push `conditionId` into the underlying P/L history queries and skip `tradeSizePnl` computation when scoped.
- Extract `TraderComparisonPnlChart` to a presentational component.
- Embed it in the Markets-table bento expansion, fetching against `/research/trader-comparison?conditionId=…&wallet=us&wallet=t1&wallet=t2`.

Each PR ends in `/validate-candidate` per AGENTS.md.

---

## 8. Cross-references

- Existing design (this redesign supersedes): [`poly-dashboard-market-aggregation.md`](./poly-dashboard-market-aggregation.md)
- Hedge classification policy (still applies): [`poly-hedge-followup-policy.md`](./poly-hedge-followup-policy.md)
- Service this rewrites: `nodes/poly/app/src/features/wallet-analysis/server/market-exposure-service.ts`
- Contract this rewrites: `nodes/poly/packages/node-contracts/src/poly.wallet.execution.v1.contract.ts`
- Endpoint this extends (PR 2): `nodes/poly/app/src/app/api/v1/poly/research/trader-comparison/route.ts`
- Chart this lifts (PR 2): `nodes/poly/app/src/features/wallet-analysis/`
- Data-research skill (governs SQL aggregation discipline): `.claude/skills/data-research/SKILL.md`
