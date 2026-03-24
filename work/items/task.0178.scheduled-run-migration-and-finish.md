---
id: task.0178
type: task
title: "Delete old scheduled run path, prune dead tables, observability + documentation finish"
status: needs_implement
priority: 0
rank: 1
estimate: 3
summary: "BLOCKER: GovernanceScheduledRunWorkflow missing from bundle crashes scheduler-worker on every heartbeat. Delete old workflow, prune schedule_runs table, clean internal API, add observability, update docs."
outcome: Zero old execution paths remain; all runs go through GraphRunWorkflow; dead tables pruned; observability traces unified runs; docs reflect as-built state
spec_refs:
  - spec.unified-graph-launch
assignees: []
project: proj.unified-graph-launch
blocked_by:
  - task.0177
created: 2026-03-13
updated: 2026-03-22
labels:
  - ai-graphs
  - scheduler
---

# Delete Old Scheduled Run Path + Observability + Documentation

## Context

**BLOCKER for staging→main release.** Preview scheduler-worker crashes on every heartbeat:

```
TypeError: Failed to initialize workflow of type 'GovernanceScheduledRunWorkflow':
no such function is exported by the workflow bundle
```

Pre-existing Temporal schedules still reference `GovernanceScheduledRunWorkflow` but the worker bundle only exports `GraphRunWorkflow`. No migration needed — zero real users, just delete and recreate schedules.

The old `schedule_runs` table (pre-`graph_runs`) may also still exist and should be pruned.

## Design

### Outcome

Scheduled runs (heartbeats) execute through the unified `GraphRunWorkflow` path. Scheduler-worker stops crashing. Dead code and deprecated aliases are removed.

### Approach

**Solution**: Delete old workflow file, remove deprecated type aliases, clean up Temporal schedule references. Internal API route (`POST /api/internal/graphs/{graphId}/runs`) stays — it's actively used by `GraphRunWorkflow`.

**Reuses**: Existing `GraphRunWorkflow` (already handles `system_scheduled` runKind). Existing governance sync endpoint already recreates schedules with the correct workflow type.

**Rejected**:

- _Re-export old workflow as alias_ — adds complexity to keep dead code alive. Zero users, just delete.
- _Migrate existing Temporal schedules in-place_ — unnecessary. Delete and let governance sync recreate them with `GraphRunWorkflow`.
- _Drop `execution_requests` table_ — still actively used for idempotency by both API and scheduled paths. Keep.

### Key findings from investigation

1. **Worker bundle**: `workflowsPath` points only to `graph-run.workflow.js` (line 75 of `worker.ts`). Old workflow was never re-bundled after task.0176.
2. **Schedule control adapter**: Already creates new schedules with `workflowType: "GraphRunWorkflow"` (line 131 of `schedule-control.adapter.ts`).
3. **Internal route**: `POST /api/internal/graphs/{graphId}/runs` is **still active** — called by `GraphRunWorkflow` via Temporal activity. Do NOT delete.
4. **`schedule_runs` table**: Already renamed to `graph_runs` via migration 0021. The table name in Postgres is `graph_runs`. Only deprecated aliases remain in code.
5. **Deprecated aliases** (6 total across scheduler-core, db-schema, db-client): `ScheduleRunRepository`, `DrizzleScheduleRunAdapter`, `SCHEDULE_RUN_STATUSES`, `ScheduleRun`, `ScheduleRunStatus`, `scheduleRuns`. All are `@deprecated` re-exports with zero runtime cost but they add confusion.

### Invariants

- [ ] ONE_RUN_EXECUTION_PATH: No reference to `GovernanceScheduledRunWorkflow` remains (spec: unified-graph-launch)
- [ ] SINGLE_RUN_LEDGER: Only `graph_runs` table referenced in non-migration code (spec: unified-graph-launch)
- [ ] INTERNAL_ROUTE_PRESERVED: `POST /api/internal/graphs/{graphId}/runs` remains (used by GraphRunWorkflow)
- [ ] SIMPLE_SOLUTION: Delete dead code, don't migrate running schedules
- [ ] ARCHITECTURE_ALIGNMENT: Follows established patterns (spec: architecture)

