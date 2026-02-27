---
id: refactor.ledger-renaming.handoff
type: handoff
work_item_id: refactor.ledger-renaming
status: active
created: 2026-02-27
updated: 2026-02-27
branch: refactor/ledger-renaming
last_commit: 103b2b18
---

# Handoff: Ledger Pipeline Rename (Phases 6–8 + Statement Fix)

## Context

- The epoch ledger pipeline had inconsistent naming — "activity events," "curation," "artifacts," "payout statements" didn't map to clear pipeline stages.
- The rename aligns the codebase to: **Ingestion → Selection → Evaluation → Allocation → Statement → (future: Settlement/Payout)**.
- `RECEIPT_SCOPE_AGNOSTIC`: `ingestion_receipts` has no `scope_id` — scope assigned at selection via epoch membership.
- "Statement" (not "payout") is the correct term for the finalization entity — it's an entitlement plan, not an executed payment. "Payout" is reserved for a future settlement layer.

## Current State

- **Phases 1–5 committed** on `refactor/ledger-renaming` (6 commits through `103b2b18`): Schema, domain types, adapter, app layer, scheduler-worker all renamed.
- **payout→statement rename IN PROGRESS (uncommitted)**: 18 files changed across all layers — `epochPayouts` → `epochStatements`, `epochPayoutSignatures` → `epochStatementSignatures`, `LedgerEpochPayout` → `LedgerEpochStatement`, `payoutId` → `statementId`, `supersedesPayoutId` → `supersedesStatementId`. NOT renamed: `payoutsJson` (line items content), `computePayouts`, `PayoutLineItem`, `payoutCount`.
- **`pnpm check` status**: typecheck/lint/format/build/arch all pass. Failures are `test:contract` (1 test — statement contract fixture needs `supersedesStatementId`) and `test:packages:local` (Phase 6 scope — test files still use old field names).
- **Phases 6–8 NOT started**.

## Decisions Made

- **Statement, not payout**: The finalization entity is a deterministic distribution plan. "Payout" reserved for future settlement layer with tx hashes, fees, status.
- **`payoutsJson` stays**: The JSON blob contains payout line items — "payouts" as a noun for the math output is fine.
- Pipeline stages: receipt (fact) → selection (curation) → evaluation (enricher output) → allocation (units) → statement (plan) → settlement/payment (future).

## Next Actions

- [ ] **Commit the uncommitted payout→statement rename** — `git diff` shows 18 files, all mechanical renames
- [ ] **Phase 6**: Fix tests + fixtures (~5 files):
  - `packages/ledger-core/tests/artifact-envelope.test.ts` — `events` → `receipts`, `eventId` → `receiptId`, `eventPayloadHash` → `receiptPayloadHash`
  - `packages/ledger-core/tests/hashing.test.ts` — `artifactRef` → `evaluationRef`
  - `tests/_fixtures/ledger/seed-ledger.ts` — type/field renames
  - `tests/contract/app/ledger.epochs.[id].statement.test.ts` — `supersedesPayoutId` → `supersedesStatementId`
  - `services/scheduler-worker/tests/ledger-activities.test.ts` — `ActivityLedgerStore` → `EpochLedgerStore`, method name renames
  - `services/scheduler-worker/tests/enrichment-activities.test.ts` — same
- [ ] **Phase 7**: Delete 17 migrations in `src/adapters/server/db/migrations/` + `meta/`, run `pnpm db:generate`, add 4 triggers:
  1. `ingestion_receipts_immutable` (append-only)
  2. `epoch_pool_components_immutable` (append-only)
  3. `selection_freeze_on_finalize`
  4. `epoch_evaluations_locked_immutable` (NEW)
- [ ] **Phase 8**: Update `docs/spec/epoch-ledger.md` — rename all tables/columns/invariants, fix scope docs, add `RECEIPT_SCOPE_AGNOSTIC` + `EVALUATION_LOCKED_IMMUTABLE`
- [ ] Run `pnpm check` — must be fully clean

## Risks / Gotchas

- **Uncommitted changes are safe but must be committed first** — typecheck passes, only test fixtures need updating.
- **`payoutsJson` must NOT be renamed** — it's the line-item content, not the statement entity.
- **Locked evaluation trigger**: Must allow INSERT during atomic `closeIngestionWithEvaluations` but block UPDATE/DELETE on locked rows.
- **Hash shape changed**: `receiptId`/`receiptPayloadHash` in enricher inputs changes hash outputs. Safe (no production data).

## Pointers

| File / Resource                                             | Why it matters                                |
| ----------------------------------------------------------- | --------------------------------------------- |
| `.claude/plans/golden-shimmying-spindle.md`                 | Complete rename maps for all layers           |
| `packages/ledger-core/src/store.ts`                         | Source of truth for all method/type names     |
| `packages/db-schema/src/ledger.ts`                          | Source of truth for table/column names        |
| `packages/db-client/src/adapters/drizzle-ledger.adapter.ts` | Reference for correct JOIN patterns           |
| `docs/spec/epoch-ledger.md`                                 | 750-line spec needing full terminology update |
| `src/adapters/server/db/migrations/`                        | 17 migrations to delete + regenerate          |
