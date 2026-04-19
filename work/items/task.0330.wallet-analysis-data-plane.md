---
id: task.0330
type: task
title: "Wallet analysis Part 2 — snapshot table + API route + dynamic /research/w/[addr]"
status: needs_design
priority: 2
rank: 5
estimate: 3
created: 2026-04-19
updated: 2026-04-19
summary: "Add poly_wallet_screen_snapshots DDL + seed script, a Zod-defined GET /api/v1/poly/wallets/[addr] route routing through the existing PolymarketDataApiClient with server-side coalescing, a useWalletAnalysis React Query hook, and a dynamic /research/w/[addr] page. BeefSlayer on /research switches to the live hook."
outcome: "Any roster wallet renders at /research/w/[addr]. Off-roster addresses 404. Concurrent requests for the same addr collapse to one upstream Data-API call. BeefSlayer on /research shows API-served numbers identical to task.0329 hardcoded values."
spec_refs:
  - docs/design/wallet-analysis-components.md
assignees: []
credit:
project: proj.poly-prediction-bot
branch:
pr:
reviewer:
revision: 0
blocked_by: [task.0329]
deploy_verified: false
labels: [poly, wallet-analysis, api, db]
---

# task.0330 — Wallet Analysis: Data Plane (Part 2)

## Problem

`WalletAnalysisView` from task.0329 takes pure props. We need to feed it from a real backend so any roster wallet works, with snapshot data from the DB and live data from the existing Polymarket adapter — without exposing the node as a free Data-API proxy.

## Scope

In:

- Drizzle schema + migration (DDL only) for `poly_wallet_screen_snapshots`:
  `wallet`, `screen_version`, `taken_at`, `category`, `n`, `wr`, `roi`, `pnl_usd`, `dd_pct`, `median_dur_min`, `hypothesis_md`, PK `(wallet, screen_version)`
- Seed script `pnpm --filter @cogni/poly-app run seed:wallet-screen` — idempotent import of `docs/research/fixtures/poly-wallet-screen-v3-*.json`
- Zod contract `nodes/poly/app/src/contracts/http/poly.wallet-analysis.v1.contract.ts` — request (addr regex + include set) + response shape
- Route handler `nodes/poly/app/src/app/api/v1/poly/wallets/[addr]/route.ts` — addr lowercase + roster check (404 if off-roster) + slice fan-out
- Live slices (trades, balance, positions) via existing `PolymarketDataApiClient` — **no new client**
- Server-side `unstable_cache` per (slice, addr) with 30 s TTL
- Client `useWalletAnalysis(addr)` React Query hook with three slice keys
- `/research/w/[addr]` dynamic page (auth-gated server shell)
- `/research` BeefSlayer block re-wires to `useWalletAnalysis`
- Stack test exercising cache-stampede behaviour

Out:

- Drawer integration on dashboard (Part 3)
- Copy-trade CTA (vNext)
- Any new Data-API client code

## Validation

- [ ] Migration applies cleanly; seed script is idempotent.
- [ ] `addr` not matching `^0x[a-f0-9]{40}$` → 400 from contract validation.
- [ ] `addr ∉ roster` → 404.
- [ ] Ten concurrent requests for the same addr produce one upstream Data-API call (verified by spy in stack test).
- [ ] BeefSlayer on `/research` renders identical numbers to task.0329's hardcoded baseline.
- [ ] Off-roster wallet at `/research/w/[addr]` returns the page-level 404.
- [ ] No second `Polymarket*Client` exists in `nodes/poly/app/`.
- [ ] `pnpm typecheck:poly`, `pnpm --filter @cogni/poly-app lint`, `pnpm check:docs` all clean.

## Out of Scope

task.0331 selection flow; vNext copy-trade.
