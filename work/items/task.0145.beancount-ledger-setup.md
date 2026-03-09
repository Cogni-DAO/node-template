---
id: task.0145
type: task
title: "Beancount Financial Ledger Setup + Journal Generation from Existing Sources"
status: needs_design
priority: 1
rank: 1
estimate: 3
summary: "Stand up Beancount as the canonical double-entry ledger. Live-journal model: journals live in a file store the app controls (not gated by git PRs), bean-check validates on every write, git gets periodic checkpoint commits. Generate journal entries from our 3 existing financial sources: OpenRouter AI spend (charge_receipts), attribution distributions (finalized epoch statements), and Cherry Servers hosting (API polling)."
outcome: "A running Beancount ledger with the accounts hierarchy from the financial-ledger spec, automated journal generation from all 3 sources, bean-check validation on every write, and a checkpoint mechanism that commits journal state to git on a schedule."
spec_refs: financial-ledger-spec, billing-evolution-spec, tokenomics-spec
assignees: derekg1729
credit:
project: proj.financial-ledger
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-09
updated: 2026-03-09
labels: [treasury, accounting, governance]
external_refs:
---

# Beancount Financial Ledger Setup + Journal Generation from Existing Sources

## Context

The financial-ledger spec declares BEANCOUNT_CANONICAL — Beancount journal files are the source-of-truth financial ledger. Today, zero Beancount code exists. We have 3 financial data sources already producing data:

1. **OpenRouter AI spend** — `charge_receipts` table with `response_cost_usd`, flowing in real-time via LiteLLM
2. **Attribution distributions** — finalized epoch `StatementLineItem` entries with `amountCredits` per contributor
3. **Cherry Servers hosting** — hourly VPS billing at EUR 0.02-0.03/hr, queryable via REST API

### Live-Journal Model (NOT git-gated)

The Beancount journal must be a **live artifact the system writes to** — an AI-run company can't wait for PRs to update its books.

- **Write path**: Temporal workflows / cron jobs generate journal entries, `bean-check` validates, persisted to file store
- **Read path**: Any service queries the current journal (balances, P&L, burn rate)
- **Checkpoint path**: Periodic cron commits journal snapshot to git (audit trail, diffable, but not the write bottleneck)

## Requirements

- **R1**: Beancount accounts hierarchy from financial-ledger spec exists as a base `.beancount` file (all accounts opened with correct commodity declarations for COGNI, USDC, EUR)
- **R2**: Journal entries generated from `charge_receipts` — each receipt maps to `Expense:AI:OpenRouter` / `Assets:Treasury:USDC` with `response_cost_usd` as the amount
- **R3**: Journal entries generated from finalized attribution epoch statements — accrual entries per spec: `Dr Expense:ContributorRewards:Equity / Cr Liability:UnclaimedEquity`
- **R4**: Journal entries generated from Cherry Servers billing — periodic expense entries via API polling: `Expense:Infrastructure:Hosting` / `Assets:Treasury:EUR`
- **R5**: `bean-check` validates the full journal on every write — invalid entries are rejected, not persisted
- **R6**: Journal files stored in a location the app controls (e.g., `data/ledger/`) — NOT requiring git commits to update
- **R7**: Checkpoint mechanism: cron or epoch-boundary hook commits current journal state to git as a snapshot
- **R8**: Idempotent journal generation — re-running for an already-processed receipt/epoch/period produces no duplicates (use `charge_receipts.source_reference` or epoch ID as transaction metadata for dedup)
- **R9**: All monetary math uses fixed-point / decimal — no floating point in journal amounts (inherits ALL_MATH_BIGINT)

## Allowed Changes

- `packages/beancount/` — new package for Beancount integration (journal generation, validation, file management)
- `services/scheduler-worker/` — new Temporal workflows/activities for journal generation and checkpointing
- `packages/db-schema/src/` — if a `journal_sync_cursors` or equivalent tracking table is needed
- `packages/db-client/src/` — adapter for reading charge_receipts and attribution statements for journal generation
- `data/ledger/` — journal file storage location (gitignored except for checkpoint commits)
- `.cogni/repo-spec.yaml` — if ledger configuration needs to live here
- `platform/infra/providers/cherry/` — Cherry Servers API client for billing data
- DB migrations for any new tracking tables

## Plan

### Phase 1: Beancount Infrastructure

- [ ] Create `packages/beancount/` package with tsup build config
- [ ] Implement accounts hierarchy as a base `.beancount` file generator (from financial-ledger spec accounts)
- [ ] Implement `JournalWriter` — append entries to journal file, validate with `bean-check` before persisting
- [ ] Implement `bean-check` wrapper — shell out to `bean-check`, parse exit code + stderr for validation errors
- [ ] Add Beancount as a system dependency (Python `beancount` package — document in dev setup)
- [ ] Unit tests: accounts generation, journal entry formatting, bean-check validation (valid + invalid entries)

