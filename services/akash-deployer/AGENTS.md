# akash-deployer · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

Standalone HTTP service that manages Akash Network deployments of MCP server + AI agent crews. Implements AkashProvider for the ClusterProvider interface.

## Pointers

- [Akash Deploy Service Spec](../../docs/spec/akash-deploy-service.md): Full architecture
- [Config](src/config/env.ts): All configuration via environment variables

## Boundaries

```json
{
  "layer": "services",
  "may_import": ["packages", "services"],
  "must_not_import": ["app", "features", "ports", "core", "adapters", "shared"]
}
```

## Public Surface

- **Exports:** none (standalone service)
- **Routes:** `/livez` [GET], `/readyz` [GET], `/api/v1/crews/deploy` [POST], `/api/v1/crews/preview` [POST], `/api/v1/crews/:id` [GET, DELETE], `/api/v1/mcp/registry` [GET]
- **Env/Config keys:** `PORT`, `AKASH_NODE`, `AKASH_CHAIN_ID`, `AKASH_KEY_NAME`, `COSMOS_MNEMONIC`, `INTERNAL_OPS_TOKEN`

## Responsibilities

- This directory **does**: Serve HTTP API for crew deployments, health endpoints, SDL preview, MCP registry listing
- This directory **does not**: Run agents, manage wallets directly, store state in a database

## Notes

- Currently uses `MockAkashAdapter` for dev/testing — swap to `AkashCliAdapter` when Akash CLI is available in container
- Auth via `INTERNAL_OPS_TOKEN` bearer header on `/api/*` endpoints
