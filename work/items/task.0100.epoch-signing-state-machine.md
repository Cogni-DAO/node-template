---
id: task.0100
type: task
title: "Epoch state machine (open→frozen→finalized), scope-level approvers, EIP-191 signing"
status: needs_design
priority: 1
rank: 6
estimate: 3
summary: "Implement three-phase epoch lifecycle, per-scope approver config from repo-spec, EIP-191 statement signing, and freeze/sign/finalize API routes."
outcome: "Epochs transition open→frozen→finalized with DB trigger enforcement. Payout statements require 1-of-N EIP-191 signature from scope approvers before finalize. Approvers configured in repo-spec.yaml."
spec_refs: epoch-ledger-spec
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch:
pr:
reviewer:
revision: 0
blocked_by: task.0093
deploy_verified: false
created: 2026-02-22
updated: 2026-02-22
labels: [governance, ledger, signing, security]
external_refs:
---

# Epoch State Machine + Signing Workflow

## Requirements

### 1. Epoch Status Enum: `open → frozen → finalized`

- Update `EpochStatus` in `packages/ledger-core/src/model.ts`: `"open" | "frozen" | "finalized"`
- DB migration: alter CHECK constraint on `epochs.status` to `('open', 'frozen', 'finalized')`
- Update partial unique index: `UNIQUE(node_id, scope_id) WHERE status != 'finalized'` (ONE_ACTIVE_EPOCH)
- Update `activity_curation` DB trigger: reject writes when `epochs.status IN ('frozen', 'finalized')` (CURATION_FREEZE_ON_FREEZE)
- Add state transition validation in domain logic (no backward transitions)

### 2. Scope-Level Approvers in Repo-Spec

- Add `ledger.approvers` to `.cogni/repo-spec.yaml`:
  ```yaml
  ledger:
    approvers:
      - "0xWalletAddress"
  ```
- Extend `repoSpecSchema` in `src/shared/config/repoSpec.schema.ts`: validate `ledger.approvers` as array of EVM addresses
- Add `getLedgerConfig()` accessor in `repoSpec.server.ts` (cached, same pattern as `getNodeId()`)
- Export from `src/shared/config/index.ts`

### 3. EIP-191 Signing

- Canonical message format (SIGNATURE_SCOPE_BOUND):
  ```
  Cogni Payout Statement
  Node: {node_id}
  Scope: {scope_id}
  Epoch: {epoch_id}
  Allocation Hash: {allocation_set_hash}
  Pool Total: {pool_total_credits}
  ```
- `buildCanonicalMessage()` in `packages/ledger-core/` — pure function, shared between frontend and backend
- `verifyStatementSignature()` in `packages/ledger-core/` — ecrecover + check against approvers list
- Use viem's `verifyMessage` / `recoverMessageAddress` (already a dependency)

### 4. New API Routes

- `POST /api/v1/ledger/epochs/:id/freeze` — SIWE + approver check, transitions `open → frozen`
- `POST /api/v1/ledger/epochs/:id/sign` — SIWE + approver check, accepts `{ signature }`, verifies via ecrecover, stores in `statement_signatures`
- Update `POST /api/v1/ledger/epochs/:id/finalize` — verify epoch is `frozen`, verify signature exists from scope approver, then finalize

### 5. Store Port Extensions

- `ActivityLedgerStore.freezeEpoch(nodeId, epochId)` — transition open → frozen
- `ActivityLedgerStore.insertSignature(params)` — insert into statement_signatures
- `ActivityLedgerStore.getSignaturesForEpoch(nodeId, epochId)` — read signatures

## Allowed Changes

- `packages/ledger-core/src/model.ts` (update EpochStatus, add signing types)
- `packages/ledger-core/src/signing.ts` (new — canonical message + verification)
- `packages/db-schema/src/ledger.ts` (update status enum)
- `packages/db-client/src/adapters/drizzle-ledger.adapter.ts` (new store methods)
- `src/shared/config/repoSpec.schema.ts` (add ledger section)
- `src/shared/config/repoSpec.server.ts` (add getLedgerConfig)
- `src/shared/config/index.ts` (export getLedgerConfig)
- `.cogni/repo-spec.yaml` (add ledger.approvers)
- `src/app/api/v1/ledger/epochs/[id]/freeze/` (new route)
- `src/app/api/v1/ledger/epochs/[id]/sign/` (new route)
- DB migration (new file)
- Tests

## Plan

- [ ] DB migration: epoch status enum `open/frozen/finalized`, update constraints + triggers
- [ ] Update `packages/ledger-core/` model types + add signing module
- [ ] Add `ledger.approvers` to repo-spec schema + loader + accessor
- [ ] Implement store port methods (freeze, signatures)
- [ ] Implement freeze + sign API routes
- [ ] Update finalize workflow to require frozen status + valid signature
- [ ] Tests: state transitions, signing verification, scope-bound anti-replay

## Validation

**Command:**

```bash
pnpm check
pnpm dotenv -e .env.test -- vitest run --config vitest.stack.config.mts tests/stack/ledger/
```

**Expected:** Types pass, epoch lifecycle + signing stack tests green.

## Review Checklist

- [ ] **Work Item:** `task.0100` linked in PR body
- [ ] **Spec:** EPOCH_THREE_PHASE, APPROVERS_PER_SCOPE, SIGNATURE_SCOPE_BOUND, CURATION_FREEZE_ON_FREEZE invariants enforced
- [ ] **Tests:** state machine transitions (happy + reject backward), signing verification, anti-replay across scopes
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
