# tests/ports · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Last reviewed:** 2025-11-11
- **Status:** draft

## Purpose

Port behavior tests that verify implementations are swappable and conform to expected behavior.

## Pointers

- [Ports source](../../src/ports/)
- [Test harness](./harness/)

## Boundaries

```json
{
  "layer": "tests",
  "may_import": ["ports", "core"],
  "must_not_import": ["adapters/server", "adapters/worker", "features", "app"]
}
```

## Public Surface

- **Exports:** test functions for port validation
- **Routes:** none
- **CLI:** imported by integration tests
- **Env/Config keys:** none
- **Files considered API:** `*.port.spec.ts`

## Responsibilities

- This directory **does:** define expected behavior for port implementations
- This directory **does not:** test specific adapters or business logic

## Usage

```bash
pnpm test tests/ports
pnpm test tests/ports/ai.port.spec.ts
```

## Standards

- Every port must have a behavior test suite
- Adapters run these tests in integration tests
- Port tests map 1:1 to src/ports/\*\* interfaces

## Dependencies

- **Internal:** src/ports, src/core
- **External:** vitest

## Change Protocol

- Update port tests when port interfaces change
- Bump **Last reviewed** date
- Ensure all adapters pass updated test suites

## Notes

- Port behavior tests define the specification for implementations
- Keep tests independent of specific adapter implementations
