---
id: wallet-analysis-components
type: design
title: "Wallet Analysis — Reusable Components + Live Data Plane"
status: draft
spec_refs:
created: 2026-04-19
updated: 2026-04-29
---

# Wallet Analysis — Reusable Components + Live Data Plane

> Any 0x Polymarket wallet renders the same full-fidelity analysis view, fed by a thin HTTP route that computes deterministic metrics on demand (no DB, no migration) and defers authored judgment to [task.0333](../../work/items/task.0333.wallet-analyst-agent-and-dolt-store.md) (Dolt) + event grounding to [task.0334](../../work/items/task.0334.poly-niche-research-engine.md) (Postgres EDO).

## Problem

- `/research` renders **BeefSlayer** as a bespoke hero. Hardcoded stats, hardcoded trades, no other wallet can render.
- `OperatorWalletCard` on `/dashboard` renders the balance bar only for the operator.
- `TopWalletsCard` lists wallets but has no drill-in.

## Component decomposition

One organism, seven molecules, two variants.

```
WalletAnalysisView(address, variant, size)
│
├─ WalletIdentityHeader   ─ name · wallet · Polymarket / Polygonscan · category chip
├─ StatGrid               ─ WR · ROI · PnL · DD · hold · avg/day     [snapshot · 30 s]
├─ BalanceBar             ─ Available · Locked · Positions           [balance  · 30 s]
├─ WalletProfitLossCard   ─ Polymarket P/L + interval tabs           [pnl      · 30 s]
├─ TradesPerDayChart      ─ last 14 d bars                           [trades   · 30 s · lazy]
├─ RecentTradesTable      ─ last N trades                            [trades   · 30 s · lazy]
├─ TopMarketsList         ─ top 4 derived from trades                [derived]
├─ EdgeHypothesis         ─ markdown prose, authored                 [from task.0333 Dolt · prop fallback today]
└─ CopyTradeCTA           ─ vNext · set-as-mirror-target
```

| variant  | used by                                                   | shows                                            |
| -------- | --------------------------------------------------------- | ------------------------------------------------ |
| `page`   | `/research/w/[addr]` AND `/research` hero (`size="hero"`) | all molecules                                    |
| `drawer` | `/dashboard` row → `Sheet`                                | identity · StatGrid · BalanceBar · last 5 trades |

Molecules accept `{ data, isLoading, error }` and render their own skeleton / empty / error states. **No sub-component fetches on its own.**

`EdgeHypothesis` reads from `data.hypothesisMd` (the snapshot slice). In Checkpoint B that prop is a **hardcoded fallback for BeefSlayer only**, inlined in `view.tsx`. When task.0333 ships it comes from a Dolt `poly_wallet_analyses` row without any component change.

## Data plane — compute, not store

Three slices, three independent fetches.

| Slice      | Source                                                                                       | Availability                                              | Freshness |
| ---------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------- |
| `snapshot` | compute: `PolymarketDataApiClient` trades + CLOB resolutions                                 | any addr (metrics `null` until enough resolved positions) | 30 s      |
| `trades`   | `PolymarketDataApiClient` `/trades?user=`                                                    | any addr                                                  | 30 s      |
| `balance`  | `PolymarketDataApiClient` `/positions?user=` (any addr) + operator CLOB USDC (operator only) | any addr (positions-only) · operator (full breakdown)     | 30 s      |
| `pnl`      | `PolymarketUserPnlClient` `user-pnl-api.polymarket.com/user-pnl`                             | any addr (empty array for funded/no-trade wallets)        | 30 s      |

**No Postgres snapshot table.** No `poly_wallet_screen_snapshots`. No seed script. No migration. Numbers are deterministic `f(trades × resolutions)` — compute every request, cache the result. Research fixtures remain documentation.

**Reuse mandate.** All Polymarket Data-API calls go through the existing `PolymarketDataApiClient` in `packages/market-provider`. Metrics math lives in a new sibling package module `packages/market-provider/src/analysis/wallet-metrics.ts` — pure function over `{ trades, resolutions }`, unit-testable. Adding a second Data-API client in `nodes/poly/app/` is a review-blocking violation.

**Coalescing + concurrency.**

