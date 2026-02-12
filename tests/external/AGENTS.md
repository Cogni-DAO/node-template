# tests/external · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Last reviewed:** 2026-02-12
- **Status:** draft

## Purpose

Tests that hit real internet services or 3rd-party APIs. These require secrets and are **not** part of default CI. Run nightly or on-demand.

## Pointers

- [Component tests](../component/) — isolated testcontainers, no server
- [Stack tests](../stack/) — full HTTP + DB tests

## Boundaries

```json
{
  "layer": "tests",
  "may_import": ["adapters/server", "ports", "shared", "tests"],
  "must_not_import": ["core", "features", "app", "mcp"]
}
```

## Public Surface

- **Exports:** none
- **Routes:** none
- **CLI:** (not yet wired — will be `pnpm test:external`)
- **Env/Config keys:** requires real API keys / secrets
- **Files considered API:** none

## Responsibilities

- This directory **does:** test adapters against real external services (APIs, blockchains, 3rd-party providers)
- This directory **does not:** test local-infra adapters (use component/), test full stack (use stack/)

## Usage

```bash
# Not yet wired — placeholder directory
# pnpm test:external
```

## Standards

- Tests must be idempotent and safe to run repeatedly
- Use dedicated test accounts / API keys (never production credentials)
- Expect network latency; use generous timeouts

## Dependencies

- **Internal:** src/adapters, src/ports, src/shared
- **External:** vitest, real API keys / secrets

## Change Protocol

- Add tests here when real external adapter implementations exist
- Bump **Last reviewed** date

## Notes

- Placeholder directory. Move tests here once real external adapter tests exist.
- **NOT** in default CI pipeline (unit → component → system)
- Run as nightly / on-demand workflow with secrets injection
- Failures here do not block PRs
