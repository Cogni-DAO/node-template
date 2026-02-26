---
id: node-operator-x402-spec
type: spec
title: "Node vs Operator Contract: x402 Edition"
status: draft
spec_state: draft
trust: draft
summary: Redefines Node/Operator/Protocol boundaries for x402 E2E architecture. Node is a sovereign AI service with a wallet. Operator provides optional shared services and packages. No financial intermediation at any layer.
read_when: Working on Node/Operator boundaries, onboarding new nodes, or understanding what the Operator provides.
owner: derekg1729
created: 2026-02-26
verified:
tags: [meta, deployment, x402, node-formation]
---

# Node vs Operator Contract: x402 Edition

> Extends [node-operator-contract.md](./node-operator-contract.md) with x402-specific boundaries.
> Spec: [x402-e2e.md](./x402-e2e.md) for the payment architecture.

## Context

The original Node vs Operator contract (node-operator-contract.md) defines sovereignty invariants that remain unchanged. This spec **extends** it with the concrete x402 architecture, answers "how does a new AI project become a Cogni node?", and defines exactly what shared infrastructure the Operator provides — without compromising Node sovereignty.

The key architectural shift: **x402 per-request settlement eliminates all financial intermediation.** The Operator never touches money. Nodes never depend on the Operator for payments. The only shared infrastructure is **packages** (code) and **optional services** (git-review, cred scoring). A Node can run without any Operator whatsoever.

## Goal

Define the minimum a new AI project needs to become a sovereign Cogni node, what the Operator provides (optional), and what is truly shared infrastructure (packages). Make onboarding trivial — fork, configure wallet, deploy.

## Non-Goals

| Item | Reason |
| - | - |
| COGNI utility token protocol | x402 E2E eliminates the need for a utility token. Research only. |
| Multi-node financial pooling | Each node is financially independent. No shared treasury. |
| Operator-mediated provider payments | Nodes pay Hyperbolic directly. Operator never touches money. |
| K8s hosting specifics | Covered by existing deployment portability invariants. |

## Core Invariants

All 10 invariants from [node-operator-contract.md](./node-operator-contract.md) are retained. This spec adds:

11. **NO_FINANCIAL_INTERMEDIATION**: Operator never sits in a payment path. Node→User and Node→Provider payments flow directly via x402. Operator never custodies, routes, or settles funds.

12. **NODE_IS_WALLET**: A Node's on-chain identity IS its wallet address. The wallet receives user x402 payments, signs outbound x402 payments to providers, and accumulates DAO margin. No separate operator wallet, no Privy, no Splits.

13. **ONBOARD_IN_HOURS**: A new AI project becomes a Cogni node by: (1) fork template, (2) deploy with wallet address + provider API key, (3) accept x402 payments. No Operator account required. No smart contract deployment required for billing.

14. **SHARED_PACKAGES_NOT_SERVICES**: Shared code lives in `packages/` (npm-installable, version-pinned). Shared services (git-review, cred scoring) are optional. A Node must never REQUIRE a running Operator service to serve AI requests or collect payment.

15. **METERING_IS_LOCAL**: Each Node runs its own LiteLLM proxy and metering pipeline. Usage data never leaves the Node unless the Node explicitly shares it (e.g., for cred scoring). Operator cannot access Node usage data.

## Design

### The Three Layers

