---
id: refactor.attribution-ledger-rename.handoff
type: handoff
work_item_id: refactor.ledger-renaming
status: active
created: 2026-02-28
updated: 2026-02-28
branch: refactor/attribution-ledger
last_commit: 79028f0d
---

# Handoff: Rename Epoch Ledger → Attribution Ledger

## Context

- The "Epoch Ledger" system is being renamed to "Attribution Ledger" to separate work attribution from a future Financial Ledger
- The pipeline stage rename (activity→ingestion, curation→selection, artifact→evaluation, payout→statement) was completed in `4c11e429` on a prior branch
- This branch (`refactor/attribution-ledger`) renames the system concept itself: package, types, files, routes, contracts, DB column, and API surface
- Design constraints: no migration wipe, ingestion types stay domain-neutral, route paths change to `/api/v1/attribution/`
- Original plan: `~/.claude/plans/sunny-singing-balloon.md` (7 phases)

## Current State

**Phases 1–6 are committed** across 3 clean commits. `pnpm check` passes. `pnpm check:docs` passes.

| Commit     | Phase | Scope                                                                                                          |
| ---------- | ----- | -------------------------------------------------------------------------------------------------------------- |
| `56f468e7` | 1-3   | Spec update, package rename (`@cogni/ledger-core` → `@cogni/attribution-ledger`), all type renames (100 files) |
| `ada73e4b` | 4-5   | File/dir renames (`git mv`), route dirs, test file renames, all import paths (53 files)                        |
| `79028f0d` | 6     | Additive migration 0018: `ALTER TABLE epoch_statements RENAME COLUMN payouts_json TO statement_items_json`     |

**Phase 7 is NOT done** — AGENTS.md updates and JSDoc `Module:`/`Links:` header cleanup in ~60 source files.

### Phase 7 remaining work

1. **AGENTS.md files** (~9 files) — stale type names and file references:
   - `packages/attribution-ledger/AGENTS.md` — heavily stale, still says "ledger-core" with old type names throughout
   - `packages/db-client/AGENTS.md` — references `ActivityLedgerStore` (→ `AttributionStore`)
   - `services/scheduler-worker/AGENTS.md` — references `createLedgerActivities()` (→ `createAttributionActivities()`)
   - `src/app/api/v1/attribution/AGENTS.md`, `src/app/api/v1/public/attribution/AGENTS.md`, `src/core/AGENTS.md`, `src/features/governance/AGENTS.md`, `packages/ingestion-core/AGENTS.md`, `packages/db-schema/AGENTS.md`

2. **JSDoc doc headers** (~50 source files) — `Module:` and `Links:` lines reference old paths:
   - `packages/ledger-core/` → `packages/attribution-ledger/`
   - `docs/spec/epoch-ledger.md` → `docs/spec/attribution-ledger.md`
   - `drizzle-ledger.adapter` → `drizzle-attribution.adapter`
   - `@app/api/v1/ledger/` → `@app/api/v1/attribution/`
   - `contracts/ledger.` → `contracts/attribution.`

## Decisions Made

- **`IngestionReceipt`/`IngestionCursor`** — domain-neutral, shared spine for future Treasury
- **`statementItems`** (not `payouts`/`distributions`) — JSON blob is statement line items, not payments
- **DB column** `payouts_json` → `statement_items_json` via additive migration (no wipe)
- **API wire field** `payouts` → `items` in `StatementSchema` (Zod contract)
- **Routes** `/api/v1/ledger/` → `/api/v1/attribution/` — no users yet
- **Temporal workflow IDs** (`ledger-collect-*`) and config key (`ledger.approvers`) intentionally NOT renamed — runtime identifiers

## Next Actions

- [ ] Update ~9 AGENTS.md files with current type/function names
- [ ] Update ~50 JSDoc `Module:` and `Links:` headers in source files (sed replacements)
- [ ] Run `pnpm check` and `pnpm check:docs` — must both pass
- [ ] Create PR to `staging`

## Risks / Gotchas

- `packages/attribution-ledger/AGENTS.md` needs a near-complete rewrite — it still describes the pre-rename public surface
- Archive handoffs and work items in `work/` contain historical `ledger-core` references — leave them as-is
- The `~/.claude/plans/sunny-singing-balloon.md` plan file has the full type rename map if you need reference
- Migration 0017 already contained the 4 DB triggers from the plan's Phase 6 — only the column rename was new in 0018

## Pointers

| File / Resource                                                        | Why it matters                                              |
| ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| `packages/attribution-ledger/src/store.ts`                             | Source of truth for all Attribution\* type definitions      |
| `packages/attribution-ledger/src/index.ts`                             | Barrel exports — canonical public surface                   |
| `packages/db-schema/src/attribution.ts`                                | DB schema with `statementItemsJson` column                  |
| `packages/db-client/src/adapters/drizzle-attribution.adapter.ts`       | `DrizzleAttributionAdapter` — implements `AttributionStore` |
| `src/contracts/attribution.epoch-statement.v1.contract.ts`             | Wire format with `items` field                              |
| `src/adapters/server/db/migrations/0018_attribution_column_rename.sql` | Column rename migration                                     |
| `docs/spec/attribution-ledger.md`                                      | Spec (content already updated)                              |
| `~/.claude/plans/sunny-singing-balloon.md`                             | Full 7-phase plan with all rename maps                      |
