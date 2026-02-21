---
id: task.0094
type: task
title: "Ledger port interface + Drizzle adapter + schema migration + container wiring"
status: needs_design
priority: 1
rank: 2
estimate: 2
summary: "Define ActivityLedgerStore port, implement Drizzle adapter, add schema migration for activity_events/epoch_allocations/source_cursors + epochs modifications, wire into bootstrap container."
outcome: "ActivityLedgerStore port with CRUD for activity events, allocations, cursors, epochs, pool, and statements. Drizzle adapter passes contract tests. Container exposes activityLedgerStore."
spec_refs: epoch-ledger-spec
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch: feat/ledger-v0
pr:
reviewer:
revision: 0
blocked_by: task.0093
deploy_verified: false
created: 2026-02-20
updated: 2026-02-21
labels: [governance, ledger, adapter]
external_refs:
---

# Ledger Port + Drizzle Adapter + Schema Migration

## Requirements

- `ActivityLedgerStore` port at `src/ports/ledger-store.port.ts` with methods for:
  - Epoch CRUD: `createEpoch(...)`, `getOpenEpoch()`, `closeEpoch(epochId, poolTotal)`, `getEpoch(id)`, `listEpochs()`
  - Activity events: `insertActivityEvents(events[])` (idempotent — PK conflict = skip), `getActivityForEpoch(epochId)`, `getUnresolvedActivity(epochId)` (user_id IS NULL)
  - Identity resolution: `resolveActivityIdentity(eventId, userId)` — sets user_id on an activity event (only NULL → value, not update)
  - Allocations: `insertAllocations(allocations[])`, `updateAllocation(epochId, userId, finalUnits, overrideReason)`, `getAllocationsForEpoch(epochId)`
  - Cursors: `upsertCursor(source, stream, scope, cursorValue)`, `getCursor(source, stream, scope)`
  - Pool component writes: `insertPoolComponent(...)`
  - Pool component reads: `getPoolComponentsForEpoch(epochId)`
  - Statement writes: `insertPayoutStatement(...)`
  - Statement reads: `getStatementForEpoch(epochId)`
- Port-level error classes: `EpochNotFoundPortError`, `AllocationNotFoundPortError`
- Drizzle schema additions in `packages/db-schema/src/ledger.ts`:
  - `activityEvents` table (append-only, provenance fields, DB trigger)
  - `epochAllocations` table (proposed + final units, UNIQUE(epoch_id, user_id))
  - `sourceCursors` table (PK: source, stream, scope)
  - `epochs` table modifications: add `periodStart`, `periodEnd`, `weightConfig`; policy\_\* columns become nullable (kept for backward compat, not used in V0)
- Drizzle migration generated + custom SQL for `activity_events` append-only trigger
- Drizzle adapter at `src/adapters/server/ledger/drizzle-ledger.ts` implementing `ActivityLedgerStore`
- Worker-facing adapter: `DrizzleLedgerWorkerAdapter` in `packages/db-client/` (follows existing `DrizzleExecutionGrantWorkerAdapter` pattern)
- Adapter uses `serviceDb` (BYPASSRLS)
- Wire into `src/bootstrap/container.ts`: `activityLedgerStore: ActivityLedgerStore`
- Export from `src/ports/index.ts` and `src/adapters/server/index.ts`
- Contract test at `tests/contract/ledger-store.contract.ts`

## Allowed Changes

- `packages/db-schema/src/ledger.ts` (add new tables, modify epochs)
- `packages/db-schema/src/index.ts` (already exports ledger)
- `src/adapters/server/db/migrations/` (new migration files)
- `src/ports/ledger-store.port.ts` (new)
- `src/ports/index.ts` (add export)
- `src/adapters/server/ledger/` (new directory)
- `src/adapters/server/index.ts` (add export)
- `src/bootstrap/container.ts` (wire adapter)
- `packages/db-client/src/ledger/` (new — worker adapter)
- `packages/db-client/src/index.ts` (add ledger adapter export)
- `tests/contract/ledger-store.contract.ts` (new)

## Plan

- [ ] Add `activityEvents`, `epochAllocations`, `sourceCursors` tables to `packages/db-schema/src/ledger.ts`
- [ ] Modify `epochs` table: add `periodStart`, `periodEnd`, `weightConfig`; make `policy_*` nullable
- [ ] Generate Drizzle migration + add custom SQL for `activity_events` append-only trigger
- [ ] Define `ActivityLedgerStore` interface in `src/ports/ledger-store.port.ts` with error classes
- [ ] Export from `src/ports/index.ts`
- [ ] Implement `DrizzleLedgerStore` in `src/adapters/server/ledger/drizzle-ledger.ts`
- [ ] Export from `src/adapters/server/index.ts`
- [ ] Implement `DrizzleLedgerWorkerAdapter` in `packages/db-client/src/ledger/`
- [ ] Export from `packages/db-client/src/index.ts`
- [ ] Add `activityLedgerStore` to `Container` interface and wire in `container.ts`
- [ ] Write contract test exercising all methods against real DB

## Validation

**Command:**

```bash
pnpm check
pnpm test tests/contract/ledger-store.contract.ts
```

**Expected:** Types pass, contract tests green against test DB.

## Review Checklist

- [ ] **Work Item:** `task.0094` linked in PR body
- [ ] **Spec:** ACTIVITY_APPEND_ONLY (trigger), ACTIVITY_IDEMPOTENT (PK skip), EPOCH_WINDOW_UNIQUE, CURSOR_STATE_PERSISTED
- [ ] **Tests:** contract test covers all port methods including error cases
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
