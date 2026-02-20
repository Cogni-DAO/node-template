---
id: task.0095
type: task
title: "Ledger Temporal workflows (5 workflows + activities)"
status: needs_implement
priority: 1
rank: 3
estimate: 3
summary: "Implement 5 Temporal workflows (open epoch, issue receipt, receipt event, record pool component, close epoch) + activity functions with DI injection in scheduler-worker."
outcome: "All ledger writes execute as idempotent Temporal workflows. Close epoch produces deterministic payout statement."
spec_refs: epoch-ledger-spec
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch: feat/ledger-v0
pr:
reviewer:
revision: 0
blocked_by: task.0094
deploy_verified: false
created: 2026-02-20
updated: 2026-02-20
labels: [governance, ledger, temporal]
external_refs:
---

# Ledger Temporal Workflows

## Requirements

- 5 workflows in `services/scheduler-worker/src/workflows/`:
  - `open-epoch.workflow.ts` — validates `can_close_epoch`, checks ONE_OPEN_EPOCH, inserts epoch with pinned policy
  - `issue-receipt.workflow.ts` — validates `can_issue`, verifies open epoch, verifies EIP-191 signature (SIGNATURE_DOMAIN_BOUND), inserts receipt + `proposed` event (IDEMPOTENT_RECEIPTS)
  - `receipt-event.workflow.ts` — validates `can_approve`, inserts approve/revoke event (LATEST_EVENT_WINS — no transition guards)
  - `record-pool-component.workflow.ts` — validates `can_close_epoch`, verifies open epoch, inserts pool component
  - `close-epoch.workflow.ts` — validates `can_close_epoch`, checks EPOCH_CLOSE_IDEMPOTENT, verifies POOL_REQUIRES_BASE, reads pool components + approved receipts, computes payouts via `computePayouts()`, inserts statement atomically
- Deterministic workflow IDs per spec:
  - `ledger-open-epoch-{policyCommitSha}`
  - `ledger-receipt-{idempotencyKey}`
  - `ledger-event-{receiptId}-{eventType}` (idempotent per receipt + event type)
  - `ledger-pool-{epochId}-{componentId}`
  - `ledger-close-{epochId}`
- Activity functions in `services/scheduler-worker/src/activities/ledger.ts` following `createActivities(deps)` pattern
- Activities import pure domain logic from `@cogni/ledger-core` (never from `src/`) and DB operations from `@cogni/db-client` (`DrizzleLedgerWorkerAdapter`)
- Signature verification via `viem.verifyMessage()` in the issue-receipt activity
- Register workflows + activities in the scheduler-worker's Temporal worker

## Allowed Changes

- `services/scheduler-worker/src/workflows/` (5 new workflow files)
- `services/scheduler-worker/src/activities/ledger.ts` (new)
- `services/scheduler-worker/src/activities/index.ts` (add ledger activities)
- `services/scheduler-worker/src/worker.ts` (register workflows)
- `services/scheduler-worker/package.json` (add `viem` dep if not present)

## Plan

- [ ] Create activity functions in `services/scheduler-worker/src/activities/ledger.ts` with DI injection
- [ ] Implement `OpenEpochWorkflow` — short activity for validation + insert
- [ ] Implement `IssueReceiptWorkflow` — verify signature + idempotent insert
- [ ] Implement `ReceiptEventWorkflow` — validate actor + insert event
- [ ] Implement `RecordPoolComponentWorkflow` — validate + insert component
- [ ] Implement `CloseEpochWorkflow` — read components, compute payouts, atomic close
- [ ] Register all workflows in worker startup
- [ ] Add ledger activities to the `createActivities` barrel

## Validation

**Command:**

```bash
pnpm check
pnpm --filter scheduler-worker build
```

**Expected:** Types pass, worker builds successfully. Full pipeline tested in task.0096 stack tests.

## Review Checklist

- [ ] **Work Item:** `task.0095` linked in PR body
- [ ] **Spec:** WRITES_VIA_TEMPORAL (all writes are workflows), EPOCH_CLOSE_IDEMPOTENT, POOL_PRE_RECORDED (close reads, never creates), PAYOUT_DETERMINISTIC, RECEIPTS_WALLET_SIGNED
- [ ] **Tests:** workflow logic validated via stack tests in task.0096
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
