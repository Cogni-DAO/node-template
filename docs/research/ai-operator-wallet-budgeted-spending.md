---
id: ai-operator-wallet-budgeted-spending
type: research
title: "AI Operator Wallet with Budgeted Spending"
status: draft
trust: draft
summary: Best practices for empowering a system-tenant AI with budgeted on-chain spending via a DAO→operator wallet created at formation time.
read_when: Designing AI wallet custody, operator spending limits, or DAO-delegated on-chain payments.
owner: derekg1729
created: 2026-02-11
tags: [wallet, security, dao, ai-agent, billing]
---

# Research: AI Operator Wallet with Budgeted Spending

> date: 2026-02-11

## Question

What is the best practice for empowering a system-tenant AI to have budgeted control over a crypto wallet — ideally a DAO→operator wallet created at DAO-formation time, with the wallet secret owned only by the AI, so AI/service runs can autonomously pay for things (LLM inference, infrastructure, etc.)?

## Context

### What exists today

**DAO Formation** (`/setup/dao` wizard): Creates an Aragon OSx DAO (TokenVoting plugin + GovernanceERC20 + CogniSignal) in 2 transactions on Base. The DAO contract address becomes the treasury and `receiving_address` in `.cogni/repo-spec.yaml`. No operator wallet is created during formation.

**Payment flow**: Inbound USDC → DAO contract (manual widget). Outbound billing is off-chain only: LiteLLM cost oracle → markup → charge_receipts + credit_ledger. The DAO wallet itself never programmatically spends; all LLM costs are paid via `LITELLM_MASTER_KEY` (service auth), not from on-chain funds.

**System tenant** (`cogni_system`): Spec'd but not yet implemented. Defines a first-class billing account with `is_system_tenant=true`, explicit tool allowlists, budget caps, and defense-in-depth policy enforcement. Currently has no wallet — it's a pure off-chain accounting entity.

**Key management**: Zero private keys in the codebase or environment. All user wallet interactions happen via wagmi/RainbowKit (browser-side signing). The server never holds signing authority.

**Gap**: There is no mechanism for the AI/service to autonomously sign on-chain transactions. The system tenant can't pay for anything on-chain. Infrastructure costs (GPU, RPC nodes) and LLM costs are paid out-of-band by the operator manually.

---

## Findings

### Option A: Privy Server Wallets

**What**: Privy (now Stripe-owned) provides server-side embedded wallets where keys are split and only reconstituted point-in-time in secure enclaves. A policy engine caps spend per transaction or time window, allowlists contracts/recipients, and can require m-of-n approval quorums.

**Pros**:

- Battle-tested at scale (50M+ wallets deployed via Turnkey infrastructure)
- Built-in policy engine (spending limits, recipient allowlists, time windows)
- Keys never exist in plaintext — split-key architecture with secure enclave signing
- Multi-chain (EVM, Solana, Bitcoin)
- **Privy has a published case study on equipping OpenClaw agents with wallets** — directly relevant to our OpenClaw integration
- Stripe acquisition (2025) signals long-term viability and fiat↔crypto bridging

**Cons**:

- Vendor dependency (proprietary API, not self-hostable)
- Monthly cost per active wallet (pricing undisclosed, likely enterprise-tier)
- Key custody is delegated to Privy/Turnkey infrastructure — the AI doesn't truly "own" the key in a sovereign sense
- Not compatible with Akash/Spheron self-hosted infrastructure philosophy

**OSS tools**: None (proprietary). Client SDK is open but backend is closed.

**Fit with our system**: High integration fit due to OpenClaw precedent. Would slot in as a new adapter (`src/adapters/server/wallet/privy-signer.adapter.ts`). However, conflicts with the "100% OSS stack" principle in AGENTS.md.

---

### Option B: Gnosis Safe + Zodiac Roles Modifier

**What**: DAO treasury lives in a Safe multisig. The Zodiac Roles Modifier is installed as a module, creating a "role" with granular permissions (which tokens, amounts, recipients, functions). The AI agent's address is assigned the role and can execute transactions through the Roles Modifier, which validates each call against the permission set.

**Pros**:

- Fully on-chain enforcement — even a compromised agent cannot exceed the role's limits
- Battle-tested ($600B+ transaction volume through Safe in 2025; >50% of Safe txs on Gnosis Chain are already AI agents)
- Rich permission model: per-token caps, recipient allowlists, function-level scoping, rate limits
- TypeScript SDK for programmatic role configuration
- Safe Watch Agent (AI-powered pre-execution security analysis) available as add-on
- Open source (Zodiac is GPL, Safe contracts are audited)