- Module-scoped `Map<string, { value, expiresAt }>` at the handler, 30 s TTL keyed `(slice, addr)`. Ten simultaneous requests for the same key → one upstream call.
- `p-limit(4)` shared across all upstream client calls caps in-flight requests when prefetching many wallets at once (e.g. a Monitored-Wallets hover sweep).
- Single-replica assert at boot (`instrumentation.ts`) throws if `POLY_REPLICA_INDEX != 0` or pod-name suffix is not `-0`. The module-Map cache silently corrupts with >1 replica — hard-fail, not a comment. Single-replica deployment is enforced by the SINGLE_WRITER invariant (see `poly-copy-trading` skill).

**Per-slice fetching.** `useWalletAnalysis(addr)` fans out to three React Query calls, one per slice. Each call hits `/api/v1/poly/wallets/[addr]?include=<slice>`. Three keys, three independent loading states, three skeletons render independently.

**Lazy.** `TradesPerDayChart` + `RecentTradesTable` are `next/dynamic` imports — only pulled when `variant === "page"`.

**Prefetch.** `TopWalletsCard` row → `onPointerEnter` / `onFocus` / `onTouchStart` (debounced 50 ms) → `queryClient.prefetchQuery` for `snapshot` + `trades`. `balance` skipped to spare the cap for operator use.

## API surface

One route. Contract owns the shape.

```
GET /api/v1/poly/wallets/{addr}?include=snapshot|trades|balance|pnl&interval=1D|1W|1M|1Y|YTD|ALL
```

Contract: [`nodes/poly/app/src/contracts/http/poly.wallet-analysis.v1.contract.ts`](../../nodes/poly/app/src/contracts/http/poly.wallet-analysis.v1.contract.ts) (Zod). Enforces:

- `addr` matches `^0x[a-f0-9]{40}$` then lowercased before any handler logic.
- `include` repeated query params parsed as a Zod array subset of `{snapshot, trades, balance, pnl}`; default `["snapshot"]`.
- Each slice independently optional in the response. `warnings: Array<{ slice, code, message }>` surfaces partial failures — UI renders "trades unavailable, retrying" instead of silently empty.
- Any 0x address returns 200. Snapshot metrics null until resolved positions count is large enough for meaningful math (≥5 resolved).
- `balance` has two modes: operator addr → `{ available, locked, positions, total }`; any other addr → `{ positions, total }` only. Contract response shape makes `available` / `locked` optional.

**Auth.** Handler calls `await getServerSessionUser()` explicitly — no middleware trust. Acceptance test: unauthed request → `401`.

## Routes & UX flow

```
/research                  → WalletAnalysisView variant=page size=hero  (BeefSlayer block)
/research/w/[addr]         → WalletAnalysisView variant=page            (any wallet)
/dashboard row click       → Sheet with WalletAnalysisView variant=drawer + ?w=0x… deep-link
```

- `/research` keeps its dossier shape (intro · categories · no-fly zone). The BeefSlayer block becomes `<WalletAnalysisView address=BEEF variant="page" size="hero" />`, fed by the hook.
- `/research/w/[addr]` — dynamic Next.js route, auth-gated server shell, client `WalletAnalysisView`.
- Dashboard drawer — shadcn `Sheet` (already vendored). Deep-link via `?w=0x…`. Esc / click-out closes and clears the param.

## Rollout — one PR, three commits

[task.0329](../../work/items/task.0329.wallet-analysis-component-extraction.md):

