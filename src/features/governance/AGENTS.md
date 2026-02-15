# governance · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Last reviewed:** 2026-02-15
- **Status:** draft

## Purpose

Governance schedule sync — creates, resumes, and prunes Temporal schedules for DAO charter governance runs based on `.cogni/repo-spec.yaml` config.

## Pointers

- [Governance Scheduling Spec](../../../docs/spec/governance-scheduling.md)
- [Scheduler Spec](../../../docs/spec/scheduler.md)
- [Repo Spec Config](../../../.cogni/repo-spec.yaml)

## Boundaries

```json
{
  "layer": "features",
  "may_import": ["features", "ports", "core", "shared", "types"],
  "must_not_import": [
    "app",
    "adapters/server",
    "adapters/worker",
    "bootstrap",
    "contracts"
  ]
}
```

## Public Surface

- **Exports:** `syncGovernanceSchedules()`, `GovernanceScheduleSyncDeps`, `GovernanceScheduleSyncResult`, `governanceScheduleId()`
- **Routes:** none (system-ops only; triggered via internal ops endpoint)
- **CLI:** `pnpm governance:schedules:sync` (endpoint trigger helper)
- **Env/Config keys:** `.cogni/repo-spec.yaml` → `governance.schedules`
- **Files considered API:** `services/syncGovernanceSchedules.ts`

## Ports

- **Uses ports:** `ScheduleControlPort` (Temporal lifecycle), `ExecutionGrantUserPort.ensureGrant` (stable grant)
- **Implements ports:** none

## Responsibilities

- This directory **does**: Sync governance schedules from config to Temporal; pause removed schedules (PRUNE_IS_PAUSE)
- This directory **does not**: Execute workflows, manage tenant-facing schedule CRUD, access DB directly

## Usage

```bash
pnpm test tests/unit/features/governance/  # unit tests
pnpm governance:schedules:sync             # trigger internal route (app must be running)
```

## Standards

- Pure function with injected deps (`GovernanceScheduleSyncDeps`)
- Unit tests with mocked ports
- No direct adapter or DB imports

## Dependencies

- **Internal:** `@cogni/scheduler-core` (ports), `@/shared/config` (governance config)
- **External:** none

## Change Protocol

- Update this file when exports or dep interface changes
- Bump **Last reviewed** date
- Ensure `pnpm check` passes

## Notes

- Governance schedules are system-ops only; never exposed as tenant-facing API
- PRUNE_IS_PAUSE: removed charters get paused, never deleted