### Files

- **Delete**: `services/scheduler-worker/src/workflows/scheduled-run.workflow.ts` — dead workflow
- **Modify**: `packages/scheduler-core/src/index.ts` — remove deprecated re-exports
- **Modify**: `packages/scheduler-core/src/ports/schedule-run.port.ts` — remove `ScheduleRunRepository` alias
- **Modify**: `packages/scheduler-core/src/types.ts` — remove `SCHEDULE_RUN_STATUSES`, `ScheduleRun`, `ScheduleRunStatus` aliases
- **Modify**: `packages/db-schema/src/scheduling.ts` — remove `SCHEDULE_RUN_STATUSES`, `scheduleRuns` deprecated aliases
- **Modify**: `packages/db-client/src/adapters/drizzle-run.adapter.ts` — remove `DrizzleScheduleRunAdapter` alias
- **Modify**: `packages/db-client/src/index.ts` — remove `DrizzleScheduleRunAdapter` re-export
- **Modify**: `apps/web/src/adapters/server/index.ts` — remove `DrizzleScheduleRunAdapter` re-export
- **Modify**: `services/scheduler-worker/src/ports/index.ts` — remove `ScheduleRunRepository` re-export
- **Modify**: `docs/spec/unified-graph-launch.md` — update to as-built state
- **Test**: Existing tests should pass unchanged (aliases were never imported)

## Requirements

- Delete `GovernanceScheduledRunWorkflow` file and all references
- Remove all `@deprecated` aliases for old `schedule_runs` naming
- Delete orphaned Temporal schedules in preview (they reference the dead workflow type)
- Update spec docs to as-built state
- AGENTS.md files updated if surface area changed
- Internal route (`POST /api/internal/graphs/{graphId}/runs`) must NOT be deleted

## Allowed Changes

- `services/scheduler-worker/src/workflows/scheduled-run.workflow.ts` — delete entire file
- `packages/scheduler-core/src/` — remove deprecated aliases from index, ports, types
- `packages/db-schema/src/scheduling.ts` — remove deprecated aliases
- `packages/db-client/src/` — remove deprecated adapter alias from adapter and index
- `apps/web/src/adapters/server/index.ts` — remove deprecated re-export
- `services/scheduler-worker/src/ports/index.ts` — remove deprecated re-export
- `docs/spec/` — update specs to as-built
- `**/AGENTS.md` — update if public surface changed
- Tests

## Plan

- [ ] **Checkpoint 1: Delete old workflow**
  - Delete `scheduled-run.workflow.ts`
  - Verify no imports reference it (grep confirms: only self-references)
  - Validation: `pnpm check` passes, `pnpm test` passes

- [ ] **Checkpoint 2: Remove deprecated aliases**
  - Remove all 6 deprecated aliases across scheduler-core, db-schema, db-client, app adapters
  - Grep for any remaining imports of old names — fix if found
  - Validation: `pnpm check` passes, `pnpm packages:build` passes

- [ ] **Checkpoint 3: Delete orphaned Temporal schedules in preview**
  - Use governance sync endpoint or Temporal UI to delete schedules referencing `GovernanceScheduledRunWorkflow`
  - Recreate via UI (schedules page) with new workflow type (happens automatically)
  - Validation: scheduler-worker stops crashing in preview logs

- [ ] **Checkpoint 4: Docs**
  - Update `unified-graph-launch.md` spec to reflect as-built state
  - Update AGENTS.md files for any changed public surface
  - Validation: `pnpm check:docs` passes

## Validation

**Command:**

```bash
pnpm check
pnpm check:docs
pnpm test
```

**Expected:** All checks pass. Scheduled runs use unified workflow. Docs reflect reality.

## Review Checklist

- [ ] **Work Item:** task.0178 linked in PR body
- [ ] **Spec:** ONE_RUN_EXECUTION_PATH invariant upheld for scheduled path
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
