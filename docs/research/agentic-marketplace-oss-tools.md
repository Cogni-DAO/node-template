---
id: agentic-marketplace-oss-tools
type: research
title: "Research: OSS Tools & Protocols Powering Agentic Marketplaces"
status: draft
trust: draft
summary: "Catalog of open-source tools, on-chain protocols, and coordination patterns used by production agentic marketplaces (Olas, Fetch.ai, Morpheus, SingularityNET, Virtuals, ElizaOS). Maps their concrete software stacks — not marketing — to inform Cogni's proj.agentic-interop and proj.agentic-project-management."
read_when: Evaluating agent coordination infrastructure, designing on-chain agent registry, or comparing agentic marketplace architectures.
owner: cogni-dev
created: 2026-03-12
tags: [agents, oss, protocols, marketplace, research]
---

# OSS Tools & Protocols Powering Agentic Marketplaces

> date: 2026-03-12
> Related: [agentic-internet-gap-analysis](agentic-internet-gap-analysis.md), [moltbook-agent-coordination-lessons](moltbook-agent-coordination-lessons.md)

## Purpose

This document catalogs the **concrete open-source software, on-chain contracts, and coordination protocols** used by production agentic marketplaces. The goal is not to propose a project — it is to create a reference for what exists so Cogni's existing projects (`proj.agentic-interop`, `proj.agentic-project-management`, `proj.agent-registry`) can make informed build-vs-adopt decisions.

---

## Platform Stacks

### 1. Olas (Autonolas) — On-Chain Agent Services

The most mature decentralized agent marketplace. 10M+ agent-to-agent transactions. Agents autonomously hire other agents via the Mech Marketplace.

**Off-Chain Framework (Python):**

