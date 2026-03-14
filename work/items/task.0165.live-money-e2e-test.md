---
id: task.0165
type: task
title: Live money e2e test — full OpenRouter top-up chain on Base mainnet
status: needs_implement
priority: 1
rank: 25
estimate: 2
summary: Build a stack-money test suite that sends real USDC to the Split contract on Base, triggers the full confirmCreditsPurchase chain (distribute → credits → TB co-writes → OpenRouter charge → operator wallet funding), and asserts correctness in TigerBeetle, Postgres, and OpenRouter credits balance.
outcome: A single test validates the entire payment-to-provider pipeline with real money on Base mainnet. TigerBeetle balances, Postgres funding rows, and OpenRouter credit balance all asserted. Test is explicitly gated behind ENABLE_MONEY_TESTS and never runs in CI.
spec_refs: web3-openrouter-payments, financial-ledger-spec, operator-wallet
assignees: derekg1729
credit:
project: proj.ai-operator-wallet
branch: feat/operator-wallet-e2e
pr:
reviewer:
revision: 0
blocked_by: task.0086
deploy_verified: false
created: 2026-03-14
updated: 2026-03-14
labels: [testing, wallet, web3, billing]
external_refs:
---

# Live money e2e test — full OpenRouter top-up chain on Base mainnet

## Requirements

- New vitest config `apps/web/vitest.stack-money.config.mts` — extends stack test pattern (full Docker Compose infra: TigerBeetle + Postgres + app) with additional env gates for live chain credentials
- New pnpm script `test:stack:money` — runs the money test suite; never part of CI or `check:full`
- Env gate: test config must require `ENABLE_MONEY_TESTS=true` and refuse to run without it, with a clear error message explaining this test spends real USDC
- Env requirements: `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_SIGNING_KEY`, `OPENROUTER_API_KEY`, `EVM_RPC_URL` (Base mainnet), `DATABASE_URL`, `DATABASE_SERVICE_URL`, `TEST_BASE_URL` — all must be set
- Test file `tests/stack/money/openrouter-topup-e2e.stack.money.test.ts` validates the full chain:
  1. **Send USDC to Split** — real on-chain USDC transfer from operator wallet to the Split contract address (`payments_in.credits_topup.receiving_address`)
  2. **Trigger distribute** — call `distributeSplit()` via the real `PrivyOperatorWalletAdapter`, verify tx hash returned
  3. **Confirm credit purchase** — call `confirmCreditsPurchase()` with real container deps (real `ProviderFundingPort`, real `FinancialLedgerPort`, real `TreasurySettlementPort`)
  4. **Assert Postgres** — `provider_funding_attempts` row exists with `status = 'funded'` and a valid `funding_tx_hash`
  5. **Assert TigerBeetle** — query account balances via `FinancialLedgerPort`:
     - `ASSETS_TREASURY` (2001) debited by SPLIT_DISTRIBUTE transfer
     - `ASSETS_OPERATOR_FLOAT` (2002) credited by SPLIT_DISTRIBUTE, debited by PROVIDER_TOPUP
     - `ASSETS_PROVIDER_FLOAT` (2003) credited by PROVIDER_TOPUP
  6. **Assert OpenRouter** — GET `/api/v1/credits` with the API key, verify credit balance increased by the expected amount (within tolerance for fee rounding)
- Minimum test amount: use `amountUsdCents = 110` ($1.10 user payment) which produces ~$1.05 top-up via `calculateOpenRouterTopUp()` — the minimum OpenRouter charge ($1.00 + 5% fee)
- Test must be sequential (single fork, no concurrency) — on-chain txs are not parallelizable
- Test timeout: 60s (on-chain txs: 2-10s each, OpenRouter API: variable, distribute + approve + transfer = 3 txs minimum)
- Cleanup: delete test user + billing rows after test (FK cascade). TB transfers are append-only and idempotent (deterministic IDs), no cleanup needed.

## Spec Invariants Validated

| Invariant               | Spec                     | What the test proves                                                          |
| ----------------------- | ------------------------ | ----------------------------------------------------------------------------- |
| SETTLEMENT_NON_BLOCKING | financial-ledger-spec    | Steps 3-6 don't fail the credit response                                      |
| DETERMINISTIC_IDS       | web3-openrouter-payments | Retry with same paymentIntentId produces no duplicate TB transfers            |
| DURABLE_FUNDING_ROW     | web3-openrouter-payments | `provider_funding_attempts` row transitions pending → charge_created → funded |
| ASSET_SWAP_NOT_EXPENSE  | web3-openrouter-payments | OperatorFloat → ProviderFloat, not an expense account                         |
| MARGIN_PRESERVED        | web3-openrouter-payments | Top-up amount < user payment (positive margin)                                |
| PORT_BOUNDARY_CLEAN     | operator-wallet          | No raw signing — all txs via OperatorWalletPort                               |
| DOUBLE_ENTRY_CANONICAL  | financial-ledger-spec    | TB balances match expected debits/credits                                     |

