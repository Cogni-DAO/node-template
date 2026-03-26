---
id: proj.akash-crew-deploy
type: project
primary_charter:
title: "Akash Crew Deploy — MCP + Agent Crews on Decentralized Cloud"
state: Active
priority: 2
estimate: 5
summary: "Deploy compositions of MCP servers and AI agents as crews to the Akash decentralized cloud network, funded by DAO nodes via Cosmos/AKT wallet."
outcome: "A user speaks to an AI agent, describes a crew of agents and MCP servers with a mission, authenticates OAuth for the MCP servers, and the system deploys everything to Akash funded by a single DAO node."
assignees: [derekg1729]
created: 2026-03-26
updated: 2026-03-26
labels: [infra, akash, mcp, agents, cosmos]
---

# Akash Crew Deploy — MCP + Agent Crews on Decentralized Cloud

## Goal

Enable on-demand deployment of AI agent + MCP server crews to the Akash decentralized cloud network. A crew is a set of containers (MCP servers providing tools + AI agents consuming them) deployed as a single Akash deployment with shared internal networking. The system resolves MCP servers from existing registries, generates Akash SDL, funds the deployment via a Cosmos/AKT wallet, and manages the deployment lifecycle — all orchestrated by a LangGraph agent that accepts natural language crew descriptions.

## Roadmap

### Crawl (P0)

**Goal:** Deployable SDL generation + HTTP API with mock backend. Prove the data model, SDL structure, and crew composition work end-to-end against a mock adapter. No live Akash network required.

| Deliverable                                                                              | Status      | Est | Work Item |
| ---------------------------------------------------------------------------------------- | ----------- | --- | --------- |
| `@cogni/akash-client` package — port, schemas, SDL generator, MCP registry, mock adapter | In Progress | 3   | —         |
| `services/akash-deployer` — HTTP service with deploy/preview/registry APIs               | In Progress | 2   | —         |
| Crew orchestrator LangGraph graph — NL to crew plan to deploy                            | In Progress | 2   | —         |
| GitOps manifests — Kustomize base + overlays + ArgoCD app                                | In Progress | 1   | —         |
| `@cogni/cosmos-wallet` package — port + direct mnemonic adapter                          | In Progress | 1   | —         |
| Akash deploy service spec (design contract)                                              | Done        | 1   | —         |

### Walk (P1)

**Goal:** Live Akash deployment. Replace mock adapter with real Akash network interaction. Wire Cosmos wallet funding. Build golden images for top MCP servers.

| Deliverable                                                                       | Status      | Est | Work Item            |
| --------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Evaluate `@akashnetwork/akashjs` SDK vs CLI adapter                               | Not Started | 1   | (create at P1 start) |
| Live Akash adapter — deploy, bid, lease, manifest on testnet                      | Not Started | 3   | (create at P1 start) |
| Wire cosmos-wallet `fundDeployment` into crew deploy flow                         | Not Started | 2   | (create at P1 start) |
| Build + publish 5 golden MCP images (filesystem, github, postgres, memory, fetch) | Not Started | 2   | (create at P1 start) |
| OAuth credential collection flow for MCP servers                                  | Not Started | 3   | (create at P1 start) |
| Keplr browser wallet adapter (scaffold → working)                                 | Not Started | 2   | (create at P1 start) |

### Run (P2+)

**Goal:** Full vision — conversational crew management, mainnet deployment, ATOM bridge, multi-crew orchestration.

| Deliverable                                                             | Status      | Est | Work Item            |
| ----------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Akash mainnet deployment with stable payments (axlUSDC)                 | Not Started | 3   | (create at P2 start) |
| EVM → Cosmos bridge for DAO treasury funding (Squid Router)             | Not Started | 5   | (create at P2 start) |
| Crew monitoring dashboard — status, logs, cost tracking                 | Not Started | 3   | (create at P2 start) |
| Multi-crew orchestration — deploy N crews with shared mission           | Not Started | 3   | (create at P2 start) |
| Dynamic MCP registry — resolve from Smithery API at runtime             | Not Started | 2   | (create at P2 start) |
| Crew update/scaling — add/remove MCP servers and agents to running crew | Not Started | 3   | (create at P2 start) |

## Constraints

- Akash CLI or JS SDK must be available in the deployer container — no build-on-deploy
- Cosmos wallet is standalone (Privy doesn't support Cosmos chains)
- MCP servers deploy from pre-built golden images only — no arbitrary container builds in v0
- One crew = one Akash deployment — no cross-deployment networking in v0
- Graph package must not hard-depend on deployment infra — tools receive deployer via DI
- CLI/subprocess adapters live in services, not packages (packages are pure libraries)

## Dependencies

- [ ] k3s + ArgoCD GitOps foundation (task.0149)
- [ ] Golden MCP server container images built and pushed to GHCR
- [ ] Akash testnet account with AKT balance for testing
- [ ] `@akashnetwork/akashjs` SDK evaluation (or confirmed CLI-only approach)

## As-Built Specs

- [Akash Deploy Service Spec](../../docs/spec/akash-deploy-service.md) — draft, needs revision per design review

## Design Notes

**Review finding (2026-03-26): CLI adapter boundary violation.** The `AkashCliAdapter` uses `execFile` (subprocess I/O) but lives in `packages/akash-client/`. Per packages-architecture rules, packages are pure libraries with no process lifecycle. The CLI adapter should move to `services/akash-deployer/src/adapters/`. The package keeps only: port interface, schemas, SDL generator (pure), mock adapter, and MCP registry.

**Review finding: langgraph-graphs coupling.** `@cogni/langgraph-graphs` depends on `@cogni/akash-client` for crew orchestrator tools. This couples the graph package to deployment infra. Options: (a) extract crew orchestrator to its own package, (b) move tool registry imports behind DI, or (c) accept the coupling for v0 and extract later. Decision: accept for v0 crawl, extract at P1.

**Review finding: OSS alternatives.** `@akashnetwork/akashjs` is the official Akash JS SDK and should be evaluated before committing to CLI subprocess approach. Smithery.ai API exists for MCP server discovery — hardcoded registry will drift. Evaluate both at P1 start.

**Review finding: AkashClusterProvider diverges from ClusterProvider.** The node-launch spec defines `ClusterProvider` with `createNamespace(conn, name): Promise<void>`. Our `AkashClusterProvider` adds a `crew` parameter and changes return type. Must either extend properly or document why the interface differs.
