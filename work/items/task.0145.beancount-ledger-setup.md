---
id: task.0145
type: task
title: "TigerBeetle Financial Ledger + LedgerPort Integration"
status: needs_implement
priority: 1
rank: 1
estimate: 3
summary: "Stand up TigerBeetle as the double-entry transaction engine. Create LedgerPort interface and TigerBeetleAdapter. Wire into the 3 existing money-movement paths: AI spend (charge_receipts), credit deposits (USDC payments), and hosting expenses (Cherry Servers). Postgres keeps metadata; TigerBeetle enforces balanced transfers."
outcome: "TigerBeetle running as a container in dev stack. LedgerPort wired into recordChargeReceipt and creditAccount. Every AI spend and credit deposit has a corresponding double-entry transfer. Account balances queryable from TigerBeetle."
spec_refs: financial-ledger-spec, billing-evolution-spec
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

# TigerBeetle Financial Ledger + LedgerPort Integration

## Design

### Outcome

Every money-movement operation in the system has a corresponding double-entry transfer in TigerBeetle, enforced at the database level. The system can answer "what's our burn rate?" and "what are our balances?" from a single authoritative source.

### Approach

**Solution**: TigerBeetle as the transaction engine (Apache 2.0, 14k stars, Jepsen-verified, native TypeScript client via N-API). `LedgerPort` interface in hex architecture. Co-write pattern: existing Postgres operations continue unchanged, TigerBeetle transfer recorded alongside.

**Reuses**: Existing hex port/adapter pattern (`AccountService`, `DrizzleAccountService`). Existing Docker Compose dev stack. Existing `charge_receipts` and `credit_ledger` as Postgres metadata. `tigerbeetle-node` npm package for TypeScript client.

**Rejected alternatives**:

- **Beancount**: Python dependency, file-based, can't participate in Postgres transactions, requires subprocess for validation. Wrong runtime model for a TypeScript app.
- **Postgres-only double-entry**: Would work but reinvents what TigerBeetle does structurally — balanced transfers, overdraft protection, two-phase commits. Why build when battle-tested OSS exists?
- **Formance Ledger**: Good but adds a Go microservice + REST overhead. TigerBeetle's N-API client is zero-serialization.
- **Medici**: Requires MongoDB. We're Postgres.

### Invariants

- [ ] DOUBLE_ENTRY_CANONICAL: Every transfer in TigerBeetle is balanced (enforced by engine)
- [ ] LEDGER_PORT_IS_WRITE_PATH: All money-movement goes through LedgerPort (spec: financial-ledger-spec)
- [ ] POSTGRES_IS_METADATA: TigerBeetle for balances/transfers, Postgres for explanations/refs (spec: financial-ledger-spec)
- [ ] ALL_MATH_BIGINT: TigerBeetle uses u128 natively (spec: financial-ledger-spec)
- [ ] IDEMPOTENT_CHARGE_RECEIPTS: Existing idempotency via source_system/source_reference unchanged (spec: billing-evolution-spec)
- [ ] POST_CALL_NEVER_BLOCKS: LedgerPort write failure logged but does not block user response (spec: billing-evolution-spec)
- [ ] SIMPLE_SOLUTION: Leverages TigerBeetle OSS over bespoke accounting code
- [ ] ARCHITECTURE_ALIGNMENT: Follows hex port/adapter pattern (spec: architecture)

### Files

- Create: `src/ports/ledger.port.ts` — LedgerPort interface
- Create: `src/adapters/server/ledger/tigerbeetle.adapter.ts` — TigerBeetle implementation
- Create: `src/adapters/test/ledger/fake-ledger.adapter.ts` — In-memory fake for tests
- Create: `src/core/ledger/accounts.ts` — Account ID constants and ledger ID mappings
- Modify: `src/bootstrap/container.ts` — Wire TigerBeetleAdapter
- Modify: `src/adapters/server/accounts/drizzle.adapter.ts` — Co-write to LedgerPort in recordChargeReceipt/creditAccount
- Modify: `infra/services/runtime/docker-compose.yml` — Add TigerBeetle container
- Create: `tests/contract/ledger.contract.ts` — Port contract tests
- Create: `tests/unit/core/ledger/accounts.test.ts` — Account mapping tests

## Requirements

