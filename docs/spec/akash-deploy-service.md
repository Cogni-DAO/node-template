---
id: akash-deploy-service-spec
type: spec
title: Akash Deploy Service — MCP & Agent Crew Orchestration
status: draft
spec_state: draft
trust: draft
summary: On-demand deployment of MCP server + AI agent crews to Akash Network. Pure-library package for SDL generation and crew schemas, service-layer adapter for Akash network I/O, Cosmos wallet port for AKT funding, and LangGraph crew orchestrator.
read_when: Working on Akash deployments, MCP hosting, agent crew orchestration, or Cosmos wallet integration.
implements: proj.akash-crew-deploy
owner: derekg1729
created: 2026-03-26
verified:
tags: [infra, akash, mcp, agents, cosmos, deployment]
---

# Akash Deploy Service — MCP & Agent Crew Orchestration

## Context

The node-launch spec defines a `ClusterProvider` interface abstracting deployment targets. Today only `CherryK3sProvider` exists. This spec adds Akash Network as a deployment target — enabling on-demand deployment of AI agent + MCP server crews to the decentralized cloud.

A "crew" is a set of containers (MCP servers providing tools + AI agents consuming them) deployed as a single Akash deployment with shared internal networking.

## Goal

Build the infrastructure to deploy arbitrary compositions of MCP servers and AI agents as Akash deployments, managed by a LangGraph orchestrator agent that translates natural language crew descriptions into running infrastructure.

## Non-Goals

| Item                             | Reason                                                |
| -------------------------------- | ----------------------------------------------------- |
| Full ATOM bridge (EVM -> Cosmos) | Scaffold wallet adapter only; bridge is separate work |
| MCP server development           | Use existing registries (npm, smithery, GitHub)       |
| Custom agent runtime             | Use OpenClaw golden images                            |
| Multi-region federation          | Single Akash deployment per crew for now              |
| OAuth flow implementation        | Scaffold the seam; actual OAuth is per-MCP-server     |
| Live Akash network in v0         | Mock adapter for crawl; real adapter at P1            |

## Core Invariants

1. **PACKAGES_ARE_PURE**: Packages contain ports, schemas, pure functions, and domain adapters only. No subprocess execution, no process lifecycle, no env reads. CLI/network adapters live in services.

2. **GOLDEN_IMAGES**: MCP servers and agents deploy from pre-built, versioned container images. No build-on-deploy.

3. **SDL_IS_MANIFEST**: Akash SDL is the deployment manifest. Generated from crew config as a pure function (no I/O).

4. **COSMOS_WALLET_ISOLATION**: Cosmos/AKT wallet is a separate port from EVM operator wallet. No mixed-chain abstractions.

5. **CREW_IS_DEPLOYMENT**: One crew = one Akash deployment with multiple services sharing a network. Services communicate via internal DNS.

6. **REGISTRY_FIRST**: MCP servers resolve from existing registries. Built-in registry is a fallback; Smithery API is the target at P1.

7. **TOOLS_VIA_DI**: LangGraph crew orchestrator receives the deployer port via dependency injection. The graph package does not hard-import service-layer code.

## Design

### Component Map

```
packages/cosmos-wallet/           — Port + schemas + mnemonic adapter (pure, no network at import)
packages/akash-client/            — Port + schemas + SDL generator (pure) + MCP registry + mock adapter
services/akash-deployer/          — HTTP service + Akash CLI/SDK adapter (all network I/O here)
  src/adapters/akash-cli/         — CLI subprocess adapter (lives in service, NOT package)
packages/langgraph-graphs/        — crew-orchestrator graph (tools accept deployer port via DI)
infra/tofu/akash/sdl-templates/   — Reference SDL templates
infra/cd/base/akash-deployer/     — Kustomize base for the deployer service
```

### Boundary Rules