**Cons**:

- Requires migrating from Aragon DAO contract to Safe as treasury (or running both)
- Gas cost for every on-chain enforcement check
- Zodiac Roles configuration is complex (steep learning curve)
- Changing limits requires on-chain governance transactions
- The AI agent still needs a private key (EOA) to submit transactions to the Roles Modifier — key management problem isn't solved, just scoped

**OSS tools**: [zodiac-modifier-roles](https://github.com/gnosisguild/zodiac-modifier-roles), [Safe contracts](https://github.com/safe-global/safe-contracts), Safe SDK

**Fit with our system**: Moderate. Would require a parallel Safe deployment alongside the Aragon DAO, or a migration. The Aragon DAO could approve an `EXECUTE_PERMISSION` grant to the Safe, making the Safe a spending delegate. More moving parts but fully sovereign and auditable.

---

### Option C: Aragon OSx Plugin + ERC-20 Allowance (Simplest Path)

**What**: Use Aragon's native permission system. DAO governance approves an ERC-20 `approve(agentWallet, maxUSDC)` call granting the AI's wallet a spending allowance. The AI wallet is created at DAO-formation time and stored encrypted. The agent can only `transferFrom` up to the approved amount.

**Pros**:

- Uses existing Aragon infrastructure — no new contract deployments
- Simplest on-chain mechanism (single `approve` governance proposal)
- Minimal gas overhead (standard ERC-20 allowance)
- DAO retains full control — can revoke allowance via governance at any time
- Formation-time wallet creation is a clean UX: "Your DAO's AI gets its own wallet"

**Cons**:

- No time-based resets without additional smart contract logic (approval is a single cap, not daily/weekly)
- No per-transaction limits (agent could drain the entire allowance in one transaction)
- Coarse control — binary approve/revoke, no function-level scoping
- Still need to solve key management for the agent's EOA
- No built-in monitoring or circuit breakers

**OSS tools**: Standard ERC-20, Aragon OSx SDK, viem for signing

**Fit with our system**: Highest. Zero new infrastructure. DAO formation wizard gains one more step: "Create AI operator wallet and approve initial USDC budget." The `repo-spec.yaml` gains an `operator_wallet` field. The approval is a governance proposal — fully auditable.

---

### Option D: Coinbase AgentKit + CDP Smart Wallets

**What**: Coinbase Developer Platform provides framework-agnostic AI agent wallets using ERC-4337 (account abstraction). Smart contract wallets with gasless transactions on Base. AgentKit provides "action providers" (DeFi swaps, transfers, etc.) that plug into any LLM framework.

**Pros**:

- Gasless USDC transfers on Base (our chain) — no ETH needed for gas
- ERC-4337 smart wallets enable session keys with scoped permissions (time windows, max amounts, allowed contracts)
- AgentKit is open source (TypeScript + Python SDKs)
- x402 protocol for HTTP-native AI-to-service micropayments (agent pays per-request via HTTP 402)
- Base-native — aligned with our chain choice
- Coinbase Payments MCP (2026) enables LLMs to access wallets via MCP tools

**Cons**:

- CDP key management is Coinbase-hosted (not self-hostable)
- No built-in spending limits in AgentKit itself — must layer controls on top
- Relatively new (launched 2025), rapidly changing API surface
- Smart wallet account abstraction adds complexity vs simple EOA
- Vendor lock-in to Coinbase infrastructure for key custody

**OSS tools**: [agentkit](https://github.com/coinbase/agentkit) (MIT), [x402](https://github.com/coinbase/x402) (open standard)

**Fit with our system**: Good for Base-specific features (gasless USDC). x402 is particularly interesting for the AI paying for external services (LLM inference, infrastructure APIs). However, CDP key custody conflicts with sovereignty goals.

---

### Option E: Cloud KMS Signing + On-Chain Allowance (Hybrid)

**What**: The AI's private key lives in AWS KMS (or GCP Cloud KMS) — FIPS 140-3 Level 3 HSMs where the key never leaves the hardware. The key is generated at DAO-formation time, the public address is derived and stored in `repo-spec.yaml`, and the DAO approves a spending allowance to that address. The application signs transactions by calling KMS, never seeing the raw key.

**Pros**:

- Key never exists in plaintext anywhere — not in env vars, not in memory, not in config
- FIPS 140-3 Level 3 certification (bank-grade security)
- Full audit trail of every signing operation (CloudTrail/Cloud Audit Logs)
- Self-hosted key custody — Cogni controls the KMS, not a third party
- Works with standard EVM transactions (no account abstraction complexity)
- Can import existing keys or generate new ones
- Supports secp256k1 (Ethereum's curve)

**Cons**:

- Cloud vendor dependency (AWS/GCP) — somewhat conflicts with Akash deployment model
- KMS signing latency (~50-200ms per signature) — fine for our use case
- Key rotation is complex for blockchain addresses (new key = new address = new governance approval)
- No built-in spending limits at the KMS layer — must combine with on-chain controls
- `web3-kms-signer` library is small/community-maintained

**OSS tools**: [web3-kms-signer](https://github.com/JonathanOkz/web3-kms-signer), [AWS KMS guide for Ethereum](https://aws.amazon.com/blogs/database/part1-use-aws-kms-to-securely-manage-ethereum-accounts/)

**Fit with our system**: Strong for production security. The KMS address becomes the `operator_wallet` in `repo-spec.yaml`. On-chain allowance from DAO provides the spending cap. Off-chain billing system tracks running totals. Can be combined with any on-chain option (C, B, or D).

---

### Key Management Comparison

| Approach            | Key Sovereignty | Key Visibility        | Self-Hostable | Production-Ready      |
| ------------------- | --------------- | --------------------- | ------------- | --------------------- |
| Env var (raw key)   | Full            | Plaintext in memory   | Yes           | **No — anti-pattern** |
| Cloud KMS (AWS/GCP) | Cloud vendor    | Never plaintext       | No (cloud)    | Yes                   |
| HashiCorp Vault     | Self-hosted     | Encrypted at rest     | Yes           | Yes                   |
| Privy/Turnkey       | Vendor          | Split-key/TEE         | No            | Yes                   |
| Coinbase CDP        | Vendor          | Hosted                | No            | Yes                   |
| Lit Protocol PKPs   | Decentralized   | DKG (no single party) | N/A (network) | Beta                  |

For a self-hosted Akash deployment, **HashiCorp Vault** is the most aligned option. For cloud deployments, **AWS KMS** is the gold standard. For rapid MVP, **Privy server wallets** have the OpenClaw precedent.

---

## Recommendation

**Phase 1 (MVP): Option C + HashiCorp Vault**

The simplest viable path that maintains sovereignty:

1. **DAO Formation**: Add a step that generates a new keypair (via Vault or locally), stores the private key in HashiCorp Vault (or KMS for cloud deploys), and records the public address in `repo-spec.yaml` as `operator_wallet`.
2. **DAO Governance**: The DAO approves `USDC.approve(operatorWallet, budgetAmount)` — a single governance proposal sets the spending cap.
3. **Application Signing**: A new `WalletSignerPort` with a `VaultSignerAdapter` (or `KmsSignerAdapter`) signs transactions on behalf of the AI. The raw key never touches the application.
4. **Off-Chain Budget Tracking**: The existing billing system (`charge_receipts`, `credit_ledger`) tracks spending against the on-chain allowance. The system refuses to sign if off-chain tracking says budget is exhausted (first gate). The on-chain allowance is the hard cap (second gate).
5. **Observability**: Every signing operation emits a structured log event to Loki. Grafana alerts on spend rate anomalies.

**Phase 2 (Hardening): Add Zodiac Roles or Session Keys**

Once the MVP is proven, layer on:

- **Zodiac Roles Modifier** for per-transaction limits, recipient allowlists, and rate limiting (if Safe migration is acceptable)
- **OR** ERC-4337 session keys via AgentKit for time-bounded, scoped permissions without Safe migration
- Circuit breaker: automated role/session revocation on anomaly detection

**Phase 3 (x402 Integration)**

For AI-to-service payments (the AI paying for external APIs, infrastructure):

- Integrate x402 protocol for HTTP-native micropayments
- The operator wallet pays per-request to external services
- Aligns with the "crypto-metered AI backend" vision

**Why this recommendation**:

- Maximizes sovereignty (self-hosted key management, on-chain DAO control)
- Minimizes new infrastructure (reuses Aragon, adds only Vault + signer adapter)
- Layered defense (off-chain budget tracking + on-chain allowance cap)
- Clean formation UX (wallet created alongside DAO)
- Aligns with existing architecture (new port + adapter, hexagonal pattern)

---

## Open Questions

1. **Vault vs KMS vs formation-time encryption**: For Akash deployments, where does Vault run? Is a simpler approach (encrypted keystore file + passphrase in env) acceptable for P0, with Vault as P1?
2. **Gas funding**: The operator wallet needs ETH for gas on Base. Who funds it? DAO governance approves an ETH transfer too? Or use a paymaster (ERC-4337) for gasless?
3. **Key rotation**: If the operator key is compromised, the DAO revokes allowance and approves a new address. Is this response time acceptable? Should there be an automated circuit breaker?
4. **Multi-wallet**: Should there be one operator wallet per service (scheduler, OpenClaw, governance loops) or one shared wallet? Blast radius vs complexity trade-off.
5. **Aragon EXECUTE_PERMISSION**: Can the Aragon DAO's `EXECUTE_PERMISSION` be used to call `USDC.approve()` directly, or does it need a proposal plugin? Need to verify against OSx v1.4 permission model.
6. **Safe migration appetite**: Is migrating treasury to Safe worth the Zodiac Roles capabilities, or is Aragon + allowance sufficient for the foreseeable future?

---

## Proposed Layout

### Project

`proj.ai-operator-wallet` — Empower the system-tenant AI with budgeted on-chain spending authority.

**Phases**:

- **Crawl**: Formation-time wallet creation + encrypted keystore + ERC-20 allowance via governance. Off-chain budget tracking.
- **Walk**: WalletSignerPort + VaultSignerAdapter (or KmsSignerAdapter). Automated signing for LLM/infra payments. Observability + alerting.
- **Run**: Zodiac Roles or session keys for fine-grained limits. x402 for AI-to-service micropayments. Multi-wallet per service.

### Specs

- **`operator-wallet.md`** (new): Wallet lifecycle (creation, funding, allowance, rotation, revocation). Key management invariants. Signing flow. Budget enforcement (off-chain + on-chain).
- **`node-formation.md`** (update): Add operator wallet creation step to formation flow.
- **`system-tenant.md`** (update): Link system tenant to operator wallet. Define which tenant actions require on-chain signing.
- **`billing-evolution.md`** (update): Add outbound on-chain payment path alongside existing off-chain LiteLLM billing.

### Tasks (rough sequence)

1. `task.XXXX` — Add `WalletSignerPort` interface and encrypted-keystore adapter (P0, no Vault yet)
2. `task.XXXX` — Extend DAO formation to generate + store operator keypair, record address in repo-spec
3. `task.XXXX` — Build governance proposal helper: `USDC.approve(operatorWallet, budget)`
4. `task.XXXX` — Wire operator wallet into system tenant billing: sign-on-spend for LLM costs
5. `task.XXXX` — Observability: signing events → Loki, budget alerts → Grafana
6. `task.XXXX` — Vault/KMS signer adapter (production key management)

### Sources

- [Coinbase AgentKit](https://github.com/coinbase/agentkit)
- [x402 Protocol](https://www.x402.org/) | [GitHub](https://github.com/coinbase/x402)
- [Coinbase Payments MCP Launch](https://www.theblock.co/post/375791/coinbase-unveils-tool-ai-agents-claude-gemini-access-crypto-wallets)
- [Safe: AI Agent Economy](https://safe.mirror.xyz/V965PykKzlE1PCuWxBjsCJR12WscLcnMxuvR9E9bP-Y)
- [Zodiac Roles Modifier](https://docs.roles.gnosisguild.org/) | [GitHub](https://github.com/gnosisguild/zodiac-modifier-roles)
- [Privy Server Wallets](https://privy.io/blog/introducing-server-wallets)
- [Privy + OpenClaw Integration](https://privy.io/blog/securely-equipping-openclaw-agents-with-privy-wallets)
- [Turnkey AI Agent Solutions](https://www.turnkey.com/solutions/ai-agents)
- [Lit Protocol Agent Wallet](https://github.com/LIT-Protocol/agent-wallet)
- [Agent Spending Controls](https://github.com/L1AD/agent-spending-controls)
- [AWS KMS for Ethereum](https://aws.amazon.com/blogs/database/part1-use-aws-kms-to-securely-manage-ethereum-accounts/)
- [web3-kms-signer](https://github.com/JonathanOkz/web3-kms-signer)
- [HashiCorp Vault Ethereum Plugin](https://github.com/kaleido-io/vault-plugin-secrets-ethsign)
- [Aragon OSx Permissions](https://devs.aragon.org/osx/how-it-works/core/permissions/)
- [ERC-4337 Account Abstraction](https://docs.erc4337.io/)
- [ERC-7715 Permission Requests](https://docs.metamask.io/smart-accounts-kit/0.13.0/concepts/erc7715/)
- [SmartSessions Module](https://github.com/erc7579/smartsessions)
- [Autonomous Agents on Blockchains (arXiv, 2025)](https://arxiv.org/html/2601.04583v1)
