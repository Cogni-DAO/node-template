# scheduler-worker · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Last reviewed:** 2026-01-19
- **Status:** draft

## Purpose

Graphile Worker task factories for scheduled graph execution. Provides pure task functions with dependency injection—no `src/` imports allowed.

## Pointers

- [SCHEDULER_SPEC.md](../../docs/SCHEDULER_SPEC.md)
- [PACKAGES_ARCHITECTURE.md](../../docs/PACKAGES_ARCHITECTURE.md)

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

- **Exports:**
  - `startSchedulerWorker(config)` — bootstrap worker with injected deps
  - `createExecuteScheduledRunTask(deps)` — factory for execute_scheduled_run task
  - `createReconcileSchedulesTask(deps)` — factory for reconcile_schedules task
  - `computeNextCronTime(cron, timezone)` — cron utility
  - `ExecuteRunDeps`, `ReconcileDeps`, `LoggerLike` — dependency interfaces
- **Routes:** none
- **CLI:** `pnpm scheduler:dev` (via src/scripts entry point)
- **Env/Config keys:** none (all config injected)
- **Files considered API:** src/index.ts

## Responsibilities

- This directory **does:** define Graphile Worker task factories, Zod payload schemas, cron utilities.
- This directory **does not:** import from `src/`, access database directly, contain business logic.

## Usage

```bash
# Build package
pnpm --filter @cogni/scheduler-worker build

# Run worker (via src/scripts entry point)
pnpm scheduler:dev
```

## Standards

- Zero `src/**` imports (enforced by dependency-cruiser)
- All dependencies injected via factory parameters
- Payloads validated with Zod `.parse()` at task entry (no `as` casts)
- Task factories return Graphile Worker `Task` type

## Dependencies

- **Internal:** none (isolation boundary)
- **External:** graphile-worker, cron-parser, zod

## Change Protocol

- Update this file when **Exports** change
- Bump **Last reviewed** date
- Run `pnpm arch:check` to verify no `src/` imports

## Notes

- Entry point lives in `src/scripts/run-scheduler-worker.ts` (can import `src/`)
- Worker package receives deps from entry point, never resolves them
- See SCHEDULER_SPEC.md for invariants (GRANT_SCOPES_CONSTRAIN_GRAPHS, PRODUCER_ENQUEUES_NEXT, etc.)
