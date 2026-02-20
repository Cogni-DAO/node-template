---
id: task.0096
type: task
title: "Ledger Zod contracts + API routes (5 write, 4 read)"
status: needs_implement
priority: 1
rank: 4
estimate: 2
summary: "Define Zod contracts for all ledger endpoints and implement 9 API routes: 5 write (→ Temporal 202) + 4 read (→ direct DB)."
outcome: "Full ledger API operational. Stack tests prove end-to-end: open epoch → issue receipt → approve → record pool → close → verify."
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
updated: 2026-02-20
labels: [governance, ledger, api]
external_refs:
---

# Ledger Zod Contracts + API Routes

## Requirements

- Zod contracts in `src/contracts/`:
  - `ledger.open-epoch.v1.contract.ts` — input: policy ref fields; output: 202 + workflowId
  - `ledger.issue-receipt.v1.contract.ts` — input: receipt fields + signature; output: 202 + workflowId
  - `ledger.receipt-event.v1.contract.ts` — input: event_type + reason; output: 202 + workflowId
  - `ledger.record-pool-component.v1.contract.ts` — input: component fields; output: 202 + workflowId
  - `ledger.close-epoch.v1.contract.ts` — input: (none beyond epoch ID); output: 202 + workflowId
  - `ledger.list-epochs.v1.contract.ts` — output: epoch array
  - `ledger.epoch-receipts.v1.contract.ts` — output: receipt array with latest events
  - `ledger.epoch-statement.v1.contract.ts` — output: payout statement
  - `ledger.verify-epoch.v1.contract.ts` — output: verification report
- 5 write routes under `src/app/api/v1/ledger/`:
  - `POST /epochs` — requires SIWE + `can_close_epoch`, starts OpenEpochWorkflow
  - `POST /receipts` — requires SIWE + `can_issue`, starts IssueReceiptWorkflow
  - `POST /receipts/[id]/events` — requires SIWE + `can_approve`, starts ReceiptEventWorkflow
  - `POST /epochs/[id]/pool-components` — requires SIWE + `can_close_epoch`, starts RecordPoolComponentWorkflow
  - `POST /epochs/[id]/close` — requires SIWE + `can_close_epoch`, starts CloseEpochWorkflow
- 4 read routes (public, direct DB):
  - `GET /epochs` — list all epochs
  - `GET /epochs/[id]/receipts` — receipts with latest events
  - `GET /epochs/[id]/statement` — payout statement
  - `GET /verify/epoch/[id]` — independent verification (re-verify signatures, recompute payouts, compare)
- Write routes use `wrapRouteHandlerWithLogging` with `auth: { mode: "required" }`, check issuer role, start Temporal workflow, return 202
- Read routes use `wrapRouteHandlerWithLogging`, query `LedgerStore` directly
- Stack tests proving full pipeline: seed issuer → open epoch → issue receipt → approve → record pool component → close → verify

## Allowed Changes

- `src/contracts/ledger.*.v1.contract.ts` (new, ~9 files)
- `src/app/api/v1/ledger/` (new route directory tree)
- `tests/stack/ledger/` (new stack test files)

## Plan

- [ ] Create Zod contract files (9 contracts)
- [ ] Implement 5 write route handlers with SIWE auth + issuer role check + Temporal workflow start
- [ ] Implement 4 read route handlers with direct DB queries via LedgerStore
- [ ] Implement verification endpoint: re-verify EIP-191 signatures + recompute payouts + compare hashes
- [ ] Write stack test: full epoch lifecycle (open → receipt → approve → pool → close → verify)

## Validation

**Command:**

```bash
pnpm check
pnpm dotenv -e .env.test -- vitest run --config vitest.stack.config.mts tests/stack/ledger/
```

**Expected:** Types pass, full pipeline stack test green.

## Review Checklist

- [ ] **Work Item:** `task.0096` linked in PR body
- [ ] **Spec:** all 17 invariants verified end-to-end by stack test
- [ ] **Tests:** stack test covers happy path + idempotency + error cases (unauthorized, duplicate receipt, close without pool)
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
