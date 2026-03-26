---
id: akash-deploy-service-spec
type: spec
title: Akash Deploy Service — MCP & Agent Crew Orchestration
status: draft
spec_state: draft
trust: draft
summary: On-demand deployment of MCP server + AI agent crews to Akash Network. Implements AkashProvider for ClusterProvider interface. Includes Cosmos/AKT wallet adapter, SDL generation, crew orchestrator LangGraph, and golden image registry.
read_when: Working on Akash deployments, MCP hosting, agent crew orchestration, or Cosmos wallet integration.
implements:
owner: derekg1729
created: 2026-03-26
verified:
tags: [infra, akash, mcp, agents, cosmos, deployment]
---

# Akash Deploy Service — MCP & Agent Crew Orchestration

## Context

The node-launch spec defines a `ClusterProvider` interface abstracting deployment targets. Today only `CherryK3sProvider` exists. This spec implements `AkashSdlProvider` — enabling on-demand deployment of AI agent + MCP server crews to the Akash decentralized cloud.

The user experience target: speak to an AI agent, describe a crew of agents and MCP servers with a mission, authenticate OAuth for the MCP servers, and the system deploys everything to Akash funded by a single DAO node.

## Goal

Build the infrastructure to deploy arbitrary compositions of MCP servers and AI agents as Akash deployments, managed by a LangGraph orchestrator agent that translates natural language crew descriptions into running infrastructure.

## Non-Goals

| Item                             | Reason                                                |
| -------------------------------- | ----------------------------------------------------- |
| Full ATOM bridge (EVM -> Cosmos) | Scaffold wallet adapter only; bridge is separate work |
| MCP server development           | Use existing MCP registries (npmjs, smithery, GitHub) |
| Custom agent runtime             | Use OpenClaw golden images                            |
| Multi-region federation          | Single Akash deployment per crew for now              |
| OAuth flow implementation        | Scaffold the seam; actual OAuth is per-MCP-server     |

## Core Invariants

1. **PROVIDER_AGNOSTIC**: `AkashSdlProvider` implements `ClusterProvider` from node-launch spec. Same workflow, different provider.

2. **GOLDEN_IMAGES**: MCP servers and agents deploy from pre-built, versioned container images. No build-on-deploy.

3. **SDL_IS_MANIFEST**: Akash SDL is the deployment manifest. Generated from crew config, committed to GitOps repo, deployed via Akash CLI.

4. **COSMOS_WALLET_ISOLATION**: Cosmos/AKT wallet is a separate port from EVM operator wallet. No mixed-chain abstractions.

5. **CREW_IS_DEPLOYMENT**: One crew = one Akash deployment with multiple services sharing a network. Services communicate via internal DNS.

6. **REGISTRY_FIRST**: MCP servers resolve from existing registries (npm, smithery.ai, GitHub). No custom registry.

## Design

### Component Map

```
packages/cosmos-wallet/        — Cosmos SDK wallet port + adapter (AKT funding)
packages/akash-client/         — Akash deployment lifecycle (SDL gen, lease mgmt)
services/akash-deployer/       — HTTP service implementing AkashProvider
packages/langgraph-graphs/     — crew-orchestrator graph (new graph)
infra/tofu/akash/              — SDL templates, provider configs
infra/cd/base/akash-deployer/  — Kustomize base for the deployer service
```

### Crew Deployment Flow

