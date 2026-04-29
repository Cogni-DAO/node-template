---
id: task.0429
type: task
title: "Poly wallet order-flow distributions D1 — pure module + on-demand UI with win/loss split"
status: needs_merge
priority: 1
rank: 1
estimate: 3
summary: "Ship Checkpoint D1 of the wallet-analysis distributions deep dive: pure `summariseOrderFlow(trades, resolutions)` module under `nodes/poly/packages/market-provider/src/analysis/`, Zod-typed `distributions` slice on `GET /api/v1/poly/wallets/[addr]`, and a `DistributionsBlock` organism rendering 6 stacked histograms (DCA depth, trade size, entry price, DCA window, hour-of-day, plus flat event clustering). Every fill is classified won/lost/pending via the existing `MarketResolutionInput` shape. Toolbar toggles count↔USDC. One pure module, one route extension, shared resolution-map fan-out."
outcome: "User opens `/poly/research/w/0x2005d16a84ceefa912d4e380cd32e7ff827875ea` on candidate-a and sees six stacked histograms with green/red/grey outcome bands and a count↔USDC toggle. Pending share caption sits above the charts. `GET /api/v1/poly/wallets/0x…?include=snapshot,distributions` returns one response with both slices and `distributions.range.n > 0`. Loki shows the request at the deployed SHA."
spec_refs:
  - docs/design/wallet-analysis-components.md
assignees: [derekg1729]
credit:
project: proj.poly-prediction-bot
branch: feat/poly-wallet-orderflow-d1
pr: https://github.com/Cogni-DAO/node-template/pull/1137
reviewer:
revision: 2
blocked_by: []
deploy_verified: false
created: 2026-04-29
updated: 2026-04-29
labels: [poly, wallet-research, ui, distributions, copy-trade-targets]
external_refs:
  - docs/research/poly-wallet-orderflow-2026-04-29.md
---

# task.0429 — Poly wallet order-flow distributions D1

> Originally filed as task.0425 but renumbered after PR #1125 (`refactor(poly): poly-specific packages under nodes/poly/packages/`) shipped on the same id. This work was rebased onto the carved-out package layout (`@cogni/poly-market-provider`, `@cogni/poly-node-contracts`) before push.

## Why

The 2026-04-28 curve screen ranked our top-2 target wallets correctly, but the per-trade behaviour is only legible at the order-flow level — DCA depth, event clustering, entry-price band, time-of-day. The 2026-04-29 research run produced this data via two ad-hoc scripts; D1 promotes it into the live `WalletAnalysisView` so any 0x address renders six distributions on demand, with each fill split won/lost/pending and a count↔USDC toolbar toggle.

## Scope (D1 only)

Pure module + on-demand UI. **Excludes** D2 (`poly_target_fills` + `poly_market_resolutions` Doltgres persistence + AI-tool wrapper) and D3 (on-chain backfill).

## What ships

| File | Role |
| --- | --- |
| `nodes/poly/packages/market-provider/src/analysis/order-flow-distributions.ts` | Pure `summariseOrderFlow(trades, resolutions, opts)` — mirrors `computeWalletMetrics` signature |
| `nodes/poly/packages/market-provider/tests/order-flow-distributions.test.ts` | 13 unit tests including a JSON-roundtrip regression for the bucket-edge sentinel |
| `nodes/poly/packages/node-contracts/src/poly.wallet-analysis.v1.contract.ts` | Add `distributions` slice + `WalletAnalysisDistributionsSchema` + `distributionMode` query param |
| `nodes/poly/app/src/app/api/v1/poly/wallets/[addr]/route.ts` | Wire `distributions` slice |
| `nodes/poly/app/src/features/wallet-analysis/server/wallet-analysis-service.ts` | `getDistributionsSlice` reusing `trades:${addr}` + `resolution:${cid}` coalesce keys (one upstream fan-out for snapshot+distributions) |
| `nodes/poly/app/src/features/wallet-analysis/components/DistributionsBlock.tsx` | Lazy-loaded organism: toolbar + 6 chart molecules co-located, CSS-only stacked bars |
| `useWalletAnalysis`, `WalletAnalysisSurface`, `WalletAnalysisView`, types | Wire `includeDistributions` opt-in (page variant only) |

## Invariants enforced (from design)

- `DISTRIBUTIONS_ARE_PURE_DERIVATIONS` — `f(trades, resolutions, range)`
- `RESOLUTIONS_FETCHED_ONCE_PER_REQUEST` — handler reuses snapshot's resolution coalesce keys
- `RESOLUTION_TTL_BY_STATUS` — pre-existing 30s uniform TTL inherited from snapshot path; full split deferred (out of scope for this PR)
- `PENDING_IS_FIRST_CLASS` — three-state outcome everywhere
- `TWO_PATHS_ONE_SHAPE` — D1 ships `live` mode only; the `historical` branch returns a `distributions_unavailable` warning until D2

## Validation

exercise:
1. Open `/poly/research/w/0x2005d16a84ceefa912d4e380cd32e7ff827875ea` while signed in on candidate-a.
2. Confirm DistributionsBlock renders six stacked histograms with non-zero pending share caption and a count↔USDC toggle.
3. Click USDC; bar heights re-scale, outcome bands stay aligned.
4. `curl 'https://poly.<candidate-a>/api/v1/poly/wallets/0x2005…?include=snapshot,distributions'` returns one response with both slices and `distributions.range.n > 0`.

observability:
- Loki query `{app="poly", route="/api/v1/poly/wallets/[addr]"}` at the deployed SHA shows one log line per request including the user's reqId.

## Review Feedback

**Self-review (rev 1):** caught and fixed three blockers — `MarketResolutionInput` re-export missing from test import; `Section/ChartCard children` type-check failure (unimported `React.ReactNode` + `ReactElement` rejecting siblings); `Number.POSITIVE_INFINITY` bucket edges → `null` on the wire violating `HistogramBucketSchema.hi: z.number()`. Added a JSON round-trip regression test for the bucket-edge sentinel.

**Rebase (rev 2):** PR #1125 (`task.0425`: per-node package carveout) merged after this branch was pushed and moved both `packages/market-provider` and the poly contracts under `nodes/poly/packages/`. Branch was reset to `origin/main`, all changes re-applied at the new paths, and the work item renumbered task.0425 → task.0429 to avoid id collision with the carveout PR.

## Risk

- Cold-load Gamma fetch storm on wallets with many unique markets (RN1: 248 markets). Mitigation: shared resolution map already in scope; route's `p-limit(4)` already covers fan-out.
- Stacked-bar legend rendering quirks at small viewport widths. Mitigation: drawer variant excludes DistributionsBlock entirely (`page` variant only).
