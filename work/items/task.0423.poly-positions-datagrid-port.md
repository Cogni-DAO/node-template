---
id: task.0423
type: task
title: "Port poly PositionsTable onto reui DataGrid (mirror wallets-table)"
status: needs_design
priority: 1
rank: 1
estimate: 2
summary: "Standardize poly's positions table on the same reui DataGrid + per-column-header controls pattern that the wallets research table (`/research`) uses. Today `features/wallet-analysis/components/PositionsTable.tsx` is hand-rolled shadcn `<Table>` primitives with no sort, no column-hide, no faceted filters; the wallets table at `_components/wallets-table/` is the canonical pattern (DataGridColumnHeader owns sort+filter+hide, no toolbar). Porting positions to the same kit gives users the column controls Derek loves on the research page, and standardizes the pattern poly will follow for any future table-of-X."
outcome: "PositionsTable rendered via DataGrid + TanStack column defs (id, accessor, header={DataGridColumnHeader}, cell). All existing columns preserved verbatim — Market (link + outcome), Trace (PositionTimelineChart), Held, Current/Closed, P/L, P/L %, Action — and both `default` and `history` variants work. Per-header dropdown gives sort + visibility on every column (filters left out v0 — no obvious facet). Two callers swapped over (`features/wallet-analysis/index` re-export + `dashboard/_components/ExecutionActivityCard`); old hand-rolled file deleted. No new shared abstraction; positions-table simply becomes the second consumer of the existing `components/reui/data-grid/*` kit."
spec_refs:
assignees: [derekg1729]
project: proj.premium-frontend-ux
branch: feat/poly-positions-datagrid
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-28
updated: 2026-04-28
labels: [ui, ux, poly, frontend]
---

# Port poly PositionsTable onto reui DataGrid

## Problem

`/research` (the wallet leaderboard at `nodes/poly/app/src/app/(app)/_components/wallets-table/`) renders through the vendored reui DataGrid kit:

- `DataGridColumnHeader` owns sort + filter + hide on every column (no parallel toolbar)
- `WALLET_TABLE_SINGLETON` invariant — every wallets table in the app goes through it
- Skeleton loading, faceted filters, sticky/dense layout, optional pagination

The poly **positions** table (`nodes/poly/app/src/features/wallet-analysis/components/PositionsTable.tsx`) is hand-rolled shadcn `<Table>` primitives. No sort, no column-hide, no controls — just rows.

Two surfaces render it:

- `features/wallet-analysis/index.ts` re-exports it (consumed by `/research/w/[addr]` wallet detail page)
- `app/(app)/dashboard/_components/ExecutionActivityCard.tsx` — dashboard card showing the operator's positions

Derek likes the wallets-table column controls and wants every poly table to use the same pattern.

## Approach

Port `PositionsTable` to a new module `nodes/poly/app/src/app/(app)/_components/positions-table/` that mirrors `_components/wallets-table/`'s structure exactly:

- `PositionsTable.tsx` — thin DataGrid wrapper, owns variant → column-visibility mapping
- `columns.tsx` — TanStack column defs using `createColumnHelper<WalletPosition>()` and `DataGridColumnHeader`
- `index.ts` — public surface

**Variants:** `default` (Market, Trace, Held, Current, P/L, P/L %, Action) and `history` (Market, Trace, Held, Closed, P/L, P/L %; no Action). Implemented the same way wallets-table handles `full | copy-traded` — a `VisibilityState` map per variant.

**Controls scope (v0):** sort + visibility on every column. No faceted filters yet (no obvious enum facet on positions). Trace column is non-sortable, fixed width. Action column is non-sortable, non-hideable.

**No new shared package.** Positions-table is the second consumer of the existing reui kit. Once a third table appears we can extract a generic shell — until then, premature.

## Allowed Changes

- **Add** `nodes/poly/app/src/app/(app)/_components/positions-table/{PositionsTable.tsx,columns.tsx,index.ts}`
- **Edit** `nodes/poly/app/src/app/(app)/dashboard/_components/ExecutionActivityCard.tsx` — swap import
- **Edit** `nodes/poly/app/src/features/wallet-analysis/index.ts` — re-export from new module
- **Delete** `nodes/poly/app/src/features/wallet-analysis/components/PositionsTable.tsx` after callers migrated
- **Edit** `nodes/poly/app/src/features/wallet-analysis/AGENTS.md` if it referenced the old path

Out of scope:

- Generic `_components/data-table/` shell extraction
- Adding faceted filters to positions
- New columns or behavior changes
- Touching `PositionTimelineChart` itself

## Validation

exercise:

- GET `https://test.cognidao.org/research/w/<known-wallet-addr>` — page renders new positions table; every column header has the dropdown chevron; clicking "P/L %" sorts; clicking the eye/menu hides a column.
- GET `https://test.cognidao.org/dashboard` — operator's positions card (`ExecutionActivityCard`) renders the new table; Close/Redeem button still appears for open positions.
- History variant: confirm a wallet with closed positions shows the "Closed" column instead of "Current" + Action (use any wallet with realized P/L).

observability:

- Loki query at deployed SHA: `{app="poly", env="candidate"} |= "/research/w/" |= "<my-test-wallet>"` returns the request line for my own page load.
- Loki query: `{app="poly", env="candidate"} |= "/dashboard" | json | http_status="200"` returns my dashboard load.
- SHA in `/version` matches PR head sha.
