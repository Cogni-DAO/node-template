---
id: task.0094
type: task
title: "Ledger port interface + Drizzle adapter + container wiring"
status: needs_implement
priority: 1
rank: 2
estimate: 2
summary: "Define LedgerStore port interface, implement Drizzle adapter, wire into bootstrap container, add contract tests."
outcome: "LedgerStore port with full CRUD for receipts/epochs/pool/statements. Drizzle adapter passes contract tests. Container exposes ledgerStore."
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
updated: 2026-02-20
labels: [governance, ledger, adapter]
external_refs:
---

# Ledger Port + Drizzle Adapter

## Requirements

- `LedgerStore` port at `src/ports/ledger-store.port.ts` with methods for:
  - Issuer queries: `getIssuer(address)`, `requireIssuer(address, role)`
  - Epoch CRUD: `createEpoch(...)`, `getOpenEpoch()`, `closeEpoch(epochId, poolTotal)`, `getEpoch(id)`, `listEpochs()`
  - Receipt writes: `insertReceipt(...)`, `getReceiptByIdempotencyKey(key)`
  - Receipt event writes: `insertReceiptEvent(...)`
  - Receipt reads: `getReceiptsForEpoch(epochId)`, `getApprovedReceiptsForEpoch(epochId)` (latest event = approved)
  - Pool component writes: `insertPoolComponent(...)`
  - Pool component reads: `getPoolComponentsForEpoch(epochId)`
  - Statement writes: `insertPayoutStatement(...)`
  - Statement reads: `getStatementForEpoch(epochId)`
- Port-level error classes: `IssuerNotFoundPortError`, `EpochNotFoundPortError`, `ReceiptNotFoundPortError`
- Drizzle adapter at `src/adapters/server/ledger/drizzle-ledger.ts` implementing `LedgerStore` (app-side)
- Worker-facing adapter: `DrizzleLedgerWorkerAdapter` in `packages/db-client/` (follows existing `DrizzleExecutionGrantWorkerAdapter` pattern — `scheduler-worker` cannot import from `src/`)
- Adapter uses `serviceDb` (BYPASSRLS) — Temporal worker context, not user-scoped
- Wire into `src/bootstrap/container.ts`: `ledgerStore: LedgerStore`
- Export from `src/ports/index.ts` and `src/adapters/server/index.ts`
- Contract test at `tests/contract/ledger-store.contract.ts`

## Allowed Changes

- `src/ports/ledger-store.port.ts` (new)
- `src/ports/index.ts` (add export)
- `src/adapters/server/ledger/` (new directory)
- `src/adapters/server/index.ts` (add export)
- `src/bootstrap/container.ts` (wire adapter)
- `packages/db-client/src/ledger/` (new — `DrizzleLedgerWorkerAdapter` for scheduler-worker)
- `packages/db-client/src/index.ts` (add ledger adapter export)
- `tests/contract/ledger-store.contract.ts` (new)

## Plan

- [ ] Define `LedgerStore` interface in `src/ports/ledger-store.port.ts` with error classes
- [ ] Export from `src/ports/index.ts`
- [ ] Implement `DrizzleLedgerStore` in `src/adapters/server/ledger/drizzle-ledger.ts`
- [ ] Export from `src/adapters/server/index.ts`
- [ ] Implement `DrizzleLedgerWorkerAdapter` in `packages/db-client/src/ledger/` (worker-facing subset)
- [ ] Export from `packages/db-client/src/index.ts`
- [ ] Add `ledgerStore` to `Container` interface and wire in `container.ts`
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
- [ ] **Spec:** APPROVED_RECEIPTS_ONLY (adapter filters by latest event), ISSUER_AUTHORIZED (requireIssuer checks role flags)
- [ ] **Tests:** contract test covers all port methods including error cases
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
