---
id: proj.ai-operator-wallet
type: project
primary_charter:
title: AI Operator Wallet
state: Active
priority: 1
estimate: 3
summary: App-controlled operator wallet (Privy-managed) receives user USDC payments, sweeps DAO share to treasury, and tops up OpenRouter credits autonomously. No custom smart contracts, no raw signing in app.
outcome: Users pay USDC to operator wallet → app mints credits + sweeps DAO treasury share + tops up OpenRouter → credits backed by real LLM spend. Zero manual transfers.
assignees: derekg1729
created: 2026-02-11
updated: 2026-02-18
labels: [wallet, billing, web3]
---

# AI Operator Wallet

> Research: [ai-operator-wallet-budgeted-spending](../../docs/research/ai-operator-wallet-budgeted-spending.md)

## Goal

Close the financial loop so every credit purchase automatically provisions OpenRouter — no manual transfers, no DAO votes per purchase. The operator wallet is a Privy-managed server wallet. Users pay USDC directly to it (reusing the existing payment flow). After credits mint, the app sweeps the DAO's share to treasury and tops up OpenRouter with the provider cost.

## Roadmap

### Crawl (P0) — Operator Wallet + Outbound Payments

**Goal:** Operator wallet provisioned via Privy, wired into existing payment flow, sweeping DAO share and topping up OpenRouter.

3 atomic PRs, each shippable:

| #   | Deliverable                           | Status      | Est | Work Item |
| --- | ------------------------------------- | ----------- | --- | --------- |
| 1   | Operator wallet provisioning + wiring | Not Started | 2   | task.0084 |
| 2   | DAO treasury USDC sweep               | Not Started | 2   | task.0085 |
| 3   | OpenRouter top-up integration         | Not Started | 3   | task.0086 |

**PR 1 — Operator wallet provisioning + wiring:**

- `scripts/provision-operator-wallet.ts` — create wallet via Privy API, output address
- Add `operator_wallet.address` to `.cogni/repo-spec.yaml`
- Update `payments_in.credits_topup.receiving_address` → operator wallet address
- `OperatorWalletPort` interface in `src/ports/operator-wallet.port.ts`
- Privy adapter: verify Privy-reported address matches repo-spec at startup
- Wire into `src/bootstrap/container.ts`
- Existing payment flow works unchanged — users now send USDC to operator wallet instead of DAO wallet

**PR 2 — DAO treasury USDC sweep:**

- After credit settlement, app sweeps DAO share (USDC) from operator wallet to treasury
- `OperatorWalletPort.sweepUsdcToTreasury(amount, reference)` — typed intent, not generic signing
- `outbound_transfers` table to track sweep state (idempotent, keyed by clientPaymentId)
- Treasury address from `cogni_dao.dao_contract` in repo-spec (existing config)
- Sweep amount = `paymentUsd - topUpUsd` (DAO margin)
- Add `calculateDaoShare()` to `src/core/billing/pricing.ts`
- Charge receipt with `reason: dao_treasury_sweep`

**PR 3 — OpenRouter top-up integration:**

- `OperatorWalletPort.fundOpenRouterTopUp(intent)` — typed intent for Coinbase Commerce protocol
- `calculateOpenRouterTopUp()` in `src/core/billing/pricing.ts`
- OpenRouter charge creation → Coinbase Commerce `swapAndTransferUniswapV3Native` → submit via Privy
- `outbound_topups` table + state machine (CHARGE_PENDING → CHARGE_CREATED → TX_BROADCAST → CONFIRMED)
- Charge receipt logging with `openrouter_topup` reason
- New env vars: `OPENROUTER_CRYPTO_FEE`, `OPERATOR_MAX_TOPUP_USD`
- Margin safety check at startup: `MARKUP × (1 - FEE) > 1 + REVENUE_SHARE`

### Walk (P1) — Monitoring + Hardening

**Goal:** Observability, automated balance checks, optional OSS custody adapter.

| Deliverable                                               | Status      | Est | Work Item            |
| --------------------------------------------------------- | ----------- | --- | -------------------- |
| Grafana alerts: operator balance, top-up failures, margin | Not Started | 2   | (create at P1 start) |
| OpenRouter balance probe (GET /api/v1/credits polling)    | Not Started | 1   | (create at P1 start) |
| Keystore/Vault adapter (OSS fallback for Privy)           | Not Started | 3   | (create at P1 start) |
| Circuit breaker: pause purchases on persistent failures   | Not Started | 2   | (create at P1 start) |
| UI admin panel: trigger manual top-up, view status        | Not Started | 2   | (create at P1 start) |

