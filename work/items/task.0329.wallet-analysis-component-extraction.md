---
id: task.0329
type: task
title: "Wallet analysis — reusable component + live data plane (any wallet) + Monitored drawer"
status: needs_review
priority: 2
rank: 5
estimate: 4
created: 2026-04-19
updated: 2026-04-20
summary: "One PR with checkpoints: extract WalletAnalysisView from /research, wire a single API route through the existing PolymarketDataApiClient with server-side coalescing, ship /research/w/[addr] for any 0x wallet, and open a drawer from Monitored Wallets rows."
outcome: "Click any wallet → see live analysis. /research keeps BeefSlayer hero via the new component. /research/w/[addr] works for any address. Monitored Wallets row opens drawer with prefetch. Snapshot data layered in for screened wallets; non-screened wallets show live trades only."
spec_refs:
  - docs/design/wallet-analysis-components.md
assignees: [derekg1729]
credit:
project: proj.poly-prediction-bot
branch: design/wallet-analysis-components
pr: https://github.com/Cogni-DAO/node-template/pull/934
reviewer:
revision: 0
blocked_by:
deploy_verified: false
labels: [poly, wallet-analysis, ui, api]
---

# task.0329 — Wallet Analysis: One PR, Three Checkpoints

## Problem

The BeefSlayer hero on `/research` is a one-off. We want any wallet address to render the same analysis view, with live data, accessible from the Monitored Wallets table on `/dashboard`. Single PR, checkpoints inside.

## Approach

Three checkpoints, three commits, one PR. Each checkpoint is self-contained but they ship together.

### Checkpoint A — Extract components

- New feature dir `nodes/poly/app/src/features/wallet-analysis/`
- 7 molecules (`WalletIdentityHeader`, `StatGrid`, `BalanceBar`, `TradesPerDayChart`, `RecentTradesTable`, `TopMarketsList`, `EdgeHypothesis`) + organism `WalletAnalysisView({ address, variant: "page", size, data, isLoading })`
- `/research` BeefSlayer block re-renders via the new component (hardcoded data still in place)
- Visual parity with current `/research`

### Checkpoint B — Data plane + dynamic page

- Drizzle schema + migration for `poly_wallet_screen_snapshots` (DDL only)
- Idempotent seed script `pnpm --filter @cogni/poly-app run seed:wallet-screen` (ON CONFLICT DO NOTHING)
- Zod contract `nodes/poly/app/src/contracts/http/poly.wallet-analysis.v1.contract.ts`:
  - `addr` regex `^0x[a-f0-9]{40}$` (lowercased)
  - `include` ⊆ `{snapshot, trades, balance}`; default `snapshot,trades`
  - response slices each independently optional + `warnings[]`
- Route `app/api/v1/poly/wallets/[addr]/route.ts` — auth-checked, served via existing `PolymarketDataApiClient` from `packages/market-provider`. **Any 0x address accepted** (no roster gate; coalescing + auth + per-IP rate-limit guard the upstream).
- Server-side `unstable_cache` per `(slice, addr)`, 30 s TTL. Single-replica deployment per SINGLE_WRITER invariant; cache is effectively pod-global.
- Client `useWalletAnalysis(addr)` hook returning `{ snapshot, trades, balance }` each with `.data`, `.isLoading`, `.error`
- Dynamic `/research/w/[addr]` page (auth-gated server shell)
- BeefSlayer block on `/research` switches to live hook (snapshot + trades come from API)

### Checkpoint C — Monitored Wallets drawer

- Add `drawer` variant to `WalletAnalysisView`
- `TopWalletsCard` row → opens shadcn `Sheet` (already vendored)
- Row `onPointerEnter` + `onFocus` + `onTouchStart` (debounced 50 ms) → React Query prefetch
- `?w=0x…` deep-link opens drawer on mount; close clears the param
- "Open in page →" link inside drawer header

## Validation

- [ ] Checkpoint A: `/research` Playwright visual diff vs main ≤ 0.5 % pixel delta
- [ ] Checkpoint B: BeefSlayer numbers via API match the hardcoded baseline
- [ ] Checkpoint B: invalid addr → 400; unscreened addr (no snapshot row) → response with `snapshot: null` + populated `trades`
- [ ] Checkpoint B: ten concurrent requests for the same addr produce one upstream Data-API call (stack-test spy)
- [ ] Checkpoint B: `/api/v1/poly/wallets/[addr]` returns 401 when unauthenticated
- [ ] Checkpoint C: drawer interactive ≤ 200 ms on prefetched roster row (desktop)
- [ ] Checkpoint C: `?w=0x…` deep-link opens drawer on initial render
- [ ] No second `Polymarket*Client` exists in `nodes/poly/app/`
- [ ] `pnpm typecheck:poly`, `pnpm --filter @cogni/poly-app lint`, `pnpm check:docs` all clean

## Out of Scope

vNext copy-trade CTA — parked until Harvard-flagged-dataset storage and admin-role gate are decided.