## Allowed Changes

- `apps/web/vitest.stack-money.config.mts` (new)
- `apps/web/tests/stack/money/openrouter-topup-e2e.stack.money.test.ts` (new)
- `package.json` (add `test:stack:money` script)
- `apps/web/tests/_fixtures/` (add money test helpers if needed)

## Plan

- [ ] **Checkpoint 1: Vitest config + pnpm script**
  - [ ] Create `vitest.stack-money.config.mts` — same globalSetup as stack config, add `ENABLE_MONEY_TESTS` + credential env gates
  - [ ] Include pattern: `tests/stack/money/*.stack.money.test.ts`
  - [ ] Add `test:stack:money` script to root `package.json` (dotenv -e .env.test)
  - [ ] Verify config loads without errors when env vars present

- [ ] **Checkpoint 2: OpenRouter balance helper**
  - [ ] Create helper function `getOpenRouterCreditBalance(apiKey: string): Promise<number>` — GET `/api/v1/credits`
  - [ ] Verify it returns current credit balance (manual sanity check)

- [ ] **Checkpoint 3: Test implementation**
  - [ ] Seed test user + billing account in Postgres
  - [ ] Record OpenRouter credit balance BEFORE
  - [ ] Send minimum USDC ($1.10 cents worth) to Split address via operator wallet
  - [ ] Call `confirmCreditsPurchase()` with real deps from running container
  - [ ] Assert `provider_funding_attempts` row: status=funded, funding_tx_hash present
  - [ ] Assert TB balances: Treasury debited, OperatorFloat net zero, ProviderFloat credited
  - [ ] Record OpenRouter credit balance AFTER, assert increase matches expected top-up
  - [ ] Cleanup test data

- [ ] **Checkpoint 4: Idempotency assertion**
  - [ ] Call `confirmCreditsPurchase()` again with same `clientPaymentId`
  - [ ] Assert no duplicate TB transfers (deterministic IDs)
  - [ ] Assert `provider_funding_attempts` row unchanged (idempotent skip)
  - [ ] Assert OpenRouter balance did not increase again

- [ ] **Checkpoint 5: Validation**
  - [ ] `pnpm check` passes (new files lint-clean)
  - [ ] Run test manually with funded wallet, confirm all assertions pass

## Validation

**Prerequisite:** Full Docker Compose stack running (`pnpm docker:dev:stack` or `pnpm dev:stack`)

**Command:**

```bash
ENABLE_MONEY_TESTS=true pnpm dotenv -e .env.test -- vitest run --config apps/web/vitest.stack-money.config.mts
```

**Expected:** Single test passes. Console output shows:

- USDC transfer tx hash (to Split)
- Distribute tx hash
- OpenRouter charge ID
- Funding tx hash (to OpenRouter via Coinbase Commerce)
- TB balance assertions pass
- OpenRouter credit balance increased by ~$1.00 (after 5% fee on $1.05 gross)

**Cost per run:** ~$1.10 USDC + ~$0.001 gas (3 txs × ~80-170k gas on Base)

**Lint check:**

```bash
pnpm check
```

## Review Checklist

- [ ] **Work Item:** `task.0165` linked in PR body
- [ ] **Spec:** DETERMINISTIC_IDS, DURABLE_FUNDING_ROW, DOUBLE_ENTRY_CANONICAL, MARGIN_PRESERVED all asserted
- [ ] **Tests:** test passes with real money on Base mainnet
- [ ] **Safety:** ENABLE_MONEY_TESTS gate works (test refuses to run without it)
- [ ] **CI safety:** `test:stack:money` is NOT added to `check:full` or any CI workflow
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Depends on: task.0086 (OpenRouter top-up orchestration — must be merged first)
- Branch: `feat/operator-wallet-e2e`
- Spec: [web3-openrouter-payments](../../docs/spec/web3-openrouter-payments.md)
- Spec: [financial-ledger](../../docs/spec/financial-ledger.md)
- Spec: [operator-wallet](../../docs/spec/operator-wallet.md)

## Attribution

-
