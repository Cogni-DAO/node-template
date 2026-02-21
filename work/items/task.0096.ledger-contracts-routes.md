---
id: task.0096
type: task
title: "Ledger Zod contracts + API routes (4 write, 5 read) + stack tests"
status: needs_design
priority: 1
rank: 5
estimate: 2
summary: "Define Zod contracts for all ledger endpoints and implement 9 API routes: 4 write (→ Temporal 202 or direct) + 5 read (→ direct DB). Stack tests prove full pipeline."
outcome: "Full ledger API operational. Stack tests prove end-to-end: collect epoch → review allocations → record pool → finalize → verify."
spec_refs: epoch-ledger-spec
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch: feat/ledger-v0
pr:
reviewer:
revision: 0
blocked_by: task.0095
deploy_verified: false
created: 2026-02-20
updated: 2026-02-21
labels: [governance, ledger, api]
external_refs:
---

# Ledger Zod Contracts + API Routes

## Requirements

- Zod contracts in `src/contracts/`:
  - `ledger.collect-epoch.v1.contract.ts` — input: period_start, period_end, weight_config; output: 202 + workflowId
  - `ledger.update-allocations.v1.contract.ts` — input: array of {userId, finalUnits, overrideReason}; output: updated allocations
  - `ledger.record-pool-component.v1.contract.ts` — input: component fields; output: 202 + workflowId
  - `ledger.finalize-epoch.v1.contract.ts` — input: epochId; output: 202 + workflowId
  - `ledger.list-epochs.v1.contract.ts` — output: epoch array
  - `ledger.epoch-activity.v1.contract.ts` — output: activity event array
  - `ledger.epoch-allocations.v1.contract.ts` — output: allocation array
  - `ledger.epoch-statement.v1.contract.ts` — output: payout statement
  - `ledger.verify-epoch.v1.contract.ts` — output: verification report

- 4 write routes under `src/app/api/v1/ledger/`:
  - `POST /epochs/collect` — requires SIWE + admin, starts CollectEpochWorkflow, returns 202
  - `PATCH /epochs/[id]/allocations` — requires SIWE + admin, updates final_units directly
  - `POST /epochs/[id]/pool-components` — requires SIWE + admin, inserts pool component
  - `POST /epochs/[id]/finalize` — requires SIWE + admin, starts FinalizeEpochWorkflow, returns 202

- 5 read routes (public, direct DB):
  - `GET /epochs` — list all epochs
  - `GET /epochs/[id]/activity` — activity events for an epoch
  - `GET /epochs/[id]/allocations` — proposed + final allocations
  - `GET /epochs/[id]/statement` — payout statement for a closed epoch
  - `GET /verify/epoch/[id]` — recompute payouts from stored data + compare

- Write routes use `wrapRouteHandlerWithLogging` with `auth: { mode: "required" }`, check admin, start Temporal workflow or update DB, return 202 or result
- Read routes use `wrapRouteHandlerWithLogging`, query `ActivityLedgerStore` directly
- Stack tests proving full pipeline: create epoch → seed activity events → compute allocations → record pool → finalize → verify

## Allowed Changes

- `src/contracts/ledger.*.v1.contract.ts` (new, ~9 files)
- `src/app/api/v1/ledger/` (new route directory tree)
- `tests/stack/ledger/` (new stack test files)

## Plan

- [ ] Create Zod contract files (9 contracts)
- [ ] Implement 4 write route handlers with SIWE auth + admin check
- [ ] Implement 5 read route handlers with direct DB queries via ActivityLedgerStore
- [ ] Implement verification endpoint: recompute allocations from events + weight_config, recompute payouts, compare
- [ ] Write stack test: full epoch lifecycle (collect → review → pool → finalize → verify)

## Validation

**Command:**

```bash
pnpm check
pnpm dotenv -e .env.test -- vitest run --config vitest.stack.config.mts tests/stack/ledger/
```

**Expected:** Types pass, full pipeline stack test green.

## Review Checklist

- [ ] **Work Item:** `task.0096` linked in PR body
- [ ] **Spec:** all invariants verified end-to-end by stack test
- [ ] **Tests:** stack test covers happy path + idempotency + error cases (unauthorized, finalize without pool)
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
