---
id: spike.0162
type: spike
title: "Research Akash crypto payment bridge: HostingPort abstraction + Base USDC → AKT swap → escrow funding"
status: needs_research
priority: 1
rank: 20
estimate: 2
summary: "Validate the cross-chain pipeline for funding Akash deployments from the operator wallet (Base USDC → AKT via Squid Router → IBC → Akash escrow), and design a HostingPort abstraction that decouples deployment lifecycle from chain-specific bridging."
outcome: "HostingPort interface defined. Cross-chain swap costs, latency, and reliability documented. Programmatic Akash deployment creation + escrow deposit validated. Architecture recommendation for Temporal workflow orchestration."
spec_refs:
  - operator-wallet
assignees:
  - cogni-dev
credit:
project: proj.ai-operator-wallet
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-13
updated: 2026-03-13
labels: [wallet, web3, akash, hosting, spike]
external_refs:
---

# Research: Akash Crypto Payment Bridge

> Spike to validate cross-chain payment pipeline and design a `HostingPort` abstraction for crypto-native web hosting providers.

## Context

The operator wallet (proj.ai-operator-wallet) currently handles outbound payments on Base (OpenRouter top-ups via Coinbase Commerce). Akash deployment hosting requires funding escrow in AKT on the Akash (Cosmos) chain. We need a cross-chain bridge: Base USDC → AKT → Akash escrow.

**Why a port/adapter:** Akash is migrating off Cosmos (target late 2026). A `HostingPort` abstraction lets us swap the bridge adapter when the migration completes — or support other crypto-native hosting providers (Spheron, Flux) — without touching domain logic.

**Why AKT swap:** Akash charges ~20% take rate on USDC payments vs ~4% on AKT. At $100/mo hosting, that's $16/mo savings. Swap cost via Squid Router (~0.1-0.3%) is negligible compared to the 16% delta.

## Question

1. Can we programmatically bridge Base USDC → AKT on Akash chain with acceptable cost and latency?
2. Can we programmatically create Akash deployments and fund escrow without the Akash Console UI?
3. What does the `HostingPort` interface look like — clean enough to survive the Akash chain migration?
4. Should the multi-step pipeline (swap → bridge → deposit) be a Temporal workflow?

## Sub-Experiments

### Experiment 1: Squid Router SDK — Base USDC → AKT on Osmosis/Akash

**Goal:** Validate cross-chain swap path, measure cost and latency.

1. Use Squid Router SDK to quote Base USDC → AKT
   - Check supported routes: Base → Osmosis (Axelar bridge) → AKT
   - Alternative: Base → Osmosis via Squid → swap USDC→AKT on Osmosis DEX → IBC to Akash
2. Execute a small swap ($5-10 USDC → AKT)
3. Measure: swap fee %, bridge latency, slippage, gas cost on Base side
4. Document: does AKT land on Osmosis or directly on Akash? Is an IBC transfer needed?

**Key unknowns:**

- Does Squid Router support Base → Akash chain directly, or do we need a two-hop (Base → Osmosis → Akash IBC)?
- What's the end-to-end latency? (Bridge: 2-15 min? IBC: 30s?)
- Minimum viable swap amount?

### Experiment 2: Programmatic Akash deployment + escrow deposit

**Goal:** Validate we can create deployments and fund escrow without Akash Console.

1. Use AkashJS SDK (`@akashnetwork/akashjs`) or Akash CLI to:
   - Create a deployment from SDL
   - Query bids from providers
   - Accept a bid / create a lease
   - Deposit AKT into deployment escrow
2. Alternatively, test the Akash Console API (if it has a programmatic interface)
3. Measure: gas costs on Akash chain for deployment lifecycle operations
4. Document: wallet requirements (Cosmos wallet? Can Privy sign Cosmos txs?)

**Key unknowns:**

- Does AkashJS support all deployment lifecycle operations programmatically?
- Can a Privy-managed wallet sign Cosmos transactions, or do we need a separate Akash wallet?
- Is the Akash Console API (console.akash.network) available for programmatic use?
- What's the managed wallet situation — AEP-63 (Akash managed wallets)?

### Experiment 3: HostingPort interface design

**Goal:** Define port interface that survives Akash chain migration.

1. Review current `OperatorWalletPort` pattern (typed intents, named methods, no raw signing)
2. Draft `HostingPort` interface covering deployment lifecycle:
   - `createDeployment(intent)` — SDL + budget → deployment ID
   - `fundEscrow(intent)` — deployment ID + amount → tx hash
   - `closeDeployment(id)` — reclaim remaining escrow
   - `getEscrowBalance(id)` — current balance query
3. Evaluate whether swap/bridge belongs inside the adapter or as a separate port
4. Consider: does `OperatorWalletPort` need a new method, or is `HostingPort` fully separate?

**Design questions:**

- Should the swap step be a separate `SwapPort` (reusable for other cross-chain payments)?
- Does the Akash adapter internally use `OperatorWalletPort` for the Base-side signing?
- How does the adapter handle the Cosmos-side wallet (separate key? derived? managed?)

### Experiment 4: Temporal workflow feasibility

**Goal:** Determine if the multi-step pipeline needs Temporal orchestration.

1. Map the full pipeline as a state machine:
   - `SWAP_PENDING → SWAP_CONFIRMED → IBC_PENDING → IBC_CONFIRMED → ESCROW_FUNDED`
2. Identify failure modes: bridge timeout, IBC relay failure, Akash tx failure
3. Assess: is this similar enough to the OpenRouter top-up state machine (`CHARGE_PENDING → TX_BROADCAST → CONFIRMED`) to reuse that pattern, or is Temporal's retry/timeout model needed?
4. If Temporal: sketch the workflow + activity boundaries

**Key unknowns:**

- Can each step be made idempotent?
- What's the retry semantics for a stuck IBC relay?
- Do we need Temporal, or is a simple DB-backed state machine sufficient (like the OpenRouter top-up)?

## Acceptance Criteria

- [ ] Squid Router quote obtained for Base USDC → AKT (fee %, route, latency estimate)
- [ ] Small swap executed ($5-10) and AKT received on Osmosis or Akash — path documented
- [ ] Akash deployment created programmatically (or documented why not possible yet)
- [ ] Escrow deposit executed programmatically (or documented alternative)
- [ ] Cosmos wallet strategy documented (Privy compatibility, or separate wallet needed)
- [ ] `HostingPort` interface drafted with typed intents
- [ ] Pipeline state machine documented (steps, failure modes, retry semantics)
- [ ] Temporal vs DB-backed state machine recommendation made
- [ ] Findings written back to project (proj.ai-operator-wallet) and relevant specs

## Validation

**Command:**

```bash
# No automated tests — this is a research spike with manual experiments
# Validation is the acceptance criteria checklist above
```

**Expected:** All acceptance criteria checked, findings documented in research output and written back to project/specs.

## Prerequisites

- Operator wallet with USDC + ETH on Base mainnet (~$15 USDC + ~$5 ETH for gas)
- Akash wallet with small AKT balance for deployment testing (~10 AKT)
- Squid Router SDK (`@0xsplits/squid-sdk` or `@0xsquid/sdk`)
- AkashJS SDK (`@akashnetwork/akashjs`)

## Budget

~$30 total: $10-15 for swap testing (USDC → AKT + gas), $10-15 for Akash deployment escrow testing, ~$5 ETH for gas across experiments.