```
┌─────────────────────────────────────────────────────────────────────┐
│ NODE (Sovereign)                                                     │
│ ────────────────                                                     │
│ What it IS:                                                          │
│   A fully sovereign AI service with its own wallet, LiteLLM proxy,  │
│   and DAO governance. Serves AI requests. Collects x402 payments.    │
│   Pays providers. Keeps margin.                                      │
│                                                                      │
│ What it RUNS:                                                        │
│   - Next.js app (UI + API routes)                                    │
│   - LiteLLM proxy (model routing + cost oracle)                      │
│   - PostgreSQL (charge_receipts, epoch ledger, virtual_keys)         │
│   - x402 middleware (inbound payment verification + settlement)      │
│   - Node wallet (signs outbound x402, receives inbound x402)         │
│                                                                      │
│ What it OWNS:                                                        │
│   - Wallet keys (never shared)                                       │
│   - Usage data (charge_receipts, llm_charge_details)                 │
│   - Provider relationships (Hyperbolic API key or x402 wallet auth)  │
│   - Pricing policy (USER_PRICE_MARKUP_FACTOR)                        │
│   - DAO governance (Aragon, repo-spec)                               │
│   - Model catalog (which models to offer, at what markup)            │
└─────────────────────────────────────────────────────────────────────┘
                              │
                    (optional, never required)
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ OPERATOR (Optional Services)                                         │
│ ────────────────────────────                                         │
│ What it IS:                                                          │
│   A meta-node providing value-add services to Nodes. A Node can      │
│   exist and function WITHOUT the Operator. The Operator adds          │
│   convenience, not capability.                                       │
│                                                                      │
│ What it PROVIDES (all optional):                                     │
│   - git-review-daemon → automated PR code review                     │
│   - git-admin-daemon → repo admin actions                            │
│   - cognicred → contributor credit scoring                           │
│   - node-registry → discovery + federation                           │
│   - node-launcher → one-click Node deployment wizard (vNext)         │
│                                                                      │
│ What it NEVER does:                                                  │
│   - Touch Node wallet keys                                           │
│   - Intermediate payments (user↔node or node↔provider)               │
│   - Access Node DB directly                                          │
│   - Set Node pricing policy                                          │
│   - Choose Node's AI provider or model catalog                       │
└─────────────────────────────────────────────────────────────────────┘
                              │
                    (npm install, version-pinned)
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ SHARED PACKAGES (Code, not Services)                                 │
│ ────────────────────────────────────                                 │
│ What they ARE:                                                       │
│   npm packages that Node and Operator both import. Published to      │
│   npm (or monorepo packages/ dir). Version-pinned. No runtime        │
│   service dependency.                                                │
│                                                                      │
│ Existing packages (carried forward):                                 │
│   - @cogni/ai-core → AiEvent, UsageFact, tool schemas               │
│   - @cogni/db-schema → Drizzle table definitions                     │
│   - @cogni/aragon-osx → DAO formation encoding + receipt parsing     │
│   - @cogni/ids → Type-branded ID utilities                           │
│                                                                      │
│ New packages for x402:                                               │
│   - @cogni/x402-middleware → Inbound x402 verification + settlement  │
│   - @cogni/x402-client → Outbound x402 payment signing               │
│   - @cogni/billing-core → pricing.ts, calculateLlmUserCharge,        │
│     calculateMaxPayable, CREDITS_PER_USD                             │
│                                                                      │
│ Key property: A Node gets x402 support by npm-installing packages.   │
│ No Operator service call needed.                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### How a New AI Project Becomes a Cogni Node

#### Minimum Viable Node (30 minutes to first paid AI request)

```
1. FORK
   $ git clone https://github.com/Cogni-DAO/node-template.git my-ai-dao
   $ cd my-ai-dao

2. CONFIGURE (3 env vars + 1 config file)
   .env:
     HYPERBOLIC_API_KEY=hyp_xxx          # Hyperbolic account API key
     NODE_WALLET_ADDRESS=0x...           # Your wallet on Base
     NODE_WALLET_PRIVATE_KEY=0x...       # Signs outbound x402 (or keystore path)
     LITELLM_MASTER_KEY=sk-xxx           # LiteLLM proxy auth

   litellm.config.yaml:
     (Default template includes DeepSeek-V3, Llama-3.3-70B, Qwen3-235B)
     (Customize: add/remove models, adjust per your Hyperbolic tier)

3. DEPLOY
   $ docker compose up                   # Single-host baseline

   That's it. The node:
   - Accepts x402 USDC payments from users/agents
   - Routes AI requests through LiteLLM to Hyperbolic
   - Pays Hyperbolic per-request via x402 from NODE_WALLET
   - Keeps DAO margin in NODE_WALLET
   - Writes charge_receipts for audit trail

4. DAO FORMATION (optional, adds governance)
   - Run the setup wizard → 2 wallet transactions
   - Deploys Aragon DAO + GovernanceERC20 + CogniSignal
   - Adds DAO addresses to .cogni/repo-spec.yaml
   - Enables epoch-based payouts to contributors
