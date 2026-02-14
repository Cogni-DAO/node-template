# config · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Last reviewed:** 2026-02-15
- **Status:** draft

## Purpose

Server-only configuration helpers sourced from versioned repo metadata (`.cogni/repo-spec.yaml`). Provides typed accessors for inbound payment configuration (USDC credits top-up) and governance schedule configuration. Canonical source for chainId + receiving_address (payments) and charter schedule definitions (governance). These settings must not rely on environment variables.

## Pointers

- [Root AGENTS.md](../../AGENTS.md)
- [.cogni/repo-spec.yaml](../../.cogni/repo-spec.yaml)

## Boundaries

```json
{
  "layer": "shared",
  "may_import": ["shared"],
  "must_not_import": [
    "app",
    "features",
    "ports",
    "core",
    "adapters/server",
    "adapters/worker",
    "adapters/cli",
    "mcp"
  ]
}
```

## Public Surface

- **Exports:** `getPaymentConfig()`, `InboundPaymentConfig`, `getGovernanceConfig()`, `GovernanceConfig`, `GovernanceSchedule` - server-only helpers reading repo-spec metadata
- **Exports (schema):** `repoSpecSchema`, `creditsTopupSpecSchema`, `governanceScheduleSchema`, `governanceSpecSchema` - Zod schemas and derived types
- **Routes/CLI:** none
- **Env/Config keys:** none (reads versioned files only)
- **Files considered API:** index.ts, repoSpec.server.ts, repoSpec.schema.ts

## Responsibilities

- This directory **does**: read repo-spec from `payments_in.credits_topup.*` and `governance.schedules` paths, validate payment config (chainId, receivingAddress, provider) and governance schedule config (charter, cron, entrypoint), expose typed helpers for server callers.
- This directory **does not**: access browser APIs, depend on frameworks, expose env overrides, or support legacy widget paths.

## Usage

- Server components/helpers: `import { getPaymentConfig, getGovernanceConfig } from "@/shared/config";`
- Client components: `import type { InboundPaymentConfig } from "@/shared/config";` (props only, no direct file access)

## Standards

- Helpers must read repo-spec from disk on the server only and cache parsed results.
- Schema-first validation: All repo-spec structures validated via Zod schemas at runtime; types derived from schemas.
- No env-based overrides for governance-managed addresses or chain configuration.
- Export through `index.ts` entry point only.

## Dependencies

- **Internal:** `@/shared/web3` (chain constants)
- **External:** Zod (schema validation), yaml parser, Node fs/path

## Change Protocol

- Update this file when adding/removing helpers or expanding public surface.
- Keep helpers server-only and cache parsed data to avoid repeated IO.
- Bump **Last reviewed** when materially changed.

## Notes

- Repo-spec changes require a server restart to refresh cached payment config.
- Reads from `payments_in.credits_topup.*` and `governance.schedules` paths — no fallback to legacy widget paths.
- Schema validates structure: EVM address format, non-empty provider; `allowed_chains`/`allowed_tokens` are informational metadata (not enforced).
- Chain alignment: `cogni_dao.chain_id` must match `CHAIN_ID` from `@/shared/web3/chain` or startup fails. See [Chain Config](../../../docs/spec/chain-config.md).
- Use `getPaymentConfig()` for DAO wallet only; use `CHAIN_ID`/`USDC_TOKEN_ADDRESS` from `@/shared/web3/chain` for network constants.
- Governance config defaults to empty schedules array if not present in repo-spec.
