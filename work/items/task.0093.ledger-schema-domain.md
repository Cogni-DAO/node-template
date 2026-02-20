---
id: task.0093
type: task
title: "Ledger DB schema (6 tables) + core domain (model, rules, signing, errors)"
status: needs_implement
priority: 1
rank: 1
estimate: 3
summary: "Define 6 Drizzle tables with append-only DB triggers, plus pure domain logic: payout math (BIGINT, largest-remainder), domain-bound receipt hashing, and error classes."
outcome: "Schema migrated, append-only triggers enforced, core rules unit-tested. No ports/adapters/routes yet — just the foundation."
spec_refs: epoch-ledger-spec
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch: feat/ledger-v0
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-02-20
updated: 2026-02-20
labels: [governance, ledger, schema]
external_refs:
---

# Ledger DB Schema + Core Domain

## Requirements

- 6 Drizzle tables in `packages/db-schema/src/ledger.ts`: `ledger_issuers`, `epochs`, `work_receipts`, `receipt_events`, `epoch_pool_components`, `payout_statements`
- All credit/unit columns use BIGINT (`mode: "bigint"`)
- No RLS in V0 — tables do NOT use `.enableRLS()`. Worker uses a service-role DB connection that would bypass RLS anyway; adding RLS without policies would brick queries.
- DB-level CHECK constraints on enum columns: `epochs.status` IN (`open`, `closed`), `work_receipts.role` IN (`author`, `reviewer`, `approver`), `receipt_events.event_type` IN (`proposed`, `approved`, `revoked`). Immutable tables cannot tolerate garbage values.
- Partial unique index on `epochs`: `UNIQUE (status) WHERE status = 'open'` (ONE_OPEN_EPOCH)
- Unique index on `work_receipts.idempotency_key` (IDEMPOTENT_RECEIPTS)
- Unique index on `payout_statements.epoch_id` (one statement per epoch)
- Index on `work_receipts(epoch_id)` for epoch receipt listing
- Index on `receipt_events(receipt_id, created_at DESC)` for latest-event-per-receipt queries
- `ledger_issuers` has boolean role columns: `can_issue`, `can_approve`, `can_close_epoch` (ISSUER_AUTHORIZED)
- Custom SQL migration with DB triggers rejecting UPDATE/DELETE on `work_receipts` (RECEIPTS_IMMUTABLE), `receipt_events` (EVENTS_APPEND_ONLY), and `epoch_pool_components` (POOL_IMMUTABLE)
- Core domain at `src/core/ledger/`:
  - `model.ts` — receipt, epoch, pool component, payout statement types; role/event enums
  - `rules.ts` — `computePayouts(receipts, poolTotal)` with BIGINT arithmetic + largest-remainder rounding (ALL_MATH_BIGINT)
  - `signing.ts` — `buildReceiptMessage(fields)` returns the canonical domain-bound string per SIGNATURE_DOMAIN_BOUND; `hashReceiptMessage(msg)` returns SHA-256; `computeReceiptSetHash(receipts)` for epoch close
  - `errors.ts` — domain error classes (EpochNotOpenError, ReceiptSignatureInvalidError, IssuerNotAuthorizedError, EpochAlreadyClosedError, PoolComponentMissingError)
  - `public.ts` — barrel export
- Unit tests for payout math: edge cases (1 recipient, many recipients, zero units, exact division, remainder distribution)
- Unit tests for signing: canonical message format, hash determinism

## Allowed Changes

- `packages/db-schema/src/ledger.ts` (new)
- `packages/db-schema/src/index.ts` (add barrel export)
- `packages/db-schema/drizzle/migrations/` (new migration)
- `src/core/ledger/` (new directory: model.ts, rules.ts, signing.ts, errors.ts, public.ts)
- `src/core/public.ts` (add ledger re-export)
- `tests/unit/core/ledger/` (new test files)

## Plan

- [ ] Define 6 tables in `packages/db-schema/src/ledger.ts` following `billing.ts` patterns (BIGINT, CHECK constraints, indexes, no RLS)
- [ ] Add `export * from "./ledger"` to `packages/db-schema/src/index.ts`
- [ ] Generate Drizzle migration: `pnpm --filter @cogni/db-schema drizzle-kit generate`
- [ ] Add custom SQL to migration for append-only triggers on `work_receipts`, `receipt_events`, and `epoch_pool_components`
- [ ] Create `src/core/ledger/model.ts` — types and enums
- [ ] Create `src/core/ledger/errors.ts` — domain errors with type guards
- [ ] Create `src/core/ledger/rules.ts` — `computePayouts()` with BIGINT largest-remainder
- [ ] Create `src/core/ledger/signing.ts` — canonical message builder + SHA-256 hashing
- [ ] Create `src/core/ledger/public.ts` barrel, update `src/core/public.ts`
- [ ] Write unit tests for payout math and signing in `tests/unit/core/ledger/`

## Validation

**Command:**

```bash
pnpm check
pnpm test tests/unit/core/ledger/
```

**Expected:** Types pass, lint clean, all unit tests green. Migration file exists.

## Review Checklist

- [ ] **Work Item:** `task.0093` linked in PR body
- [ ] **Spec:** RECEIPTS_IMMUTABLE, EVENTS_APPEND_ONLY, POOL_IMMUTABLE, ONE_OPEN_EPOCH, IDEMPOTENT_RECEIPTS, ALL_MATH_BIGINT, SIGNATURE_DOMAIN_BOUND, ISSUER_AUTHORIZED upheld
- [ ] **Tests:** payout math edge cases, signing determinism, largest-remainder correctness
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