```

**What is NOT required:**
- No Operator account
- No Privy account
- No Splits contract
- No Coinbase Commerce integration
- No OpenRouter account
- No custom smart contracts for billing
- No credit purchase flow setup
- No PostgreSQL billing tables beyond charge_receipts + virtual_keys

#### Compare: Current Spec vs x402 Node

| Step | Current Spec | x402 Spec |
| - | - | - |
| Fork template | Yes | Yes |
| Deploy Next.js + LiteLLM + PostgreSQL | Yes | Yes |
| Deploy DAO (Aragon, optional) | Yes | Yes |
| Set up Privy account + secrets | **Required** | **Not needed** |
| Deploy Splits contract on Base | **Required** | **Not needed** |
| Configure Coinbase Commerce | **Required** | **Not needed** |
| Set up OpenRouter account | **Required** | **Not needed** |
| Run billing DB migrations (6+ tables) | **Required** | 2 tables (charge_receipts, virtual_keys) |
| Configure 8+ env vars for payments | **Required** | 3 env vars (wallet + Hyperbolic key) |
| **Env vars for payment infra** | PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_SIGNING_KEY, OPENROUTER_API_KEY, OPENROUTER_CRYPTO_FEE, OPERATOR_MAX_TOPUP_USD, EVM_RPC_URL, COINBASE_COMMERCE_* | HYPERBOLIC_API_KEY, NODE_WALLET_ADDRESS, NODE_WALLET_PRIVATE_KEY |
| **Time to first paid request** | Days–weeks | Hours |

### Boot Seams Matrix (x402 Edition)

| Capability | Node Owns | Operator Provides | Call Direction | Self-Host Option |
| - | - | - | - | - |
| App deployment | Infra keys, deploy scripts | — | — | Always self-host |
| DAO wallet ops | Wallet keys, signing | — | — | Always self-host |
| **Inbound payments (x402)** | **x402 middleware, wallet** | **—** | **User → Node** | **Always self-host** |
| **Outbound payments (x402)** | **x402 client, wallet** | **—** | **Node → Hyperbolic** | **Always self-host** |
| AI inference | LiteLLM proxy, Hyperbolic key | — | Node → Hyperbolic | Always self-host |
| **Usage metering** | **LiteLLM + charge_receipts** | **—** | **Node-internal** | **Always self-host** |
| PR code review | Manual review | git-review-daemon | Operator → Node repo | OSS standalone |
| Repo admin actions | Manual via GitHub UI | git-admin-daemon | Operator → Node repo | OSS standalone |
| Cred scoring | — | cognicred | Operator internal | vNext |
| Node discovery | — | node-registry | Operator reads Node | — |
| Repo-spec policy | Authors `.cogni/repo-spec.yml` | Consumes snapshot | Operator reads Node | — |

**Key change from original:** Inbound payments, outbound payments, and usage metering are all Node-owned with no Operator involvement. The Operator's role is purely governance services (git-review, cred scoring, node registry).

### Shared Packages Architecture

#### Existing Packages (Unchanged)

| Package | Purpose | Used By |
| - | - | - |
| `@cogni/ai-core` | AiEvent, UsageFact, tool schemas, source-system constants | Node, Operator services |
| `@cogni/db-schema` | Drizzle table definitions (billing, ledger) | Node |
| `@cogni/aragon-osx` | DAO formation encoding, receipt parsing, address constants | Node |
| `@cogni/ids` | Type-branded ID utilities (UserId, BillingAccountId) | Node, Operator |

#### New Packages for x402

| Package | Purpose | Used By |
| - | - | - |
| `@cogni/x402-middleware` | Express/Next.js middleware for inbound x402 verification + settlement. Responds 402 with `upto` payment requirements. Verifies authorization. Settles after completion. | Node |
| `@cogni/x402-client` | HTTP client wrapper for outbound x402. Handles 402 responses from providers. Signs authorizations from node wallet. Records settlement tx hashes. | Node |
| `@cogni/billing-core` | Extracted from `src/core/billing/pricing.ts`. Protocol constants (CREDITS_PER_USD), `calculateLlmUserCharge()`, `calculateMaxPayable()`, `usdToCredits()`. Pure functions, no IO. | Node, Operator (for display) |

**Package design principles:**
- **Pure code, no services.** Packages never make network calls at import time.
- **Version-pinned.** Node decides when to upgrade (UPGRADE_AUTONOMY invariant).
- **No transitive Operator dependency.** Installing `@cogni/x402-middleware` does NOT require an Operator account, Operator service, or Operator API key.
- **Minimal dependencies.** `@cogni/x402-middleware` depends on Thirdweb x402 SDK + viem. Nothing else.

### Kai Example: MDI as a Cogni Node

> Reference: Kai is a new AI project in the MDI ecosystem that wants to become a Cogni node.

**What Kai does:**

```
1. Fork cogni-node-template
2. Customize:
   - litellm.config.yaml: add/remove models for Kai's use case
   - .cogni/repo-spec.yaml: Kai's DAO address, governance config
   - UI: Kai's branding, features, agent personality
