---
id: governance-scheduling-spec
type: spec
title: Governance Schedule Sync
status: active
trust: draft
summary: Declarative governance schedules in repo-spec.yaml synced to Temporal at deploy time via idempotent CLI command.
read_when: Understanding how governance runs are scheduled, how repo-spec declares charters, or how the sync function works.
owner: derekg1729
created: 2026-02-14
verified: 2026-02-14
tags: [governance, scheduling, temporal]
---

# Governance Schedule Sync

> Declarative charter-scoped schedules in `.cogni/repo-spec.yaml` synced to Temporal at deploy time. Each schedule triggers an OpenClaw gateway run with a 1-word entrypoint.

## Goal

Enable governance runs by syncing declarative schedule definitions from repo-spec to Temporal. Repo-spec is source of truth; Temporal is derived state.

## Design

### Data Flow

```
.cogni/repo-spec.yaml          # declares schedules (versioned, DAO-auditable)
    ↓ pnpm governance:schedules:sync    # idempotent CLI, runs in deploy.sh
Temporal Schedules              # governance:community, governance:engineering, etc.
    ↓ cron fires
GovernanceScheduledRunWorkflow  # existing workflow in scheduler-worker
    ↓ executeGraphActivity
POST /api/internal/graphs/sandbox:openclaw/runs  { message: "COMMUNITY" }
    ↓
OpenClaw gateway                # activates charter-specific GOVERN skill
```

### Repo-Spec Schema

```yaml
governance:
  schedules:
    - charter: COMMUNITY # unique key
      cron: "0 */6 * * *" # 5-field cron
      timezone: UTC # IANA (default: UTC)
      entrypoint: COMMUNITY # 1-word trigger → OpenClaw gateway
```

- `governance` is optional with `default({ schedules: [] })` — existing deployments don't break.
- Validated by `governanceScheduleSchema` in `repoSpec.schema.ts`.
- Accessor: `getGovernanceConfig()` in `repoSpec.server.ts` (lazy-cached).

### Schedule IDs

Deterministic: `governance:{charter_lowercase}` (e.g., `governance:community`). Derived by `governanceScheduleId()`.

### Sync Function

`syncGovernanceSchedules(config, deps)` takes injectable `GovernanceScheduleSyncDeps`:

| Dependency                    | Purpose                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `ensureGovernanceGrant()`     | Idempotent grant creation for system tenant (raw SQL, serviceDb)   |
| `scheduleControl`             | `ScheduleControlPort` for Temporal CRUD                            |
| `listGovernanceScheduleIds()` | Temporal `client.schedule.list()` filtered by `governance:` prefix |

**Sync logic:**

1. Ensure governance execution grant exists for system tenant
2. For each schedule in config: try `createSchedule` → on conflict, resume if paused, else skip
3. Prune: for each `governance:*` schedule not in config → pause (never delete)

**Safety:** All schedules use `overlap=SKIP`, `catchupWindow=0`, `pauseOnFailure=true` (enforced by `ScheduleControlPort`).

### Grant Management

- No migration. Grant created on-demand by `ensureGovernanceGrant` in CLI wrapper.
- Uses raw SQL `INSERT INTO execution_grants ... ON CONFLICT DO NOTHING` with serviceDb (BYPASSRLS).
- `COGNI_SYSTEM_PRINCIPAL_USER_ID` is a deterministic UUID (`00000000-0000-4000-a000-000000000001`) — compatible with branded `UserId` type.
- Scope: `graph:execute:sandbox:openclaw`.

### Deploy Integration

```bash
# In deploy.sh, after migrations, before stack up:
pnpm governance:schedules:sync
```

Idempotent on every deploy. No GitOps loop needed.

## Non-Goals

- **No cron update detection**: If cron changes in repo-spec, existing schedule is skipped (not updated). Manual delete+recreate needed until `ScheduleControlPort` gets `updateSchedule`.
- **No heartbeat/monitoring**: This spec covers schedule creation only. Health monitoring is a separate concern.
- **No tenant-callable sync**: System-ops only, never exposed as API endpoint.
- **No migration**: Grant created on-demand, not via DB migration.

## Invariants

1. **REPO_SPEC_IS_SOURCE_OF_TRUTH**: `.cogni/repo-spec.yaml` declares what schedules should exist. Temporal is derived.
2. **PRUNE_IS_PAUSE**: Removed schedules are paused, never deleted (reversible).
3. **SYSTEM_OPS_ONLY**: Sync runs at deploy time via CLI, never callable by tenants.
4. **GRANT_ON_DEMAND**: Governance grant created idempotently by sync, not by migration.
5. **OVERLAP_SKIP_ALWAYS**: All governance schedules use `overlap=SKIP` (one run at a time).

## File Pointers

| File                                                          | Purpose                                            |
| ------------------------------------------------------------- | -------------------------------------------------- |
| `.cogni/repo-spec.yaml`                                       | Schedule declarations                              |
| `src/shared/config/repoSpec.schema.ts`                        | `governanceScheduleSchema`, `governanceSpecSchema` |
| `src/shared/config/repoSpec.server.ts`                        | `getGovernanceConfig()` accessor                   |
| `src/features/governance/services/syncGovernanceSchedules.ts` | Core sync logic                                    |
| `src/scripts/governance-schedules-sync.ts`                    | CLI wrapper (TODO)                                 |
| `platform/ci/scripts/deploy.sh`                               | Deploy integration (TODO)                          |

## Related

- [Scheduler Spec](scheduler.md) — Execution infrastructure, grants, workflows
- [Governance Council](governance-council.md) — Distributed GOVERN architecture
- [OpenClaw Sandbox](openclaw-sandbox-spec.md) — Gateway execution
