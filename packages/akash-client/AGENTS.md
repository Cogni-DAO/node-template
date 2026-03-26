# akash-client · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

Akash Network deployment client. SDL generation from crew configs, deployment lifecycle, MCP server registry, and ClusterProvider implementation.

## Pointers

- [Akash Deploy Service Spec](../../docs/spec/akash-deploy-service.md): Full architecture
- [Node Launch Spec](../../docs/spec/node-launch.md): ClusterProvider interface this implements

## Boundaries

```json
{
  "layer": "packages",
  "may_import": ["packages"],
  "must_not_import": [
    "app",
    "features",
    "ports",
    "core",
    "adapters",
    "shared",
    "services"
  ]
}
```

## Public Surface

- **Exports:** `AkashDeployPort`, `AkashClusterProvider` (port interfaces), `CrewConfig`, `McpServerConfig`, `AgentConfig` (Zod schemas), `generateSdl()` (pure SDL generator), `resolveMcpServer()`, `MCP_REGISTRY` (MCP server resolution)
- **Subpath `./adapters/cli`:** `AkashCliAdapter`, `AkashSdlProvider`
- **Subpath `./adapters/mock`:** `MockAkashAdapter`
- **Env/Config keys:** `none`

## Responsibilities

- This directory **does**: Generate Akash SDL from crew configs, manage deployment lifecycle, resolve MCP servers from built-in registry
- This directory **does not**: Execute deployments directly (delegates to adapters), manage wallets, run agents

## Notes

- **Crew**: A set of MCP servers + agents deployed as one Akash deployment with shared networking
- **Golden Images**: Pre-built container images for 10 common MCP servers
- **Registry**: Built-in lookup table, falls back to generic `npx` runner for unknown packages