3. Set env vars:
   - HYPERBOLIC_API_KEY (Kai's own Hyperbolic account)
   - NODE_WALLET_ADDRESS (Kai's DAO-controlled wallet)
   - NODE_WALLET_PRIVATE_KEY (Kai's signing key)
4. Deploy: docker compose up
5. Optional: DAO formation via setup wizard
6. Optional: Register with Cogni Operator for git-review, cred scoring
```

**What Kai gets:**
- x402-powered AI service accepting USDC payments from agents/users
- LiteLLM model routing with cost tracking
- charge_receipts audit trail
- Epoch-based contributor payouts (if DAO formed)
- git-review-daemon (if registered with Operator)
- Cred scoring for contributors (if registered with Operator)

**What Kai does NOT need:**
- Privy account (no operator wallet)
- Splits contract (no revenue splitting infrastructure)
- Coinbase Commerce (no fiat bridge)
- OpenRouter account (Hyperbolic directly)
- Credit purchase flow (x402 pays per-request)
- 6 billing tables (2 tables: charge_receipts + virtual_keys)

**What Kai controls independently:**
- Which models to offer (litellm.config.yaml)
- What markup to charge (USER_PRICE_MARKUP_FACTOR)
- Who gets paid from margin (DAO governance)
- When to upgrade packages (UPGRADE_AUTONOMY)
- Whether to use Operator services (FORK_FREEDOM)

### Operator Services: What They Provide

#### git-review-daemon (Optional)

- **What it does:** Automated PR code review for Node repos
- **How Node connects:** Register repo with Operator, grant GitHub webhook access
- **Data flow:** Operator reads Node's PRs via GitHub API, posts review comments
- **Node sovereignty:** Node can unregister at any time. Manual review is always an option.
- **Deployable standalone:** OSS, can self-host without Operator

#### git-admin-daemon (Optional)

- **What it does:** Repo admin actions (branch protection, label management, etc.)
- **How Node connects:** Grant Operator GitHub app installation
- **Node sovereignty:** Node can revoke access. Manual admin is always an option.
- **Deployable standalone:** OSS, can self-host without Operator

#### cognicred (Optional)

- **What it does:** Scores contributor credit across repos for epoch payouts
- **How Node connects:** Node exports anonymized activity events to Operator
- **Data flow:** Node → Operator (activity summaries only, not usage data or financials)
- **Node sovereignty:** Node can run its own cred algorithm. Cognicred is a convenience.

#### node-registry (Optional)

- **What it does:** Discovery + federation of Cogni nodes
- **How Node connects:** Self-register via Operator API
- **Data flow:** Node publishes: endpoint URL, model catalog, pricing. Operator indexes.
- **Node sovereignty:** Node can operate undiscovered. Registry is for agent discovery.

#### node-launcher (vNext, Optional)

- **What it does:** One-click Node deployment from a web wizard
- **How it works:** Operator provisions infrastructure, forks template, configures env vars
- **Node sovereignty:** After launch, Node is fully independent. Launcher is a bootstrapping convenience.

### Financial Independence Diagram

```
 User/Agent                  Kai (Node)                 Hyperbolic
 ──────────                  ──────────                 ──────────
     │                           │                           │
     │ POST /v1/chat/completions │                           │
     │──────────────────────────>│                           │
     │                           │                           │
     │ 402 {scheme:"upto",       │                           │
     │  maxPayableAmount: $0.05} │                           │
     │<──────────────────────────│                           │
     │                           │                           │
     │ Re-request + x402 auth    │                           │
     │──────────────────────────>│                           │
     │                           │ POST /v1/chat/completions │
     │                           │──────────────────────────>│
     │                           │                           │
     │                           │ 402 {scheme:"exact",      │
     │                           │  amount: $0.001}          │
     │                           │<──────────────────────────│
     │                           │                           │
     │                           │ Re-request + x402 auth    │
     │                           │  (signed by NODE_WALLET)  │
     │                           │──────────────────────────>│
     │                           │                           │
     │                           │ 200 + streamed response   │
     │  200 + streamed response  │<──────────────────────────│
     │<──────────────────────────│                           │
     │                           │                           │
     │ settlePayment($0.002)     │ (already settled by       │
     │  (actual cost × markup)   │  Hyperbolic: $0.001)      │
     │                           │                           │
     │                           │ Margin: $0.001 stays in   │
     │                           │ Kai's NODE_WALLET         │
     │                           │                           │

  Operator is NOWHERE in this flow.
  No shared treasury. No financial intermediation. No token.
```

### What About Multi-Node Federation?

With x402, federation is **agent discovery**, not financial pooling:

| Concern | Solution | Where |
| - | - | - |
| Agent finds a node | node-registry (Operator service, optional) | Operator |
| Agent pays a node | x402 directly to that node's wallet | Node |
| Node pays provider | x402 directly to Hyperbolic | Node |
| Cross-node routing | Agent decides which node to call | Agent |
| Shared model catalog | node-registry publishes each node's offerings | Operator |
| Pricing competition | Nodes set their own markup. Agents choose cheapest. | Market |

**No shared treasury needed.** Each node collects and keeps its own margin. DAO governance within each node decides how margin is distributed to contributors.

## Implementation Checklist

### P0: Package Extraction

- [ ] Extract `@cogni/billing-core` from `src/core/billing/pricing.ts`
- [ ] Create `@cogni/x402-middleware` package skeleton (Thirdweb SDK dependency)
- [ ] Create `@cogni/x402-client` package skeleton (viem dependency)
- [ ] Document "New Node Onboarding" in docs/guides/node-onboarding.md

#### Chores

- [ ] Update AGENTS.md pointers for new packages
- [ ] Update docs/spec/packages-architecture.md with new packages

### P1: Operator Service Contracts

- [ ] Define Operator→Node API contract for git-review-daemon registration
- [ ] Define Node→Operator API contract for cred scoring data export
- [ ] Define Node→Operator API contract for node-registry self-registration

### P2: Federation

- [ ] Agent discovery protocol: how agents find and choose nodes
- [ ] Cross-node reputation: nodes rate each other's reliability
- [ ] **Do NOT build this preemptively**

## File Pointers (P0 Scope)

| File | Change |
| - | - |
| `packages/billing-core/` | NEW — Extracted from `src/core/billing/pricing.ts` |
| `packages/x402-middleware/` | NEW — Inbound x402 verification + settlement |
| `packages/x402-client/` | NEW — Outbound x402 payment signing |
| `docs/guides/node-onboarding.md` | NEW — Step-by-step guide for new nodes |
| `docs/spec/node-operator-contract.md` | UPDATE — Reference this spec as x402 extension |
| `docs/spec/packages-architecture.md` | UPDATE — Add new x402 packages |

## Open Questions

1. **Node wallet key management** — Env var is simple but insecure for production. Options: encrypted keystore file, HashiCorp Vault, CDP Agentic Wallet, hardware wallet (for manual signing). The `NodeWalletPort` interface should abstract this.

2. **Operator revenue model** — If the Operator never touches money, how does it fund itself? Options: (a) Nodes pay Operator for services via x402, (b) Operator runs its own Node and earns margin, (c) DAO treasury funds Operator from epoch allocations. This is a governance question, not a technical one.

3. **Node wallet working capital** — The node wallet must have USDC to pay Hyperbolic before receiving payment from the user (the outbound payment happens during request processing, before inbound settlement). In practice, the node needs starting capital. The first few requests require pre-funded USDC in the wallet.

4. **Embedding provider for new nodes** — If Hyperbolic has no embeddings, what should the default template include? OpenAI direct (requires OpenAI API key + fiat billing) breaks the x402-only model.

## Related

- [Node vs Operator Contract](./node-operator-contract.md) — Original sovereignty invariants (all retained)
- [x402 E2E Spec](./x402-e2e.md) — Payment architecture details
- [Node Formation](./node-formation.md) — DAO formation wizard
- [Architecture](./architecture.md) — Hexagonal layering model
- [Packages Architecture](./packages-architecture.md) — Package boundaries
- [proj.x402-e2e-migration](../../work/projects/proj.x402-e2e-migration.md) — Migration project roadmap
