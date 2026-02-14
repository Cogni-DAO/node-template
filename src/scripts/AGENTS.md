# scripts · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Last reviewed:** 2026-02-15
- **Status:** draft

## Purpose

CLI entry points for operational tasks. Each script is a thin wrapper — zero logic, zero wiring — that delegates to a job module in `src/bootstrap/jobs/`.

## Pointers

- [Bootstrap Jobs AGENTS.md](../bootstrap/jobs/AGENTS.md)

## Boundaries

```json
{
  "layer": "scripts",
  "may_import": ["scripts", "ports", "shared", "types"],
  "must_not_import": ["app", "features", "core", "adapters", "contracts"]
}
```

Note: dep-cruiser allows `scripts → bootstrap`. The AGENTS.md policy is more restrictive; actual imports go through bootstrap job modules.

## Public Surface

- **Exports:** none (entry points only)
- **Routes (if any):** none
- **CLI (if any):** `pnpm governance:schedules:sync`
- **Env/Config keys:** none
- **Files considered API:** none

## Responsibilities

- This directory **does**: Provide process entry points (exit codes, error logging)
- This directory **does not**: Contain logic, wiring, or business rules

## Usage

```bash
pnpm governance:schedules:sync
```

## Standards

- Scripts call a single job function, then `process.exit(0)` or `process.exit(1)`
- No imports beyond bootstrap layer

## Dependencies

- **Internal:** `@/bootstrap/jobs`
- **External:** none

## Change Protocol

- Update this file when adding new script entry points
- Bump **Last reviewed** date

## Notes

- Scripts run via `tsx` (plain Node, no Next.js) — `server-only` guard is bypassed by design
