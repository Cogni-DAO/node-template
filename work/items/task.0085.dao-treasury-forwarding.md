---
id: task.0085
type: task
title: DAO treasury USDC forwarding from operator wallet
status: needs_implement
priority: 0
estimate: 2
summary: After credit settlement, forward DAO's share of each payment as USDC from operator wallet to treasury. Idempotent, durable state tracking.
outcome: Every settled payment triggers a USDC transfer of the DAO margin to the treasury address. outbound_transfers table tracks state. charge_receipt logged on success.
spec_refs: operator-wallet, web3-openrouter-payments
assignees: derekg1729
credit:
project: proj.ai-operator-wallet
branch:
pr:
reviewer:
created: 2026-02-17
updated: 2026-02-17
labels: [wallet, web3, billing]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# DAO treasury USDC forwarding from operator wallet

## Requirements

- `calculateDaoShare(paymentUsd, markupFactor, revenueShare, providerFee)` pure function added to `src/core/billing/pricing.ts`
- `WalletSignerPort.sendUsdcToTreasury(amountRaw, reference)` implemented in `KeystoreSignerAdapter`
- ERC20 `transfer()` call to `USDC_TOKEN_ADDRESS`, destination = `cogni_dao.dao_contract` from repo-spec
- `simulateContract()` before signing (SIMULATE_BEFORE_SIGN invariant)
- Treasury address hardcoded from repo-spec — caller cannot control destination (DESTINATION_ALLOWLIST)
- `outbound_transfers` DB table with state machine: `PENDING` → `TX_BROADCAST` → `CONFIRMED` (terminal: `FAILED`)
- Idempotent on `client_payment_id` — duplicate dispatch for same payment is a no-op
- `charge_receipt` logged with `charge_reason = 'dao_treasury_forward'` on CONFIRMED
- Dispatch triggered from `creditsConfirm.ts` after user + system tenant credits are committed
- `DAO_SHARE_FORWARDED` invariant: every settled payment has a corresponding outbound_transfers record

## Allowed Changes

- `src/core/billing/pricing.ts` (add calculateDaoShare)
- `src/adapters/server/wallet/keystore-signer.adapter.ts` (implement sendUsdcToTreasury)
- `src/features/payments/services/creditsConfirm.ts` (dispatch outbound transfer after credit settlement)
- `src/shared/db/schema.billing.ts` (add outbound_transfers table)
- `src/adapters/server/db/migrations/` (new migration for outbound_transfers)
- `src/shared/web3/` (ERC20 transfer encoding helpers if needed)
- `tests/` (unit tests for calculateDaoShare, integration tests for forwarding flow)

## Plan

- [ ] Add `calculateDaoShare()` to `src/core/billing/pricing.ts` — pure function, uses same constants as `calculateOpenRouterTopUp()`
- [ ] Write unit tests for `calculateDaoShare()` with default constants (expect $0.0789 per $1.00)
- [ ] Create DB migration for `outbound_transfers` table (schema from spec)
- [ ] Add drizzle schema for `outbound_transfers` in `schema.billing.ts`
- [ ] Implement `sendUsdcToTreasury()` in `KeystoreSignerAdapter` — encode ERC20 transfer, simulate, sign, broadcast
- [ ] Update `FakeWalletSignerAdapter` with test stub
- [ ] Add dispatch logic to `creditsConfirm.ts` — after credits committed, insert `outbound_transfers` row (PENDING), call `sendUsdcToTreasury()`
- [ ] Add charge_receipt logging on CONFIRMED state
- [ ] Write integration test for forwarding flow (with fake adapter)
- [ ] Run `pnpm check` to verify no violations

## Validation

**Commands:**

```bash
pnpm check
pnpm test tests/unit/core/billing/pricing.test.ts
pnpm test tests/unit/features/payments
```

**Expected:** All tests pass. `calculateDaoShare()` returns correct values for default and edge-case constants. Forwarding is idempotent.

## Review Checklist

- [ ] **Work Item:** `task.0085` linked in PR body
- [ ] **Spec:** SIMULATE_BEFORE_SIGN, DESTINATION_ALLOWLIST, DAO_SHARE_FORWARDED, TOPUP_AFTER_CREDIT invariants upheld
- [ ] **Tests:** calculateDaoShare unit test + forwarding integration test
- [ ] **Reviewer:** assigned and approved
- [ ] **Architecture:** Pure math in core, signing in adapter, orchestration in features — no layer violations

## PR / Links

-

## Attribution

-
