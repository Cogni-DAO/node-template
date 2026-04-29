---
id: task.0423
type: task
title: "Port poly PositionsTable onto reui DataGrid (mirror wallets-table)"
status: needs_implement
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
updated: 2026-04-29
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

## Design

### Outcome

Every poly table-of-X uses the same reui DataGrid kit + per-column-header controls, starting with `PositionsTable`. Users on `/research/w/[addr]` and `/dashboard` get the same column-controls UX they get on `/research`. Future tables in poly extend this pattern with zero design re-litigation.

### Approach

**Solution:** Create `nodes/poly/app/src/app/(app)/_components/positions-table/` mirroring the structure of the sibling `_components/wallets-table/`:

- `PositionsTable.tsx` — `"use client"`, accepts `positions`, `variant`, `isLoading`, `onPositionAction`, `pendingActionPositionId`, `emptyMessage`. Builds a TanStack `useReactTable` with `getCoreRowModel + getSortedRowModel + getFilteredRowModel`, picks a `VisibilityState` per variant, renders inside `<DataGrid>/<DataGridContainer>/<DataGridTable />`. No pagination (positions lists are short).
- `columns.tsx` — `makeColumns({ variant, onPositionAction, pendingActionPositionId })` returning the seven column defs:
  - `market` — `col.display` (sort by `marketTitle` via custom `accessorFn`); cell renders the existing link/outcome block.
  - `trace` — `col.display`, `enableSorting: false`, `enableHiding: false`, `size: 288`. Cell wraps `<PositionTimelineChart>` unchanged.
  - `heldMinutes` — `col.accessor("heldMinutes")`, right-aligned, sortable; cell uses existing `formatHeldDuration()`.
  - `currentValue` — accessor; **only included when variant === "default"**.
  - `closedAt` — accessor; **only included when variant === "history"**.
  - `pnlUsd` — accessor; right-aligned, sortable; tabular-nums; success/destructive color from sign.
  - `pnlPct` — accessor; same coloring rules.
  - `action` — `col.display`, `enableSorting: false`, `enableHiding: false`; **only included when variant === "default"**. Cell renders the existing `PositionActionButton` logic verbatim.
- `index.ts` — `export { PositionsTable } from "./PositionsTable"; export type { PositionsTableProps } from "./PositionsTable";`

**Caller swap:**

- `nodes/poly/app/src/features/wallet-analysis/index.ts` — replace the re-export of the old component with one pointing at the new path. Type signature is unchanged so `/research/w/[addr]` does not need to change.
- `nodes/poly/app/src/app/(app)/dashboard/_components/ExecutionActivityCard.tsx` — update the import path (or rely on the re-export — verify in implementation).
- Delete `nodes/poly/app/src/features/wallet-analysis/components/PositionsTable.tsx`.
- Update `nodes/poly/app/src/features/wallet-analysis/AGENTS.md` if it documents the old path.

**Reuses:**

- `@/components/reui/data-grid/{data-grid,data-grid-table,data-grid-column-header}` — already vendored, already in production via `WalletsTable`.
- `@tanstack/react-table` — already a dep; same `useReactTable` glue as `WalletsTable`.
- `PositionTimelineChart`, `PositionActionButton`-equivalent logic, all existing format helpers (`formatHeldDuration`, `formatUsd`, `formatSignedUsd`, `formatSignedPct`, `formatClosedAt`) — copied verbatim into the new module (no behavior change).
- `WalletPosition` type from `@features/wallet-analysis/types/wallet-analysis` — unchanged.

**Rejected:**

- **Generic `_components/data-table/` shell extraction.** Premature with only two tables. Will re-evaluate once a third table appears (per `proj.premium-frontend-ux` roadmap). Drives complexity (variant-prop unions, generic column factories) without payoff.
- **In-place upgrade of `features/wallet-analysis/components/PositionsTable.tsx`** instead of a new module. Rejected because the wallets-table convention is `app/(app)/_components/<table-name>/`, and we want positions-table to be discoverable next to its sibling for the next agent.
- **Adding faceted filters in v0.** Positions don't have an obvious enum facet today (status enum has 3 values, lifecycleState 11 — both noisy). Defer until users ask.
- **TanStack Table virtualization.** Positions lists are short (typically <50 rows). DataGrid kit doesn't ship a virtualizer wrapper for the basic table; adding one is out of scope.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] HEADER_OWNS_CONTROLS: Sort + visibility live on the column header dropdown via `DataGridColumnHeader`. No bespoke toolbar above the table.
- [ ] BEHAVIOR_PARITY: Every column the old `PositionsTable` rendered renders here, with the same formatting and the same conditional show/hide for `default | history`. Action button preserves the lifecycle-gating logic verbatim (`isLoser`, `isRedeemable`, `isCloseable`, `busy`, title text).
- [ ] NO_NEW_DEPS: Uses existing reui kit + TanStack Table; no package.json changes.
- [ ] SIMPLE_SOLUTION: Mirrors `WalletsTable` structure 1:1; no shared abstraction extracted (spec: architecture).
- [ ] ARCHITECTURE_ALIGNMENT: New module lives at `app/(app)/_components/positions-table/` next to the sibling `wallets-table/`; old hand-rolled file is deleted (no backwards-compat shim) — per CLAUDE.md "no backwards-compatibility hacks".
- [ ] TYPED_VARIANTS: `variant: "default" | "history"` is the same discriminator used today; types unchanged at the boundary.

### Files

<!-- High-level scope -->

- Create: `nodes/poly/app/src/app/(app)/_components/positions-table/PositionsTable.tsx` — DataGrid wrapper.
- Create: `nodes/poly/app/src/app/(app)/_components/positions-table/columns.tsx` — TanStack column defs.
- Create: `nodes/poly/app/src/app/(app)/_components/positions-table/index.ts` — public surface.
- Modify: `nodes/poly/app/src/features/wallet-analysis/index.ts` — re-export from new path.
- Modify: `nodes/poly/app/src/app/(app)/dashboard/_components/ExecutionActivityCard.tsx` — import from new path (or via the re-export).
- Modify: `nodes/poly/app/src/features/wallet-analysis/AGENTS.md` — point to new module.
- Delete: `nodes/poly/app/src/features/wallet-analysis/components/PositionsTable.tsx`.
- Test: existing call sites + Phase 3 candidate-a self-validation. (Component-test parity with the old hand-rolled file is not maintained today; no new vitest required.)