```
┌─────────────────────────────────────────────────────────┐
│  packages/akash-client  (PURE LIBRARY)                  │
│  ├── port/          AkashDeployPort interface + schemas  │
│  ├── sdl/           generateSdl() — pure function        │
│  ├── registry/      MCP server lookup — static data      │
│  └── adapters/mock/ MockAkashAdapter — in-memory          │
│                                                          │
│  NO: execFile, child_process, fetch, env reads           │
├──────────────────────────────────────────────────────────┤
│  services/akash-deployer  (RUNTIME SERVICE)              │
│  ├── adapters/      AkashCliAdapter — subprocess I/O     │
│  │                  AkashSdlProvider — ClusterProvider    │
│  ├── routes/        HTTP handlers                        │
│  ├── config/        Env loading, wallet wiring           │
│  └── main.ts        Server lifecycle                     │
│                                                          │
│  YES: execFile, env vars, network I/O, process signals   │
└──────────────────────────────────────────────────────────┘
```

### Crew Deployment Flow

```
User: "Deploy a crew with filesystem MCP, GitHub MCP, and a research agent"
  |
  v
Crew Orchestrator Graph (LangGraph)
  |-- 1. parseCrew: Extract MCP servers + agents from NL description
  |-- 2. resolveImages: Look up golden images from MCP registry
  |-- 3. collectAuth: Determine OAuth requirements, return auth prompts
  |-- 4. generateSdl: Build Akash SDL from resolved crew config
  |-- 5. fundDeployment: Ensure AKT balance via cosmos-wallet
  |-- 6. deploy: Submit SDL to Akash network via akash-client port
  |-- 7. waitForLease: Wait for provider bid acceptance
  |-- 8. verifyHealth: Poll service health endpoints
  |-- 9. returnEndpoints: Return crew access URLs
  v
Running crew on Akash with shared internal network
```

### SDL Structure (per crew)

```yaml
version: "2.0"
services:
  mcp-filesystem:
    image: ghcr.io/cogni-dao/mcp-golden/filesystem:latest
    expose:
      - port: 3100
        proto: tcp
        to: [{ service: agent-research }]
  mcp-github:
    image: ghcr.io/cogni-dao/mcp-golden/github:latest
    expose:
      - port: 3101
        proto: tcp
        to: [{ service: agent-research }]
    env:
      - GITHUB_TOKEN=<sealed>
  agent-research:
    image: ghcr.io/cogni-dao/openclaw:latest
    expose:
      - port: 8080
        proto: tcp
        to: [{ global: true }]
    env:
      - MCP_SERVERS=mcp-filesystem:3100,mcp-github:3101
      - SOUL_MD=<base64-encoded>
profiles:
  compute:
    mcp-filesystem:
      resources:
        { cpu: { units: 0.5 }, memory: { size: 512Mi }, storage: { size: 1Gi } }
    mcp-github:
      resources:
        { cpu: { units: 0.5 }, memory: { size: 512Mi }, storage: { size: 1Gi } }
    agent-research:
      resources:
        { cpu: { units: 1 }, memory: { size: 1Gi }, storage: { size: 2Gi } }
  placement:
    default:
      pricing:
        mcp-filesystem: { denom: uakt, amount: 100 }
        mcp-github: { denom: uakt, amount: 100 }
        agent-research: { denom: uakt, amount: 200 }
deployment:
  mcp-filesystem: { default: { count: 1 } }
  mcp-github: { default: { count: 1 } }
  agent-research: { default: { count: 1 } }
```

### Cosmos Wallet Port

```typescript
interface CosmosWalletPort {
  getAddress(): Promise<string>;
  getBalance(denom?: string): Promise<CosmosBalance>;
  sendTokens(
    recipient: string,
    amount: string,
    denom?: string
  ): Promise<CosmosTxResult>;
  fundDeployment(deploymentId: string, amount: string): Promise<CosmosTxResult>;
  disconnect(): Promise<void>;
}
```

Adapters:

- **DirectSecp256k1Adapter** — mnemonic-based, for dev/testing and automated DAO operations
- **KeplrBridgeAdapter** — browser-extension signing, scaffold only (P1)

No Privy support for Cosmos chains — standalone wallet module.

### Akash Deploy Port