- **R1**: TigerBeetle running as a container in `docker-compose.yml` (dev + test stacks)
- **R2**: `LedgerPort` interface with `transfer`, `pendingTransfer`, `postTransfer`, `voidTransfer`, `lookupAccounts`, `getAccountBalance`
- **R3**: `TigerBeetleAdapter` implementing LedgerPort via `tigerbeetle-node`
- **R4**: Accounts hierarchy created on startup: one TigerBeetle account per logical account (UserCredits, Revenue:AIUsage, Assets:Treasury, etc.) with correct ledger IDs per asset type
- **R5**: `recordChargeReceipt()` co-writes a TigerBeetle transfer (Liability:UserCredits → Revenue:AIUsage) alongside existing Postgres writes
- **R6**: `creditAccount()` for deposits co-writes a TigerBeetle transfer (Assets:OnChain:USDC → Liability:UserCredits)
- **R7**: `user_data_128` on TigerBeetle transfers links back to Postgres `charge_receipts.id` or `credit_ledger.id` for metadata joins
- **R8**: Fake adapter for unit/contract tests (in-memory, no TigerBeetle dependency)
- **R9**: Port contract tests verifying double-entry invariants pass for both real and fake adapters
- **R10**: LedgerPort failure is non-blocking for AI responses (log critical, don't throw to user) — matches POST_CALL_NEVER_BLOCKS

## Allowed Changes

- `src/ports/` — new `ledger.port.ts`
- `src/adapters/server/ledger/` — new TigerBeetle adapter
- `src/adapters/test/ledger/` — new fake adapter
- `src/core/ledger/` — account constants, ledger ID mappings
- `src/bootstrap/container.ts` — wire LedgerPort
- `src/adapters/server/accounts/drizzle.adapter.ts` — co-write integration
- `infra/services/runtime/` — docker-compose TigerBeetle service
- `tests/contract/` — port contract tests
- `tests/unit/core/ledger/` — unit tests
- `package.json` — add `tigerbeetle-node` dependency

## Plan

### Phase 1: TigerBeetle Infrastructure

- [ ] Add TigerBeetle to `docker-compose.yml` (dev + test) — `ghcr.io/tigerbeetle/tigerbeetle`, needs `IPC_LOCK` capability, data volume
- [ ] Add `tigerbeetle-node` to package.json dependencies
- [ ] Create `src/core/ledger/accounts.ts` — ledger ID constants (USDC=2, CREDIT=200, COGNI=100, EUR=3), well-known account ID mappings
- [ ] Create `src/ports/ledger.port.ts` — LedgerPort interface
- [ ] Create `src/adapters/server/ledger/tigerbeetle.adapter.ts` — implements LedgerPort, creates accounts on init
- [ ] Create `src/adapters/test/ledger/fake-ledger.adapter.ts` — in-memory Map-based fake
- [ ] Wire in `src/bootstrap/container.ts`
- [ ] Create `tests/contract/ledger.contract.ts` — port contract tests (both adapters must pass)

### Phase 2: AI Spend Integration (charge_receipts co-write)

- [ ] Modify `DrizzleAccountService.recordChargeReceipt()` to call `ledgerPort.transfer()` after Postgres write
- [ ] Transfer: debit Liability:UserCredits:CREDIT, credit Revenue:AIUsage:CREDIT, amount = chargedCredits
- [ ] Set `user_data_128` = charge_receipt UUID for metadata linkage
- [ ] Non-blocking: wrap in try/catch, log critical on failure, never throw to caller
- [ ] Integration test: recordChargeReceipt → verify TigerBeetle transfer exists + balances correct

### Phase 3: Credit Deposit Integration (USDC payments co-write)

- [ ] Modify `DrizzleAccountService.creditAccount()` to call `ledgerPort.transfer()` for deposit reason
- [ ] Transfer: debit Assets:OnChain:USDC (ledger 2), credit Liability:UserCredits:CREDIT (ledger 200) — cross-ledger via linked transfers
- [ ] Set `user_data_128` = credit_ledger entry UUID
- [ ] Integration test: creditAccount → verify TigerBeetle transfer + balances

### Phase 4: Cherry Servers Expense (new cron adapter)

- [ ] Create Cherry Servers billing API client (verify endpoint from CHERRY_REFERENCE.md)
- [ ] Temporal activity: poll Cherry API, call `ledgerPort.transfer()` for hosting expense
- [ ] Transfer: debit Expense:Infrastructure:Hosting:EUR, credit Assets:Treasury:EUR
- [ ] Dedup: billing period as idempotency key in `user_data_64`
- [ ] Integration test with mock API

## Validation

**Port contract tests:**

```bash
pnpm test tests/contract/ledger.contract.ts
```

**Expected:** Both TigerBeetleAdapter and FakeLedgerAdapter pass identical contract tests.

**Unit tests:**

```bash
pnpm test tests/unit/core/ledger/
```

**Expected:** Account mapping, ledger ID constants verified.

**Integration tests (requires dev stack):**

```bash
pnpm dotenv -e .env.test -- vitest run --config vitest.stack.config.mts tests/stack/ledger/
```

**Expected:** charge_receipts → TigerBeetle transfer, credit deposit → TigerBeetle transfer, balances match.

**Lint/type:**

```bash
pnpm check
```

**Expected:** Clean.

## Review Checklist

- [ ] **Work Item:** `task.0145` linked in PR body
- [ ] **Spec:** DOUBLE_ENTRY_CANONICAL, LEDGER_PORT_IS_WRITE_PATH, POSTGRES_IS_METADATA, POST_CALL_NEVER_BLOCKS invariants upheld
- [ ] **Tests:** port contract tests + integration tests for each co-write path
- [ ] **Reviewer:** assigned and approved
- [ ] **TigerBeetle balances**: match expected state after test scenarios

## PR / Links

-

## Attribution

-
