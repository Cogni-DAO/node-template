---
id: proj.ai-operator-wallet
type: project
primary_charter:
title: AI Operator Wallet
state: Active
priority: 1
estimate: 3
summary: Give the system-tenant AI a wallet it can use to pay for things — starting with OpenRouter credits via their crypto API.
outcome: AI agent autonomously tops up OpenRouter credits from a DAO-funded wallet on Base, with off-chain budget tracking.
assignees: derekg1729
created: 2026-02-11
updated: 2026-02-11
labels: [wallet, ai-agent, billing, web3]
---

# AI Operator Wallet

> Research: [ai-operator-wallet-budgeted-spending](../../docs/research/ai-operator-wallet-budgeted-spending.md)

## Goal

Give the `cogni_system` tenant a real crypto wallet so the AI can pay for its own infrastructure. P0 is laser-focused: agent holds ETH on Base, calls [OpenRouter's Crypto Payments API](https://openrouter.ai/docs/api/api-reference/credits/create-coinbase-charge) to top up LLM credits programmatically. No Vault, no Safe, no account abstraction — just an encrypted keystore file and a signer port.

## Roadmap

### Crawl (P0) — Agent Has a Key, Can Pay OpenRouter

**Goal:** A server-side wallet exists, can sign transactions, and can call the OpenRouter crypto payments API to convert ETH→credits on Base.

| Deliverable                                                                                     | Status      | Est | Work Item |
| ----------------------------------------------------------------------------------------------- | ----------- | --- | --------- |
| `WalletSignerPort` interface + encrypted-keystore adapter                                       | Not Started | 2   | —         |
| Keypair generation script (outputs encrypted keystore JSON + address)                           | Not Started | 1   | —         |
| `operator_wallet` field in repo-spec.yaml schema + validation                                   | Not Started | 1   | —         |
| OpenRouter crypto top-up service (`POST /api/v1/credits/coinbase` → sign + broadcast)           | Not Started | 2   | —         |
| Off-chain budget tracking: log each top-up as a `charge_receipt` with reason `openrouter_topup` | Not Started | 1   | —         |
| Integration test: generate key → sign a tx → verify signature (no on-chain)                     | Not Started | 1   | —         |

**P0 key management is intentionally simple:**

- `ethers.Wallet.encrypt(privateKey, passphrase)` → JSON keystore file (AES-128-CTR + scrypt)
- Passphrase from env var (`OPERATOR_WALLET_PASSPHRASE`)
- Keystore file path from env var (`OPERATOR_KEYSTORE_PATH`)
- No Vault, no KMS, no external infra — just a file + a secret
- This is the same format MetaMask, Geth, and every Ethereum client uses

**P0 payment flow:**

```
Agent decides to top up → calls OpenRouter API with amount + sender + chain_id(8453)
  → gets back calldata (to, value, data)
  → WalletSignerPort signs + broadcasts via EVM_RPC_URL
  → OpenRouter credits appear (immediate for <$500)
  → charge_receipt logged with tx_hash
```

**P0 does NOT include:**

- DAO governance approval flow (manual ETH funding for now)
- USDC spending (OpenRouter takes native ETH on Base)
- Automated budget decisions (human triggers top-ups)
- Formation-time wallet creation (standalone script for now)

### Walk (P1) — DAO-Governed Budget

**Goal:** DAO controls the wallet's funding via governance. Automated budget monitoring.

| Deliverable                                                                  | Status      | Est | Work Item            |
| ---------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| DAO formation wizard step: generate operator keypair + record in repo-spec   | Not Started | 2   | (create at P1 start) |
| Governance proposal helper: fund operator wallet with ETH from DAO treasury  | Not Started | 2   | (create at P1 start) |
| ERC-20 allowance flow: DAO approves USDC spending cap for operator wallet    | Not Started | 2   | (create at P1 start) |
| Budget monitoring: Grafana alerts on balance thresholds + spend rate         | Not Started | 1   | (create at P1 start) |
| Upgrade key management: Vault or KMS signer adapter (replaces keystore file) | Not Started | 3   | (create at P1 start) |

### Run (P2+) — Autonomous Spending

**Goal:** AI decides when and how much to spend within DAO-approved limits.

| Deliverable                                                               | Status      | Est | Work Item            |
| ------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Automated top-up: agent monitors credit balance, triggers top-up when low | Not Started | 2   | (create at P2 start) |
| On-chain spending limits (Zodiac Roles or session keys)                   | Not Started | 3   | (create at P2 start) |
| x402 integration for AI-to-service micropayments                          | Not Started | 2   | (create at P2 start) |
| Multi-wallet: per-service wallets with separate budgets                   | Not Started | 2   | (create at P2 start) |

## Constraints

- P0 has zero external infrastructure dependencies (no Vault, no KMS, no Safe)
- Key material never in source control — encrypted keystore file + passphrase env var only
- 100% OSS — no Privy, no Coinbase CDP, no vendor custody (per AGENTS.md)
- `WalletSignerPort` is a proper hexagonal port — key management impl is swappable
- Off-chain budget tracking uses existing billing tables, no new schema (except repo-spec field)
- OpenRouter crypto API requires native ETH on Base, not USDC — P0 wallet holds ETH

## Dependencies

- [x] OpenRouter Crypto Payments API exists and supports Base (chain_id 8453)
- [ ] `cogni_system` billing account exists (proj.system-tenant-governance P0)
- [ ] `EVM_RPC_URL` configured for Base mainnet

## As-Built Specs

- (none yet — specs created when code merges)

## Design Notes

### Why encrypted keystore (not raw env var)?

Raw private key in env is an anti-pattern — process dumps, logging accidents, container inspection all leak it. Ethereum's standard encrypted keystore (AES-128-CTR + scrypt KDF) is the minimum viable security. The passphrase is still in env, but the key at rest is encrypted. This is what Geth, MetaMask, and every Ethereum node uses.

### Why ETH on Base (not USDC)?

OpenRouter's crypto API (`POST /api/v1/credits/coinbase`) accepts native chain tokens only. On Base, that's ETH. USDC→ETH swap is possible but adds DEX complexity to P0 — defer to P1 if needed.

### Why not integrate with formation wizard in P0?

Formation is a 2-tx browser flow. Adding server-side key generation mid-wizard complicates the UX. P0 ships a standalone `scripts/generate-operator-wallet.ts` that the operator runs once. P1 integrates it into the wizard.

### OpenRouter Crypto API shape

```
POST https://openrouter.ai/api/v1/credits/coinbase
Authorization: Bearer <OPENROUTER_API_KEY>

{ "amount": 10, "sender": "0x...", "chain_id": "8453" }

→ { "data": { "id", "web3_data": { "call_data": { "to", "value", "data" } } } }
```

Agent signs + broadcasts the returned calldata. Credits appear immediately for amounts under $500. 5% fee.