```typescript
interface AkashDeployPort {
  /** Pure — no I/O */
  generateSdl(crew: CrewConfig): SdlOutput;

  /** Network I/O — implemented by service adapter */
  createDeployment(sdlYaml: string): Promise<DeploymentInfo>;
  listBids(deploymentId: string): Promise<Bid[]>;
  acceptBid(deploymentId: string, provider: string): Promise<DeploymentInfo>;
  sendManifest(deploymentId: string, sdlYaml: string): Promise<void>;
  getDeployment(deploymentId: string): Promise<DeploymentInfo>;
  closeDeployment(deploymentId: string): Promise<DeploymentInfo>;
  updateDeployment(
    deploymentId: string,
    sdlYaml: string
  ): Promise<DeploymentInfo>;
}
```

Port lives in `packages/akash-client`. MockAkashAdapter (in-memory) lives in the package. AkashCliAdapter (subprocess) lives in `services/akash-deployer/src/adapters/`.

### Golden Image Strategy

| Type                | Base Image                                  | Registry     | Config           |
| ------------------- | ------------------------------------------- | ------------ | ---------------- |
| MCP Server (npm)    | `node:22-alpine` + `npx @mcp/server-<name>` | GHCR golden/ | Env vars         |
| MCP Server (binary) | `alpine:3.20` + binary                      | GHCR golden/ | Env vars         |
| AI Agent (OpenClaw) | `ghcr.io/cogni-dao/openclaw:latest`         | GHCR         | SOUL.md + config |

Pre-built golden images for common MCP servers:

- `mcp-golden/filesystem` — @modelcontextprotocol/server-filesystem
- `mcp-golden/github` — @modelcontextprotocol/server-github
- `mcp-golden/postgres` — @modelcontextprotocol/server-postgres
- `mcp-golden/memory` — @modelcontextprotocol/server-memory
- `mcp-golden/fetch` — @modelcontextprotocol/server-fetch

### MCP Registry

Built-in static registry of well-known MCP servers with golden image mappings. Falls back to generic `npx` runner for unknown packages. P1 target: resolve from Smithery API at runtime.

```typescript
interface McpRegistryEntry {
  name: string;
  package: string;
  goldenImage: string;
  transport: "stdio" | "sse" | "streamable-http";
  defaultPort: number;
  requiredEnv: string[];
  oauthScopes: string[];
}
```

## Acceptance Checks

1. `packages/cosmos-wallet` builds, typechecks, exports CosmosWalletPort
2. `packages/akash-client` generates valid Akash SDL from crew config (unit tested)
3. `packages/akash-client` contains NO subprocess or network I/O (enforced by dep-cruiser)
4. `services/akash-deployer` starts, serves health endpoints, exposes deploy API
5. Crew orchestrator tools accept deployer via DI (no hard import of service code)
6. SDL templates are valid YAML (parseable)
7. GitOps manifests (Kustomize base + overlays + ArgoCD app) pass `pnpm check`
8. All new packages pass typecheck with `composite: true`

## Open Questions

1. **Akash JS SDK vs CLI**: Should the live adapter use `@akashnetwork/akashjs` or shell out to `akash` CLI? SDK is more portable but less documented. Evaluate at P1 start.
2. **MCP transport**: Most MCP servers use stdio. For Akash deployment, stdio requires a sidecar bridge to HTTP. Should we standardize on SSE/HTTP transport for deployed servers?
3. **Credential sealing**: Akash SDL env vars are visible to providers. How to seal secrets? Evaluate Akash's sealed secrets or inject via runtime config.

## Dependencies

- task.0149 (k3s + ArgoCD GitOps foundation)
- Golden MCP container images (built and pushed to GHCR)
- @cosmjs/stargate for Cosmos wallet operations
- Akash testnet account for P1

## Related

- [Node Launch Spec](./node-launch.md) — ClusterProvider interface (on feat/byo-ai-per-tenant)
- [Node Formation Spec](./node-formation.md) — DAO formation wizard
- [Future Akash Integration](../../infra/tofu/akash/FUTURE_AKASH_INTEGRATION.md) — Bridge roadmap
- [Akash Crew Deploy Project](../../work/projects/proj.akash-crew-deploy.md) — Roadmap