### Run (P2+) — Autonomous Spending

**Goal:** AI monitors its own balance and tops up within DAO-approved limits.

| Deliverable                                                 | Status      | Est | Work Item            |
| ----------------------------------------------------------- | ----------- | --- | -------------------- |
| Auto top-up: agent monitors credit balance, triggers top-up | Not Started | 2   | (create at P2 start) |
| On-chain spending limits (Zodiac Roles or session keys)     | Not Started | 3   | (create at P2 start) |
| x402 integration for AI-to-service micropayments            | Not Started | 2   | (create at P2 start) |

## Constraints

- Base mainnet (8453) only for P0
- No custom smart contracts — operator wallet is a plain EOA
- No DAO votes per purchase — app handles routing autonomously
- No raw key material in the application — Privy holds signing keys
- Credits mint after on-chain USDC transfer confirmation (existing flow unchanged)
- Operator wallet address is governance-in-git (repo-spec)
- Programmatic setup — secrets injected into deploy secret store, no copy/paste

## Dependencies

- [x] OpenRouter Crypto Payments API supports Base (chain_id 8453)
- [x] `cogni_system` billing account exists (task.0046, merged)
- [x] Revenue share constants exist (`SYSTEM_TENANT_REVENUE_SHARE`, `USER_PRICE_MARKUP_FACTOR`)
- [x] Existing USDC payment flow works end-to-end
- [ ] `EVM_RPC_URL` configured for Base mainnet
- [ ] Privy app created with wallet policies configured

## As-Built Specs

- [web3-openrouter-payments](../../docs/spec/web3-openrouter-payments.md) — payment math, top-up state machine (draft)
- [operator-wallet](../../docs/spec/operator-wallet.md) — wallet lifecycle, custody, access control (draft)

## Design Notes

### Why Privy over local keystore?

Local keystores require generating, encrypting, and distributing private key material. The app loads the key into memory, making it a hot wallet with full signing authority. Privy provides:

1. **No key material in app** — HSM-backed signing, private key never leaves Privy infrastructure
2. **Wallet policies** — Privy-side guardrails (chain, contracts, caps) as defense in depth
3. **Signed requests** — `PRIVY_SIGNING_KEY` adds a second auth factor; leaked `APP_SECRET` alone can't sign
4. **Programmatic setup** — API call creates wallet, no keystore files to manage
5. **Portability** — `OperatorWalletPort` abstraction means we can swap to keystore/Vault later (P1)

The tradeoff: vendor dependency on Privy. Mitigated by the port abstraction — a `KeystoreOperatorWalletAdapter` can be built as a P1 OSS fallback.

### Why operator wallet as receiving address (not a PaymentRouter contract)?

The existing payment flow already handles USDC transfers to a configured address, verifies on-chain, and mints credits. By making the operator wallet the receiving address, we reuse 100% of the existing payment infrastructure. The app then handles the split — sweeping DAO share as USDC, topping up OpenRouter with the rest. No new contracts, no Foundry toolchain, no on-chain split logic.

The tradeoff: the split is not atomic on-chain. If the app crashes between credit mint and DAO sweep, the operator wallet holds the USDC temporarily. This is acceptable because:

1. The operator wallet is controlled by the app (not a third party)
2. `outbound_transfers` table provides durable state tracking + retry
3. The DAO treasury sweep is idempotent (keyed by clientPaymentId)
4. Worst case: USDC sits in operator wallet until next restart — no loss

### Why USDC sweep (not swap-then-forward)?

The DAO treasury share stays as USDC — no swap needed. Only the OpenRouter top-up requires ETH (via Coinbase Commerce protocol swap). This minimizes swap exposure and keeps the DAO's USDC position clean.

### OpenRouter top-up is the Coinbase Commerce protocol

OpenRouter returns a `transfer_intent` (not raw calldata). We encode `swapAndTransferUniswapV3Native(intent, poolFeesTier=500)` on the Coinbase Transfers contract (`0xeADE6bE02d043b3550bE19E960504dbA14A14971` on Base). See [web3-openrouter-payments spec](../../docs/spec/web3-openrouter-payments.md) for full flow.

### Top-up economics (derived from constants)

```
openrouterTopUpUsd = paymentUsd × (1 + REVENUE_SHARE) / (MARKUP × (1 - PROVIDER_FEE))

Defaults: 1.75 / (2.0 × 0.95) = $0.9211 per $1.00 purchase
DAO share: $1.00 - $0.9211 = $0.0789 (7.9% margin)
```

See [web3-openrouter-payments spec](../../docs/spec/web3-openrouter-payments.md) for full derivation.
