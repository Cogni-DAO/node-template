---
id: task.0054
type: task
title: "Governance run foundation — repo-spec config + system tenant execution grant"
status: Todo
priority: 0
estimate: 2
summary: Seed governance config in repo-spec.yaml and a durable ExecutionGrant for cogni_system so governance runs can be scheduled.
outcome: Governance config loadable at startup, system tenant has a permanent wildcard execution grant, readyz validates both.
spec_refs:
  - spec.system-tenant
  - scheduler-spec
assignees: cogni-dev
credit:
project: proj.system-tenant-governance
branch:
pr:
reviewer:
created: 2026-02-14
updated: 2026-02-14
labels: [governance, system-tenant, scheduling]
external_refs:
  - docs/research/system-tenant-seeding-heartbeat-funding.md
---

# Governance Run Foundation — Repo-Spec Config + System Tenant Execution Grant

## Context

task.0046 seeded `cogni_system` billing account + revenue share. But nothing enables governance **runs** yet. The system tenant needs:

1. **Governance config** — heartbeat interval, balance thresholds, declared in `.cogni/repo-spec.yaml` (versioned, DAO-auditable)
2. **Execution grant** — durable authorization for scheduled governance runs (per `GRANT_NOT_SESSION`)

This task seeds both. The next task (governance heartbeat Temporal workflow) will consume them.

## Requirements

- `.cogni/repo-spec.yaml` has a `governance:` section with `heartbeat.interval_minutes`, `heartbeat.low_balance_threshold_credits`, and `system_tenant.id`
- `repoSpecSchema` (Zod) validates the governance section with sensible defaults (optional section — existing deployments don't break)
- `repoSpec.server.ts` exposes a `getGovernanceConfig()` accessor (lazy-cached, like `getPaymentConfig()`)
- Migration seeds an `execution_grants` row for `cogni_system_principal` / `cogni_system` with `scopes: ['graph:execute:*']`, no expiry (idempotent via `ON CONFLICT`)
- `SYSTEM_TENANT_GRANT_ID` constant in `src/shared/constants/system-tenant.ts` (well-known UUID matching migration)
- `/readyz` startup healthcheck verifies governance grant exists (extend `verifySystemTenant()` or add adjacent check)
- Unit tests: governance config schema validation (valid, missing optional, invalid values)
- Unit test: `getGovernanceConfig()` returns defaults when governance section omitted

## Allowed Changes

- `.cogni/repo-spec.yaml` — add `governance:` section
- `src/shared/config/repoSpec.schema.ts` — extend with governance schema
- `src/shared/config/repoSpec.server.ts` — add `getGovernanceConfig()`
- `src/shared/constants/system-tenant.ts` — add `SYSTEM_TENANT_GRANT_ID`
- `src/adapters/server/db/migrations/` — new seed migration for grant
- `src/adapters/server/db/migrations/meta/` — journal + snapshot
- `src/bootstrap/healthchecks.ts` — extend grant verification
- `src/app/(infra)/readyz/route.ts` — if wiring changes needed
- `tests/unit/shared/config/` — governance config tests
- `tests/_fixtures/` — if test fixtures need updates
- Doc headers on touched files

## Plan

- [ ] Add `governance:` section to `.cogni/repo-spec.yaml` with heartbeat config + system_tenant.id
- [ ] Extend `repoSpecSchema` with optional `governance` object (Zod `.optional().default()` so existing deployments don't break)
- [ ] Add `getGovernanceConfig()` to `repoSpec.server.ts` — lazy-cached accessor
- [ ] Add `SYSTEM_TENANT_GRANT_ID` constant (deterministic UUID) to `system-tenant.ts`
- [ ] Create migration: `INSERT INTO execution_grants` for `cogni_system` with `graph:execute:*` scope, no expiry, `ON CONFLICT DO NOTHING`
- [ ] Extend `verifySystemTenant()` (or add `verifyGovernanceGrant()`) to check grant exists at startup
- [ ] Write unit tests for governance config schema (valid, defaults, invalid)
- [ ] Write unit test for `getGovernanceConfig()` return shape
- [ ] Update doc headers on touched files
- [ ] `pnpm check` passes

## Validation

**Command:**

```bash
pnpm check
```

**Expected:** All checks pass (typecheck, lint, format, unit tests, contract tests, doc validation).

**Manual:**

```bash
pnpm dev:stack:test
# Verify: execution_grants table has cogni_system row
# Verify: /readyz returns 200 (governance grant check passes)
```

## Review Checklist

- [ ] **Work Item:** `task.0054` linked in PR body
- [ ] **Spec:** `GRANT_NOT_SESSION` and `SYSTEM_TENANT_STARTUP_CHECK` upheld
- [ ] **Tests:** governance config schema + accessor tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