### Phase 2: OpenRouter Journal Generation (charge_receipts -> journal)

- [ ] Implement `ChargeReceiptJournalAdapter` — reads charge_receipts from DB, generates Beancount transactions
- [ ] Map fields: `response_cost_usd` -> amount, `created_at` -> date, `source_reference` -> metadata (dedup key)
- [ ] Dedup: track last-processed cursor (timestamp or ID) in `journal_sync_cursors` table
- [ ] Temporal activity: `generateOpenRouterJournalEntries` — batch process new receipts since last cursor
- [ ] Integration test: insert charge_receipts -> run generation -> verify journal entries + bean-check passes

### Phase 3: Attribution Journal Generation (finalized statements -> journal)

- [ ] Implement `AttributionJournalAdapter` — reads finalized epoch statements, generates accrual entries
- [ ] One journal transaction per finalized epoch: aggregate `poolTotalCredits` as the accrual amount
- [ ] Dedup: epoch ID as transaction metadata — skip already-journaled epochs
- [ ] Temporal activity: `generateAttributionJournalEntries` — process newly finalized epochs
- [ ] Integration test: finalize epoch -> run generation -> verify accrual entries

### Phase 4: Cherry Servers Journal Generation (API -> journal)

- [ ] Implement Cherry Servers billing API client — `GET /v1/projects/{id}/billing` (or equivalent endpoint)
- [ ] Implement `CherryServersJournalAdapter` — periodic expense entries from billing data
- [ ] Dedup: billing period as transaction metadata — skip already-journaled periods
- [ ] Temporal activity: `generateHostingJournalEntries` — poll Cherry API, generate entries
- [ ] Integration test: mock Cherry API response -> verify journal entries

### Phase 5: Orchestration + Checkpointing

- [ ] Temporal workflow: `UpdateLedgerWorkflow` — runs all 3 adapters, validates full journal, reports errors
- [ ] Schedule: run on epoch boundary (existing scheduler-worker cron) + configurable interval for OpenRouter/Cherry
- [ ] Git checkpoint: activity that commits journal files to a designated branch (e.g., `ledger/checkpoints`)
- [ ] Alerting hook: emit structured log on journal validation failure (Pino -> Loki, existing observability)

## Design Decisions to Resolve

- **Beancount runtime dependency**: How is `bean-check` available? Options: (a) Python subprocess (simplest), (b) WASM port if exists, (c) Docker sidecar. Recommend (a) for Crawl.
- **Journal storage format**: Single file vs. per-source includes (`main.beancount` with `include` directives). Per-source includes recommended for parallel writes and clearer diffs.
- **Credit-to-USD mapping for attribution**: Attribution entries are in credits, not USD. Options: (a) custom `CREDIT` commodity in Beancount until Walk phase maps to tokens, (b) policy-defined credit:USD ratio now. Recommend (a) — credits are governance commitments, not cash.
- **Cherry Servers API scope**: CHERRY_REFERENCE.md shows server/plan queries but not billing/invoice endpoints specifically — verify exact endpoint and auth during implementation.
- **PR sizing**: This task has 5 phases. If implementation reveals any phase exceeds ~400 LOC of change, split into subtasks. Phase 1 (infrastructure) is the natural first PR; phases 2-4 (adapters) could be one or three PRs depending on complexity.

## Validation

**Unit tests:**

```bash
pnpm --filter @cogni/beancount test
```

**Expected:** Journal generation, formatting, and bean-check validation tests pass.

**Integration tests:**

```bash
pnpm dotenv -e .env.test -- vitest run --config vitest.stack.config.mts packages/beancount/
```

**Expected:** DB records -> journal entries -> bean-check validates -> cursor advances.

**Lint/type:**

```bash
pnpm check
```

**Expected:** Clean.

**Manual verification:**

```bash
bean-check data/ledger/main.beancount
```

**Expected:** Exit code 0 — the books balance.

## Review Checklist

- [ ] **Work Item:** `task.0145` linked in PR body
- [ ] **Spec:** BEANCOUNT_CANONICAL, ATTRIBUTION_NOT_FINANCIAL, IDEMPOTENT_CHARGE_RECEIPTS invariants upheld
- [ ] **Tests:** unit + integration tests for each journal adapter + bean-check validation
- [ ] **Reviewer:** assigned and approved
- [ ] **bean-check:** runs clean on generated journal

## PR / Links

-

## Attribution

-
