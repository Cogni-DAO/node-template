# governance · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Last reviewed:** 2026-02-16
- **Status:** draft

## Purpose

Drizzle implementation of GovernanceStatusPort for system tenant governance visibility queries.

## Pointers

- [GovernanceStatusPort](../../../ports/governance-status.port.ts)
- [Governance Status API spec](../../../../docs/spec/governance-status-api.md)

## Boundaries

```json
{
  "layer": "adapters/server",
  "may_import": ["adapters/server", "ports", "shared", "types"],
  "must_not_import": ["app", "features", "core"]
}
```

## Public Surface

- **Exports:** DrizzleGovernanceStatusAdapter
- **Routes (if any):** none
- **CLI (if any):** none
- **Env/Config keys:** DATABASE_URL
- **Files considered API:** drizzle-governance-status.adapter.ts

## Responsibilities

- This directory **does**: Query schedules and ai_threads tables for system tenant governance data
- This directory **does not**: Contain business logic, handle authentication, or manage user-scoped data

## Usage

```bash
pnpm typecheck
```

## Standards

- All queries filter by COGNI_SYSTEM_PRINCIPAL_USER_ID (system tenant scope)
- Return Date objects, not ISO strings (port contract)
- RLS-compatible: uses owner_user_id filter

## Dependencies

- **Internal:** ports, shared/db, shared/constants
- **External:** drizzle-orm

## Change Protocol

- Update this file when **Exports** or **Env/Config** change
- Bump **Last reviewed** date
- Ensure boundary lint + contract tests pass

## Notes

- Created for governance dashboard (single caller) but properly abstracted via port interface
- Queries are bounded: LIMIT 1 for schedule, LIMIT 10 for recent runs
