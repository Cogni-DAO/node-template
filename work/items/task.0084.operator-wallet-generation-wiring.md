---
id: task.0084
type: task
title: Operator wallet generation + wiring into existing payment flow
status: Todo
priority: 0
estimate: 2
summary: Generate encrypted keystore, create WalletSignerPort, wire operator wallet as receiving address — existing payment flow works unchanged.
outcome: Users pay USDC to operator wallet instead of DAO wallet. Keystore loaded at startup, address verified against repo-spec. WalletSignerPort interface ready for PR 2/3.
spec_refs: operator-wallet
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
---

# Operator wallet generation + wiring into existing payment flow

## Requirements

- `scripts/generate-operator-wallet.ts` generates an encrypted keystore (Web3 Secret Storage v3) and prints the checksummed address to stdout
- Passphrase read from env var (never CLI arg), keystore output path configurable via flag
- `WalletSignerPort` interface defined in `src/ports/wallet-signer.port.ts` with `getAddress()`, `sendUsdcToTreasury()`, `signTopUpTransaction()` method stubs
- `KeystoreSignerAdapter` in `src/adapters/server/wallet/keystore-signer.adapter.ts` loads keystore at startup, verifies derived address matches `operator_wallet.address` from repo-spec
- `FakeWalletSignerAdapter` in `src/adapters/test/wallet/` for CI (APP_ENV=test)
- `operator_wallet.address` added to `.cogni/repo-spec.yaml` schema + validation
- `RECEIVING_ADDRESS_MATCH` invariant enforced: startup check that `payments_in.credits_topup.receiving_address === operator_wallet.address`
- New env vars: `OPERATOR_KEYSTORE_PATH`, `OPERATOR_WALLET_PASSPHRASE` (optional — only required when operator wallet features are enabled)
- `ADDRESS_VERIFIED_AT_STARTUP` invariant: mismatch between keystore-derived address and repo-spec → fail fast
- `KEY_NEVER_LOGGED` invariant: private key and passphrase never appear in logs or error messages
- Existing payment flow (intent → sign → verify → credits) works unchanged — only `receiving_address` value changes

## Allowed Changes

- `scripts/generate-operator-wallet.ts` (new)
- `src/ports/wallet-signer.port.ts` (new)
- `src/ports/index.ts` (add export)
- `src/adapters/server/wallet/keystore-signer.adapter.ts` (new)
- `src/adapters/server/index.ts` (add export)
- `src/adapters/test/wallet/fake-wallet-signer.adapter.ts` (new)
- `src/adapters/test/index.ts` (add export)
- `src/shared/config/repoSpec.schema.ts` (add operator_wallet schema)
- `src/shared/config/repoSpec.server.ts` (add getOperatorWalletConfig)
- `src/shared/env/server-env.ts` (add OPERATOR_KEYSTORE_PATH, OPERATOR_WALLET_PASSPHRASE)
- `src/bootstrap/container.ts` (wire adapter)
- `.cogni/repo-spec.yaml` (add operator_wallet section — placeholder address for dev)
- `tests/` (unit tests for generation script, port contract test, adapter test)

## Plan

- [ ] Read existing `onchain-verifier.port.ts` and `repoSpec.schema.ts` patterns for port + config conventions
- [ ] Define `WalletSignerPort` interface in `src/ports/wallet-signer.port.ts` — `getAddress()`, `sendUsdcToTreasury(amountRaw, reference)`, `signTopUpTransaction(intent)` (PR 2/3 will implement the methods; this PR defines the interface)
- [ ] Add `operator_wallet` schema to `repoSpec.schema.ts` with `address` field validation
- [ ] Add `getOperatorWalletConfig()` to `repoSpec.server.ts`
- [ ] Add startup validation: `receiving_address === operator_wallet.address` (RECEIVING_ADDRESS_MATCH)
- [ ] Add env vars `OPERATOR_KEYSTORE_PATH` and `OPERATOR_WALLET_PASSPHRASE` to `server-env.ts` (both optional)
- [ ] Create `KeystoreSignerAdapter` — constructor loads keystore, decrypts, verifies address
- [ ] Create `FakeWalletSignerAdapter` for test mode
- [ ] Wire in `container.ts` — conditional on env vars being set (graceful skip if not configured)
- [ ] Write `scripts/generate-operator-wallet.ts` using ethers.js `Wallet.createRandom()` + `wallet.encrypt(passphrase)`
- [ ] Add `operator_wallet` section to `.cogni/repo-spec.yaml` with placeholder address
- [ ] Write port contract test (`tests/contract/wallet-signer.contract.ts`)
- [ ] Write unit test for generation script
- [ ] Run `pnpm check` to verify no lint/type/architecture violations

## Validation

**Commands:**

```bash
pnpm check
pnpm test tests/contract/wallet-signer.contract.ts
pnpm test tests/unit/scripts/generate-operator-wallet.test.ts
```

**Expected:** All tests pass. `pnpm check` clean. No dependency-cruiser violations.

## Review Checklist

- [ ] **Work Item:** `task.0084` linked in PR body
- [ ] **Spec:** KEY_NEVER_LOGGED, ADDRESS_VERIFIED_AT_STARTUP, NO_GENERIC_SIGNING, RECEIVING_ADDRESS_MATCH invariants upheld
- [ ] **Tests:** Port contract test + generation script test + startup validation test
- [ ] **Reviewer:** assigned and approved
- [ ] **Architecture:** Port in `src/ports/`, adapter in `src/adapters/server/wallet/`, no layer violations

## PR / Links

-

## Attribution

-