| Component     | Repo                                                                    | Purpose                                  |
| ------------- | ----------------------------------------------------------------------- | ---------------------------------------- |
| Open Autonomy | [valory-xyz/open-autonomy](https://github.com/valory-xyz/open-autonomy) | FSM-based agent service framework        |
| Open AEA      | [valory-xyz/open-aea](https://github.com/valory-xyz/open-aea)           | Autonomous Economic Agent base framework |
| Open ACN      | [valory-xyz/open-acn](https://github.com/valory-xyz/open-acn)           | P2P agent communication network (libp2p) |

**Key patterns:**

- **FSM Apps** — business logic as replicated finite-state machines synchronized across all agents in a service
- **Tendermint consensus** — agents reach agreement via consensus gadgets (pruned periodically)
- **P2P via libp2p** — agents addressed by wallet public key, mapped to IP via ACN overlay

**On-Chain (Solidity, multi-chain):**

| Contract Set                                        | Purpose                                       |
| --------------------------------------------------- | --------------------------------------------- |
| **Component Registry**                              | Software components as ERC-721 NFTs           |
| **Agent Registry**                                  | Canonical agent blueprints as ERC-721 NFTs    |
| **Service Registry**                                | Multi-agent services composed from blueprints |
| **Tokenomics** (`Dispenser.sol`, `StakingBase.sol`) | OLAS staking + KPI-based reward distribution  |
| **Governance**                                      | veOLAS (vote-escrow) for DAO participation    |

**Agent coordination model:**

- **Proof-of-Active-Agent (PoAA)** — rewards real agent activity, not passive token lockup
- **KPI-based staking** — launchers define specific KPIs; agents stake OLAS to qualify for emissions
- **Mech Marketplace** — agents bid for work, other agents discover services via on-chain registry, crypto micropayments execute peer-to-peer with zero human intervention
- **Audited contracts** — Code4rena audits ([2024-05-olas](https://github.com/code-423n4/2024-05-olas), [2026-01-olas](https://github.com/code-423n4/2026-01-olas))

---

### 2. Fetch.ai (ASI Alliance) — Agent Economy

**Framework (Python):**

| Component | Repo                                                  | Purpose                                                                  |
| --------- | ----------------------------------------------------- | ------------------------------------------------------------------------ |
| uAgents   | [fetchai/uAgents](https://github.com/fetchai/uAgents) | Lightweight agent framework with decorators for task scheduling + events |

**Key patterns:**

- **Almanac Contract** — on-chain decentralized DNS for agents; stores addresses, capabilities, functions, endpoints
- **Protocol-based messaging** — agents define protocols (rules + message structures + service manifestos) for inter-agent communication
- **DeltaV** — chat-based agent discovery gateway (accessible via WhatsApp); natural language → agent matching
- **Agentverse** — 23K+ agents, 84% actively discoverable (as of 2025)

**Payment:**

- FET token with nano FET (10⁻¹⁸) micro-transactions
- `RequestPayment` protocol: structured messages specifying currencies (FET, USDC), recipient addresses, deadlines
- First production AI-to-AI autonomous payment (Dec 2025): agent discovered and booked Hotel Satoshis via DeltaV

---

### 3. Morpheus — Decentralized AI Compute

**Framework (multi-language):**

| Component             | Repo                                                                                      | Purpose                                                               |
| --------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Morpheus-Lumerin-Node | [MorpheusAIs/Morpheus-Lumerin-Node](https://github.com/MorpheusAIs/Morpheus-Lumerin-Node) | Desktop app providing chat interface to decentralized LLMs            |
| Smart Agent Protocol  | [SmartAgentProtocol/SmartAgents](https://github.com/SmartAgentProtocol/SmartAgents)       | Blockchain-agnostic protocol for connecting agents to smart contracts |

**Key patterns:**

- **Lumerin Router** — chain-agnostic smart contracts for 2-sided marketplace routing (originally designed for hashrate markets, adapted for AI inference)
- **Proxy router pattern** — inference requests routed through encrypted Lumerin proxy; GPU operators cannot access request memory
- **Fair launch tokenomics** — MOR token, 42M supply, no pre-mine; 14,400 MOR/day distributed across four pillars: Capital, Code, Compute, Community
- **Akash integration (May 2025)** — full stack decentralization: Lumerin (routing/payment) + Morpheus (AI compute) + Akash (hosting/scheduling)
- **Inference Marketplace on Base** (Dec 2025) — production deployment, $20M MOR available for compute providers

**Compute flow:** Provider registers capacity → user submits inference request → router matches via auction → MOR payment on-chain → inference routed through encrypted proxy → settlement recorded

---

### 4. SingularityNET — AI Service Marketplace

**Framework:**

| Component          | Repo                                                                        | Purpose                                                                   |
| ------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| snet-daemon        | [singnet/snet-daemon](https://github.com/singnet/snet-daemon)               | Go-based sidecar proxy handling blockchain auth + payment for AI services |
| platform-contracts | [singnet/platform-contracts](https://github.com/singnet/platform-contracts) | Solidity contracts for registration, payment channels, coordination       |
| OpenCog Hyperon    | [hyperon.opencog.org](https://hyperon.opencog.org/)                         | Cognitive framework with MeTTa language for multi-agent collaboration     |

**Key patterns:**

- **Registry.sol** — per-network contract maintaining organizations, services, type repositories
- **Payment channels** — on-chain state channels for efficient micro-transactions with minimal on-chain overhead
- **IPFS metadata** — service details stored off-chain (IPFS), only addresses/references on-chain
- **AGIX token** — utility/governance; developers paid in AGIX, consumers pay AGIX
- **Agent-to-agent learning** — agents pay each other for task execution while updating internal models with knowledge from interactions

---

### 5. Virtuals Protocol — Agent Tokenization (Base)

**Framework:**

- **GAME** (Generative Autonomous Multimodal Entities) — hierarchical agent architecture
- [Virtual-Protocol GitHub](https://github.com/Virtual-Protocol) — 28 public repos

**Architecture:**

```
Agent:
├── Task Generator (high-level planner)
├── Workers (specialized low-level planners)
├── Perception Subsystem
├── Strategic Planning Engine
├── On-chain Wallet Operator
└── Memory (Working + Long-Term)
```

**On-Chain (Base/Solidity):**

| Contract                           | Purpose                                             |
| ---------------------------------- | --------------------------------------------------- |
| AgentFactory                       | Agent instantiation, TBA registry, token management |
| Immutable Contribution Vault (ICV) | Archives all approved agent contributions on-chain  |
| AgentStaking                       | VIRTUAL staking per agent                           |
| AgentDAO                           | DAO governance per agent                            |
| Bonding.sol                        | Ascending price curve bonding                       |

**Tokenization model:**

- 1B tokens per agent (ERC-20)
- Bonding curve: early buyers pay less; graduation threshold at 42,000 VIRTUAL
- Auto-creates Uniswap V2 pool on graduation (10-year LP lock)
- 1% trading fee funds GPU/inference costs
- Ecosystem: 15,800+ AI projects, $477M total Agentic GDP (Feb 2026)

---

### 6. ElizaOS (ai16z) — Open-Source Agent Runtime

**Framework (TypeScript monorepo, pnpm):**

| Component       | Repo                                                                    | Purpose                           |
| --------------- | ----------------------------------------------------------------------- | --------------------------------- |
| Eliza           | [elizaOS/eliza](https://github.com/elizaOS/eliza)                       | Agent OS with plugin architecture |
| Plugin Registry | [elizaos-plugins/registry](https://github.com/elizaos-plugins/registry) | Community plugin ecosystem        |

**Architecture:**

```
AgentRuntime (core engine)
├── Actions      — agent capabilities (handler + validator)
├── Providers    — contextual data injection into memory
├── Evaluators   — dialogue analysis + knowledge extraction
├── Services     — background tasks
├── Adapters     — database, cache, external systems
├── Character    — agent identity definition (JSON/YAML)
└── Clients      — Discord, Telegram, Twitter, etc.
```

**Key patterns:**

- Everything TypeScript — no special SDKs, full control
- Web3-native: seamless ETH/token transfers, DeFi integration
- Character system: agent personality and behavior defined in JSON/YAML files
- v2 (Oct 2025): architectural overhaul, token migration `$ai16z` → `$elizaOS`

---

## On-Chain Standards

### ERC-8004: Trustless Agents (Live on Mainnet Jan 2026)

Proposed by contributors from MetaMask, Ethereum Foundation, Google, and Coinbase. Deployed on Ethereum, Avalanche, BNB Chain.

**Three registries:**

| Registry                | Purpose                                                                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Identity Registry**   | Lightweight ERC-721 with URI storage; assigns portable, censorship-resistant on-chain identifiers pointing to agent registration files |
| **Reputation Registry** | Clients (human or machine) submit structured performance feedback on-chain; raw signals stored for off-chain scoring/filtering         |
| **Validation Registry** | Independent verification hooks — agents request external validators (staker re-runs, zkML verifiers, TEE oracles) to check their work  |

**Key design:** Extends A2A protocol with a trust layer. Discovery and interaction across organizational boundaries without pre-existing trust.

### Olas Registry (ERC-721 NFT)

Layered on-chain registry: Component → Agent Blueprint → Service. Services composed from blueprints and managed on-chain. Mech Marketplace enables discovery directly from registry.

### Agent Identity via DIDs + Verifiable Credentials

- **W3C DIDs** — user-generated, self-owned, globally unique identifiers decoupled from centralized registries. Methods: `did:key`, `did:ion`, `did:web`, `did:olas`
- **W3C Verifiable Credentials** — third-party claims about agent capabilities in signed, tamper-evident format
- **DIDComm v2** — standardized secure communication between DID-based agents across platforms
- **Pattern:** Agent identity = ledger-anchored DID + third-party-issued VCs proving capabilities

---

## Coordination Patterns

### Agent Discovery

| Pattern                                | Used By                  | How It Works                                                                 |
| -------------------------------------- | ------------------------ | ---------------------------------------------------------------------------- |
| On-chain registry                      | Olas, ERC-8004, Virtuals | Agent capabilities registered as NFT metadata; query registry to find agents |
| Almanac contract                       | Fetch.ai                 | Decentralized DNS; agents register endpoints + protocols on-chain            |
| Agent Cards (`.well-known/agent.json`) | A2A protocol             | JSON manifest at well-known URL advertising capabilities                     |
| DeltaV search                          | Fetch.ai                 | Natural language → agent matching via chat interface                         |
| Marketplace DApp                       | SingularityNET, Olas     | Web UI browsing registered services with metadata                            |

### Payment / Settlement

| Pattern                     | Used By                            | How It Works                                             |
| --------------------------- | ---------------------------------- | -------------------------------------------------------- |
| Direct micropayments        | Olas, Fetch.ai                     | Peer-to-peer crypto transfer per task                    |
| Payment channels            | SingularityNET                     | State channels for high-frequency micro-transactions     |
| Router auction              | Morpheus                           | Lumerin router matches requests to providers via bidding |
| Bonding curve + trading fee | Virtuals                           | 1% trading fee funds agent compute; LP auto-created      |
| x402 (HTTP 402)             | Stripe/Coinbase (not agent-native) | Pay-per-request USDC gating for APIs                     |

### Staking / Quality Assurance

| Pattern                      | Used By        | How It Works                                            |
| ---------------------------- | -------------- | ------------------------------------------------------- |
| Proof-of-Active-Agent (PoAA) | Olas           | KPI-based rewards for real activity, not passive lockup |
| Validator staking            | NEAR, Ethereum | Stake tokens to participate; slashing for bad behavior  |
| Reputation registry          | ERC-8004       | On-chain feedback signals; off-chain scoring            |
| Immutable Contribution Vault | Virtuals       | Archives all contributions on-chain for transparency    |
| Agent-as-staker              | Venice (VVV)   | Stake tokens to mint compute credits for API access     |

### Work Allocation

| Pattern                   | Used By      | How It Works                                        |
| ------------------------- | ------------ | --------------------------------------------------- |
| Creator-Bid (marketplace) | Olas Mech    | Agents advertise services, other agents bid/request |
| Task delegation (A2A)     | A2A protocol | Agent sends structured task to discovered agent     |
| Inference auction         | Morpheus     | User request → router → provider bid → match        |
| Protocol-based request    | Fetch.ai     | `RequestPayment` message with structured parameters |
| WorkItemPort (internal)   | Cogni (ours) | Command/query port with status transitions + claims |

### Escrow / Dispute Resolution

| Pattern            | How It Works                                                |
| ------------------ | ----------------------------------------------------------- |
| Basic escrow       | Buyer deposits → contract locks → seller delivers → release |
| Multisig escrow    | Requires min signatures from buyer, seller, arbitrators     |
| Conditional escrow | Oracle-linked: external data/events trigger fund release    |
| Auto-approval      | Funds released after timeout (e.g., 48 hours) if no dispute |

---

## Protocol Convergence (2025-2026)

| Protocol     | Owner                             | Layer                       | Status                          |
| ------------ | --------------------------------- | --------------------------- | ------------------------------- |
| **MCP**      | Anthropic → Linux Foundation AAIF | Agent ↔ Tools (vertical)   | 97M monthly downloads, standard |
| **A2A**      | Google → Linux Foundation AAIF    | Agent ↔ Agent (horizontal) | Agent Cards, task delegation    |
| **ACP**      | IBM BeeAI                         | REST messaging              | Merged into A2A (Aug 2025)      |
| **ERC-8004** | MetaMask/EF/Google/Coinbase       | On-chain identity + trust   | Mainnet Jan 2026, multi-chain   |

**Consolidation:** Linux Foundation's **Agentic AI Foundation (AAIF)** now hosts both MCP and A2A. Founding platinum members: Amazon, Anthropic, Block, Bloomberg, Cloudflare, Google, Microsoft, OpenAI. IBM's ACP merged into A2A. The three-layer stack is: MCP (tools) + A2A (coordination) + ERC-8004 (on-chain trust).

---

## Comparative Summary

| Aspect              | Olas                | Fetch.ai             | Morpheus               | SingularityNET        | Virtuals               | ElizaOS                |
| ------------------- | ------------------- | -------------------- | ---------------------- | --------------------- | ---------------------- | ---------------------- |
| **Language**        | Python              | Python               | Multi                  | Go + Python           | Solidity + TS          | TypeScript             |
| **Agent framework** | Open Autonomy (FSM) | uAgents (decorators) | Smart Agent Protocol   | snet-daemon (sidecar) | GAME (hierarchical)    | AgentRuntime (plugins) |
| **On-chain**        | ERC-721 registries  | Almanac contract     | Lumerin Router         | Registry.sol + IPFS   | AgentFactory + Bonding | Web3 integration       |
| **Token**           | OLAS (veOLAS)       | FET (nano)           | MOR (fair launch)      | AGIX                  | VIRTUAL                | elizaOS                |
| **Payment**         | P2P micropay        | RequestPayment       | Router auction         | Payment channels      | Bonding curve fees     | Direct transfer        |
| **Quality**         | PoAA + KPI staking  | Almanac registration | Compute provider stake | Service reputation    | ICV + DAO governance   | Community plugins      |
| **Agent count**     | 10M+ txns           | 23K+ agents          | Compute marketplace    | Service catalog       | 15.8K+ projects        | Framework users        |
| **Chain**           | Multi-chain         | Fetch mainnet        | Base, Arbitrum, ETH    | Multi-chain           | Base                   | Multi-chain            |

---

## Sources

### Olas

- [Olas Developer Docs](https://docs.olas.network/open-autonomy/)
- [Olas Stack Protocol Docs](https://stack.olas.network/protocol/)
- [valory-xyz GitHub](https://github.com/valory-xyz)
- [Code4rena Olas Audit 2024-05](https://github.com/code-423n4/2024-05-olas)

### Fetch.ai

- [uAgents GitHub](https://github.com/fetchai/uAgents)
- [uAgents Documentation](https://uagents.fetch.ai/docs)
- [Fetch.ai Agent Payment Protocol](https://uagents.fetch.ai/docs/guides/agent-payment-protocol)
- [First AI-to-AI Payment (Dec 2025)](https://fetch.ai/blog/world-s-first-ai-to-ai-payment-for-real-world-transactions)

### Morpheus

- [Morpheus GitHub](https://github.com/MorpheusAIs/Morpheus)
- [Morpheus-Lumerin-Node](https://github.com/MorpheusAIs/Morpheus-Lumerin-Node)
- [Lumerin + Morpheus GitBook](https://gitbook.mor.lumerin.io/)
- [Morpheus + Akash Integration (May 2025)](https://medium.com/lumerin-blog/lumerin-and-morpheus-announce-integration-with-akash-network-to-enable-a-fully-decentralized-ai-10d11c96ee95)

### SingularityNET

- [snet-daemon GitHub](https://github.com/singnet/snet-daemon)
- [platform-contracts GitHub](https://github.com/singnet/platform-contracts)
- [OpenCog Hyperon](https://hyperon.opencog.org/)

### Virtuals Protocol

- [Virtual-Protocol GitHub](https://github.com/Virtual-Protocol)
- [GAME Framework Whitepaper](https://whitepaper.virtuals.io/builders-hub/game-framework)
- [Messari: Understanding Virtuals Protocol](https://messari.io/report/understanding-virtuals-protocol-a-comprehensive-overview)

### ElizaOS

- [elizaOS/eliza GitHub](https://github.com/elizaOS/eliza)
- [ElizaOS Architecture Docs](https://docs.elizaos.ai/plugins/architecture)
- [arXiv: Eliza — A Web3 Friendly AI Agent OS](https://arxiv.org/html/2501.06781v1)

### Standards

- [ERC-8004: Trustless Agents](https://eips.ethereum.org/EIPS/eip-8004)
- [ERC-8004 Developer Guide (QuickNode)](https://blog.quicknode.com/erc-8004-a-developers-guide-to-trustless-ai-agent-identity/)
- [W3C DIDs v1.1](https://www.w3.org/TR/did-1.1/)
- [arXiv: AI Agents with DIDs and VCs](https://arxiv.org/pdf/2511.02841)
- [arXiv: Autonomous Agents on Blockchains](https://arxiv.org/html/2601.04583v1)
- [arXiv: Agent Interoperability Protocols Survey](https://arxiv.org/html/2505.02279v1)

### Industry

- [NEAR AI Infrastructure with TEEs](https://medium.com/nearprotocol/building-next-gen-near-ai-infrastructure-with-tees-cdb19e144237)
- [Bounties Network StandardBounties](https://github.com/Bounties-Network/StandardBounties)