```
User: "Deploy a crew with filesystem MCP, GitHub MCP, and a research agent"
  |
  v
Crew Orchestrator Graph (LangGraph)
  |-- 1. parseCrew: Extract MCP servers + agents from NL description
  |-- 2. resolveImages: Look up golden images from MCP registry + OpenClaw
  |-- 3. collectAuth: Determine OAuth requirements, return auth prompts
  |-- 4. generateSdl: Build Akash SDL from resolved crew config
  |-- 5. fundDeployment: Ensure AKT balance via cosmos-wallet
  |-- 6. deploy: Submit SDL to Akash network via akash-client
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

### Cosmos Wallet Adapter

```typescript
interface CosmosWalletPort {
  getAddress(): Promise<string>;
  getBalance(denom?: string): Promise<{ amount: string; denom: string }>;
  sendTokens(
    recipient: string,
    amount: string,
    denom?: string
  ): Promise<string>;
  fundDeployment(deploymentId: string, amount: string): Promise<string>;
}
```

Two adapter strategies:

1. **DirectSecp256k1Adapter** — for dev/testing, mnemonic-based
2. **KeplrBridgeAdapter** — for production, browser-extension signing (scaffold only)

No Privy support for Cosmos chains, so this is a standalone wallet module.

### AkashProvider (implements ClusterProvider)

```typescript
class AkashSdlProvider implements ClusterProvider {
  async ensureCluster(env: string): Promise<ClusterConnection> {
    // Akash = provider marketplace, no cluster to ensure
    // Return connection info for the Akash RPC endpoint
  }

  async createNamespace(conn: ClusterConnection, name: string): Promise<void> {
    // Akash = create deployment from SDL
    // name maps to deployment label
  }

  async applyManifests(conn: ClusterConnection, path: string): Promise<void> {
    // Read SDL from path, submit to Akash network
    // Wait for bid, accept lease
  }

  async createSecret(
    conn: ClusterConnection,
    ns: string,
    data: Record<string, string>
  ): Promise<void> {
    // Inject as env vars in SDL (sealed)
  }
}
```

### Golden Image Strategy

| Type                | Base Image                                  | Registry     | Config           |
| ------------------- | ------------------------------------------- | ------------ | ---------------- |
| MCP Server (npm)    | `node:22-alpine` + `npx @mcp/server-<name>` | GHCR golden/ | Env vars         |
| MCP Server (binary) | `alpine:3.20` + binary                      | GHCR golden/ | Env vars         |
| AI Agent (OpenClaw) | `ghcr.io/cogni-dao/openclaw:latest`         | GHCR         | SOUL.md + config |
| AI Agent (custom)   | `node:22-alpine` + agent code               | GHCR         | Env vars         |

Pre-built golden images for common MCP servers:

- `mcp-golden/filesystem` — @modelcontextprotocol/server-filesystem
- `mcp-golden/github` — @modelcontextprotocol/server-github
- `mcp-golden/postgres` — @modelcontextprotocol/server-postgres
- `mcp-golden/memory` — @modelcontextprotocol/server-memory
- `mcp-golden/fetch` — @modelcontextprotocol/server-fetch

### MCP Registry Resolution

```typescript
interface McpRegistryEntry {
  name: string;
  package: string; // npm package or GitHub repo
  transport: "stdio" | "sse" | "streamable-http";
  goldenImage?: string; // pre-built image tag
  defaultPort: number;
  requiredEnv: string[]; // env vars needed (e.g., GITHUB_TOKEN)
  oauthScopes?: string[]; // OAuth scopes if applicable
}
```

Built-in registry of ~20 well-known MCP servers. Falls back to `npx` generic runner for unknown packages.

## Acceptance Checks

1. `packages/cosmos-wallet` builds and exports CosmosWalletPort
2. `packages/akash-client` generates valid Akash SDL from crew config
3. `services/akash-deployer` starts, serves health endpoints, exposes deploy API
4. Crew orchestrator graph can parse NL crew descriptions into structured configs
5. SDL templates are valid (parseable by Akash CLI)
6. GitOps manifests (Kustomize base + ArgoCD app) are syntactically valid
7. All new packages pass typecheck

## Dependencies

- node-launch spec (ClusterProvider interface)
- task.0149 (k3s + ArgoCD GitOps foundation)
- Akash CLI or JS SDK for deployment submission
- @cosmjs/stargate for Cosmos wallet operations

## Related

- [Node Launch Spec](./node-launch.md) — ClusterProvider interface
- [Node Formation Spec](./node-formation.md) — DAO formation wizard
- [Future Akash Integration](../../infra/tofu/akash/FUTURE_AKASH_INTEGRATION.md) — Bridge roadmap