| Checkpoint                    | Scope                                                                                                                                                                                                                                                                                                                                     | Gate                                                                                                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A · Extract** ✅ shipped    | 7 molecules + `WalletAnalysisView` page variant; `/research` re-renders BeefSlayer through it; `OperatorWalletCard` refactored to share the same `BalanceBar` molecule                                                                                                                                                                    | Visual parity with main ✓                                                                                                                                                       |
| **B · Data plane** ✅ shipped | `wallet-metrics.ts` pure fn + `polymarket.clob-public.client.ts` + Zod contract + `GET /api/v1/poly/wallets/[addr]` route (auth + warnings[]) + module-scoped TTL coalesce + `p-limit(4)` + single-replica boot assert + `/research/w/[addr]` server-rendered page + DRY balance fetcher shared with legacy `/api/v1/poly/wallet/balance` | BeefSlayer numbers live-verified on `poly-test.cognidao.org` (resolved 260 · WR 73.1% · ROI +19.1%); 10× parallel → 1 upstream fetch; 401 unauthed; operator = dashboard card ✓ |
| **C · Drawer** ⚠ partial     | `drawer` variant + `Sheet` from row click shipped (task.0344 → PR #976); both `/research` and `/dashboard` Copy-Traded Wallets open `WalletDetailDrawer` in place via skeleton-first `useWalletAnalysis` — no page jump. Pointer/focus/touch prefetch + `?w=…` deep-link remain follow-ups                                                | Drawer opens instantly, skeletons render in-frame on both surfaces ✓                                                                                                            |

### vNext — Copy-trade CTA (parked)

Blocked on two decisions: where the Harvard-flagged dataset lives, what "admin" means under multi-tenant RLS (`task.0318`). File a design when both land.

## Checkpoint D — Order-flow distributions deep dive (DESIGN)

> Empirical motivation: [`docs/research/poly-wallet-orderflow-2026-04-29.md`](../research/poly-wallet-orderflow-2026-04-29.md). The two top-2 wallets are pure intra-event DCA traders — their style is only legible at the **order-flow level**, not from PnL curves. Six distribution shapes (DCA depth, event clustering, trade-size, entry-price, DCA window, time-of-day) belong in the deep dive, alongside the existing `snapshot` / `trades` / `pnl` slices.
>
> Every per-fill chart is also split by **outcome status** (won / lost / pending) and rendered in two value modes (count and USDC-weighted). Resolutions are joined in via the existing `MarketResolutionInput` shape — no new fetch path beyond what the `snapshot` slice already does.

### Scope

Add a new **`distributions` slice** to the existing wallet-analysis surface. Two access modes share one component contract:

| mode | source | range | freshness | use |
| --- | --- | --- | --- | --- |
| **on-demand** | live `/trades?user=…` paginated to budget cap | last ~24-48h for HF wallets (1000-row page cap) — up to ~10d if we paginate to the 10k API ceiling | 30s in-memory TTL | drawer / page first paint; any 0x address |
| **pre-saved** | `poly_target_fills` Doltgres ledger | longitudinal (≥30 days, eventually all-time via on-chain backfill) | nightly delta + on-chain catch-up | rostered targets only; default view on `/research/w/[addr]` once persisted |

Both modes feed the same `Distributions` shape; the UI toggles between them with a "live (24h) ↔ all-time" switch and renders the same six chart molecules.

### Data plane — extend the existing slice table

| Slice           | Source                                                                          | Availability                                                          | Freshness | Mode      |
| --------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------- | --------- |
| `distributions` | compute: `PolymarketDataApiClient.listUserTrades` paginated → pure `summarise()` | any addr (24-48h window for HF wallets; degrades to "insufficient" if <50 trades) | 30 s      | on-demand |
| `distributions` | read: Doltgres `poly_target_fills` → pure `summarise()` → knowledge-store cache | rostered targets only; range param `[from, to]` honoured                 | 24 h      | pre-saved |

Both modes call the **same pure module**:

```
packages/market-provider/src/analysis/
  ├── pnl-curve-metrics.ts           (exists — informs us)
  ├── wallet-metrics.ts              (exists — snapshot slice; supplies MarketResolutionInput)
  └── order-flow-distributions.ts    (NEW)
        export function summariseOrderFlow(
          trades: PolymarketUserTrade[],
          resolutions: ReadonlyMap<string, MarketResolutionInput>,
          opts?: { now?: number }
        ): Distributions
```

The signature mirrors `computeWalletMetrics(trades, resolutions, opts)` — same resolution map, joined in the same way. Each fill is classified `won` / `lost` / `pending` by matching its `(conditionId, outcome)` against the resolution's `tokens[].winner` flag; missing entries default to `pending`.

`Distributions` shape (Zod-defined in the wallet-analysis contract):

```ts
type OutcomeStatus = "won" | "lost" | "pending";

type OutcomeBuckets = {
  // Count-weighted: 1 per fill.
  count: { won: number; lost: number; pending: number };
  // Size-weighted: USDC notional summed per fill.
  usdc:  { won: number; lost: number; pending: number };
};

type Histogram = {
  buckets: {
    lo: number;
    hi: number;
    label: string;     // human-readable bucket label
    values: OutcomeBuckets;
  }[];
};

type FlatHistogram = {
  // For aggregations where outcome split is meaningless (e.g. eventClustering).
  buckets: { lo: number; hi: number; label: string; count: number; usdc: number }[];
};

{
  range: { fromTs: number; toTs: number; n: number };
  // Win/loss-aware (per-fill or per-group with single outcome):
  dcaDepth:        Histogram;       // (market, outcome) groups → trades
  tradeSize:       Histogram;       // log USDC buckets
  entryPrice:      Histogram;       // 9 probability bands
  dcaWindow:       Histogram;       // first→last per group, time buckets
  hourOfDay:       Histogram;       // 24 buckets, UTC
  // Outcome split is meaningless (multi-resolution events):
  eventClustering: FlatHistogram;   // eventSlug → trades
  topEvents:       { slug: string; title: string; tradeCount: number; usdcNotional: number }[];
  // Pending share is dominant in `live` mode — UI captions this from `range.n` + summed pending counts:
  pendingShare:    { byCount: number; byUsdc: number };
  // Quantile sentinels for reference lines.
  quantiles: { dcaDepth: Quantiles; tradeSize: Quantiles; dcaWindowMin: Quantiles };
}

type Quantiles = { p50: number; p90: number; max: number };
```

Per-chart split eligibility:

| chart           | outcome split | size-weighted | rationale                                                 |
| --------------- | ------------- | ------------- | --------------------------------------------------------- |
| dcaDepth        | yes           | yes           | each (market,outcome) group has one resolution            |
| tradeSize       | yes           | n/a (axis)    | per-fill                                                  |
| entryPrice      | yes           | yes           | per-fill                                                  |
| dcaWindow       | yes           | yes           | per-group (single outcome)                                |
| hourOfDay       | yes           | yes           | per-fill                                                  |
| eventClustering | **no**        | yes           | events span sub-markets that resolve independently        |

The shape is **bucket counts + USDC sums, not raw rows** — drives ~6 KB on the wire instead of streaming raw trades.

### Persistence — Doltgres `poly_target_fills` + shared `poly_market_resolutions`

Per-node schema, follows the [database-expert](../../packages/db-schema/AGENTS.md) Postgres-vs-Doltgres split (this is AI-written ground-truth ingest → Doltgres). **Two tables**: per-target fills (high-cardinality) and shared resolutions (deduped across targets).

```sql
-- nodes/poly/packages/doltgres-schema/src/target-fills.ts
CREATE TABLE poly_target_fills (
  proxy_wallet         TEXT        NOT NULL,
  ts                   TIMESTAMPTZ NOT NULL,
  condition_id         TEXT        NOT NULL,
  outcome              TEXT        NOT NULL,
  side                 TEXT        NOT NULL CHECK (side IN ('BUY','SELL')),
  size                 NUMERIC     NOT NULL,
  price                NUMERIC     NOT NULL,
  usdc_notional        NUMERIC     GENERATED ALWAYS AS (size * price) STORED,
  event_slug           TEXT,
  market_slug          TEXT,
  title                TEXT,
  transaction_hash     TEXT        NOT NULL,
  ingested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  source               TEXT        NOT NULL DEFAULT 'data-api',  -- 'data-api' | 'on-chain'
  PRIMARY KEY (proxy_wallet, transaction_hash, condition_id, outcome, side)
);
CREATE INDEX poly_target_fills_proxy_ts_idx ON poly_target_fills (proxy_wallet, ts DESC);

-- nodes/poly/packages/doltgres-schema/src/market-resolutions.ts
CREATE TABLE poly_market_resolutions (
  condition_id         TEXT        PRIMARY KEY,
  closed               BOOLEAN     NOT NULL,
  -- JSON array: [{ token_id, winner }] mirroring MarketResolutionInput.tokens
  tokens               JSONB       NOT NULL,
  resolved_at          TIMESTAMPTZ,
  refreshed_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX poly_market_resolutions_closed_idx ON poly_market_resolutions (closed);
```

Resolution table is **shared across all targets** — many wallets bet on the same market; one row per `condition_id` regardless of target count. Updates only when `closed` flips false→true; immutable thereafter (per `RESOLUTION_TTL_BY_STATUS` invariant below).

Ingest paths (separate jobs, both idempotent on the PK):

1. **Nightly delta** — `bootstrap/jobs/target-fills-delta.job.ts`. For each rostered target, page `/trades?user=…&sinceTs=<lastSeenTs>`. Cheap (1-2 pages/wallet/day at HF cadence).
2. **One-shot backfill** — `scripts/experiments/backfill-target-fills.ts`. Walk `/trades` until 10k cap or empty. Run once per new roster wallet. Doc warning: API ceiling = ~10 days for 1000-trades/day wallets.
3. **vFuture on-chain catch-up** — `getLogs` on CTF + NegRiskAdapter `Trade` events filtered by counterparty. Lifts the 10k ceiling; graduates `source` to `'on-chain'`. Out of scope for v0; pointer here so the schema is forward-compatible.

### Compute layer — derived summary cache

Mirrors the [`core__poly_data_user_pnl_summary`](../../nodes/poly/packages/ai-tools/src/tools/poly-data-user-pnl-summary.ts) pattern (24h knowledge-store cache, idempotent re-write per wallet+range):

```
nodes/poly/packages/ai-tools/src/tools/poly-data-user-orderflow-summary.ts
  inputs:  { user, mode: 'live'|'historical', from?, to?, forceRefresh? }
  outputs: PolyDataUserOrderFlowSummary  // == Distributions + refreshedAt + fromCache
  caches:  KnowledgeCapability id = `poly-wallet-orderflow:<wallet>:<mode>:<range>` (24h TTL)
```

Tool stays effect=`state_change` for the same idempotent-cache-write reason as the PnL summary.

### API surface — extend, don't replace

```
GET /api/v1/poly/wallets/{addr}?include=…&distributionMode=live|historical&from=…&to=…
```

Add `distributions` to the `include` enum. Both modes go through the same route; the handler routes to the right source based on `distributionMode` (default: `live` for any addr; `historical` only succeeds if the addr is in `poly_target_fills`).

**Shared resolution map per request.** When both `snapshot` and `distributions` are requested, the handler computes one `Map<conditionId, MarketResolutionInput>` from the union of their market-id sets and threads it into both pure modules. No double-fetch. See `RESOLUTIONS_FETCHED_ONCE_PER_REQUEST` invariant.

### Component decomposition

One organism extension, six new molecules, lazy-loaded:

```
WalletAnalysisView(address, variant, size)
│
├─ … existing molecules …
└─ DistributionsBlock                       [distributions · 30s on-demand / 24h cached · lazy]
   ├─ DistributionsToolbar                  live (24h) ↔ historical · count ↔ USDC
   ├─ DCADepthChart           (stacked)     recharts BarChart, won/lost/pending stack
   ├─ TradeSizeChart          (stacked)     recharts BarChart, log-x bucket, won/lost/pending
   ├─ EntryPriceChart         (stacked)     recharts BarChart, x-axis [0,1], won/lost/pending
   ├─ DcaWindowChart          (stacked)     recharts BarChart, won/lost/pending
   ├─ HourOfDayHeatmap        (stacked)     24×1, three-band cell colouring
   └─ EventClusteringPanel    (flat)        BarChart + TopEventsList; no outcome split
```

Each molecule receives `{ data: Histogram | FlatHistogram, mode: 'count'|'usdc', isLoading, error, quantiles }` and renders its own skeleton / empty / error. **No sub-molecule fetches on its own** — same rule as Checkpoint A. Stack ordering: `won` (green) bottom, `lost` (red) middle, `pending` (grey) top. The `DistributionsToolbar` controls both the range mode (live/historical) and the value mode (count/USDC) — one fetch shape powers both views.

**Default state**: `live` + `count`, with USDC and historical as one-click toggles. Pending share caption sits above the charts: *"showing N fills, M (P %) on unresolved markets"*. In `live` mode for HF wallets the grey band will dominate — that is correct, not a bug.

`recharts` is already a dep (`OperatorPnlCard`); no new chart library.

### Rollout — three checkpoints

| Checkpoint                              | Scope                                                                                                                                                                                                                                                          | Gate                                                                                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1 · Pure module + on-demand UI**     | `order-flow-distributions.ts` pure fn + Zod contract extension + `distributions` slice in route (`live` mode only, paginated to first 1000 trades) + 6 molecules wired into `WalletAnalysisView` (lazy)                                                        | Any 0x address renders 6 charts on `/research/w/[addr]`; matches the script output for RN1 + swisstony to within ±1 row per bucket; 401 unauthed.    |
| **D2 · Persistence + historical mode**  | Doltgres `poly_target_fills` table + nightly delta job + one-shot backfill script + `core__poly_data_user_orderflow_summary` tool + route `distributionMode=historical` branch + RangeToggle UI                                                                | Toggle live ↔ historical on a rostered target; historical view shows ≥7-day range; cache-hit ratio ≥80% on the second view of a given (wallet, range). |
| **D3 · On-chain backfill** *(parked)*   | `getLogs` ingest on CTF + NegRiskAdapter; `source='on-chain'` rows; lifts the 10k API ceiling                                                                                                                                                                  | File when D2 has been live ≥4 weeks and we hit the API ceiling on ≥1 roster wallet.                                                                  |

### Fixture format (preserve research data)

Every script run that produces these distributions writes a **JSON sidecar** alongside the markdown research doc, so the buckets are recomputable without re-querying the API:

```
docs/research/fixtures/poly-wallet-orderflow/
  └── <yyyy-mm-dd>/
      ├── 0x2005d16a84…rn1.distributions.json     // Distributions shape (no raw trades)
      ├── 0x2005d16a84…rn1.trades.jsonl           // gzipped raw /trades response (audit trail)
      ├── 0x204f72f353…swisstony.distributions.json
      └── 0x204f72f353…swisstony.trades.jsonl
```

The Distributions JSON is the source of truth for the markdown ASCII charts; if the script regresses we can replay the visualisation. Raw trades sidecar survives Polymarket data-API drift (schema changes, retired endpoints).

This pattern generalises: any future "save research" run that pulls live data writes both a markdown and a fixture under the same dated directory.

### Invariant additions

- **DISTRIBUTIONS_ARE_PURE_DERIVATIONS** — the bucket counts are `f(trades, resolutions, range)`. Never authored. Never edited by hand. If a histogram looks wrong, fix the pure module, not the data.
- **TWO_PATHS_ONE_SHAPE** — on-demand and historical modes both produce the same `Distributions` Zod shape. Components never branch on mode.
- **PERSIST_FILLS_AND_RESOLUTIONS_NOT_BUCKETS** — the Doltgres ledger stores raw fills (`poly_target_fills`) and shared resolutions (`poly_market_resolutions`) only. Bucket counts are recomputed from `(fills, resolutions, range)`; persisting derived buckets is duplication that drifts.
- **RESOLUTIONS_FETCHED_ONCE_PER_REQUEST** — the route handler builds a single `Map<conditionId, MarketResolutionInput>` per request, shared by `snapshot` and `distributions` slices. No slice fetches resolutions independently. Mirrors the `p-limit(4)` invariant from Checkpoint B.
- **RESOLUTION_TTL_BY_STATUS** — `closed=true` resolutions are immutable and cache permanently; `closed=false` markets cache 30 s max. The 24h knowledge-store TTL applies to the *summary*, not the resolution map.
- **API_CEILING_IS_DOCUMENTED** — `live` mode's 1-2 day window for HF wallets is a known limit; UI surfaces it as a "showing last N hours" caption, not silently.
- **RANGE_AS_FIRST_CLASS_PARAM** — `from`/`to` query params, honoured by both modes; default `live` = last 1000 trades, default `historical` = last 30 days.
- **PENDING_IS_FIRST_CLASS** — the `pending` outcome status is required everywhere `won`/`lost` appears. Two-state code paths are a bug; HF-wallet `live` mode is majority-pending by construction.

### Open questions

1. **Bucket edge selection.** Histograms above use script-chosen edges (e.g. trade-size `[0,10,50,100,500,1000,5000,10000]`). Worth a UX pass: do users want fixed edges per metric or quantile-derived (decile bins)? Quantile bins are unstable across ranges; fixed are easier to compare. Default fixed.
2. **HF wallet API budget.** A roster of 11 wallets × 1000-trade page ÷ 30s TTL ≈ 22 calls/min on first cold-load wave. Below the public Data-API rate floor by 100x but worth watching during D1 stack-test.
3. **Sparkline-on-row.** Worth rendering a tiny DCA-depth or trade-size sparkline in the `WalletsTable` row itself so the user sees at-a-glance whether two ranked wallets have the same vs different style? Defer to D2 — needs the persisted bucket cache to be cheap enough.
4. **`/research/w/[addr]` deep-link from `/poly/wallets/<addr>` distribution page sharing.** Out of scope; bookmark is already deterministic.

## Invariants

- Numbers are compute, not store. No `poly_wallet_screen_snapshots` table ever. Follow-ups that need versioned judgment go to Dolt via [task.0333](../../work/items/task.0329.wallet-analysis-component-extraction.md).
- The `/research/w/[addr]` page and the drawer now share one client container (`WalletAnalysisSurface`) that fans out to the route's slices, including `pnl`, via independent React Query keys.
- Address validation in the Zod contract, not the handler.
- Any 0x address → 200. Auth enforced at the route via `resolveRequestIdentity` (Bearer OR session cookie, unified by the existing wrapper).
- Coalesce dedups same `(slice, addr)`; `p-limit(4)` caps cross-key fan-out. Both at the handler, not the client.
- Single-replica deployment enforced by boot assert — cache corruption on `replicas>1` is a hard fail.
- **Single balance fetcher.** `getBalanceSlice(addr)` in `features/wallet-analysis/server` is the sole source — positions-only, public Data-API read, no operator-only branch. Post-Stage-4 (task.0318 Phase B) the `app/_lib/poly/operator-extras.ts` helper + the operator-only `available/locked` breakdown have been purged; the legacy `/api/v1/poly/wallet/balance` route now returns a stable "unconfigured" tombstone until the per-tenant Money-page rework replaces it.
- `balance` slice always available; operator addr gets full USDC breakdown (available + locked via `fetchOperatorExtras`), other wallets get positions-only.
- All Polymarket Data-API calls go through `packages/market-provider`. Metrics computation lives in that same package — `packages/market-provider/src/analysis/`.
- `EdgeHypothesis` renders from `data.hypothesisMd`. For v0 the prop value is a "Lorem Cognison" placeholder (caption) — task.0333 swaps in Dolt-stored AI analysis with zero component change.

## Open questions (non-blocking)

1. **Minimum resolved-positions threshold before rendering metrics** — research doc's screen used n ≥ 15. Start there; surface "insufficient data" state if under.
2. **Calibration of `snapshot` cache vs `trades` cache** — both 30 s. Snapshot is `f(trades)` so they could share a key; kept separate for per-slice loading isolation. Worth a bench during implementation.
3. **Drawer variant on narrow viewports** — Sheet vs full-screen modal. Decide in Checkpoint C; not a design concern.

## Pointers

- Reusable view (shipped A): [`features/wallet-analysis/`](../../nodes/poly/app/src/features/wallet-analysis/)
- Data adapter (mandatory): [`polymarket.data-api.client.ts`](../../packages/market-provider/src/adapters/polymarket/polymarket.data-api.client.ts)
- Metrics math source: [`scripts/experiments/wallet-screen-resolved.ts`](../../scripts/experiments/wallet-screen-resolved.ts) — extract into `packages/market-provider/src/analysis/wallet-metrics.ts`
- Wallets table (single organism, both surfaces): [`_components/wallets-table/`](<../../nodes/poly/app/src/app/(app)/_components/wallets-table/>) — `WalletsTable` renders `variant="full"` on `/research` and `variant="copy-traded"` on `/dashboard`; sort/filter/hide live in column headers (reui `DataGridColumnHeader`), no bespoke toolbar.
- Drawer primitive: [`vendor/shadcn/sheet.tsx`](../../nodes/poly/app/src/components/vendor/shadcn/sheet.tsx)
- Dolt follow-up: [`task.0333`](../../work/items/task.0333.wallet-analyst-agent-and-dolt-store.md)
- EDO follow-up: [`task.0334`](../../work/items/task.0334.poly-niche-research-engine.md)
- Research context: [`polymarket-copy-trade-candidates.md`](../research/polymarket-copy-trade-candidates.md)
