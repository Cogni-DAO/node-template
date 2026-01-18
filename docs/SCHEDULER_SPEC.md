# Scheduled Graph Execution Design

> [!CRITICAL]
> Scheduled runs execute via existing `GraphExecutorPort` using durable **ExecutionGrants** (not user sessions). Worker uses Graphile Worker's `add_job()` with `job_key` for idempotency—NOT crontab polling.

## Core Invariants

1. **SCHEDULES_NEVER_BYPASS_EXECUTOR**: All scheduled graph execution flows through `GraphExecutorPort.runGraph()`. Scheduling layer owns timing only—never direct LLM/provider calls.

2. **GRANT_NOT_SESSION**: Scheduled runs authenticate via durable `ExecutionGrant` (scoped, revocable, time-limited), never user sessions. Workers never hold `NextAuth` session state.

3. **BILLING_VIA_GRANT**: Every `ExecutionGrant` has a `billingAccountId`. `LlmCaller` derives `virtualKeyId` from billing account's default key. All existing billing/idempotency invariants (GRAPH_EXECUTION.md) apply unchanged.

4. **JOB_KEY_PER_SLOT**: Each scheduled run uses `job_key = scheduleId:scheduledFor` (ISO timestamp). This prevents duplicate execution if the same slot is enqueued twice (restart, retry, race).

5. **PRODUCER_ENQUEUES_NEXT**: After each execution (success or failure), the worker enqueues the next run via `add_job()` with computed `run_at`. No polling. No static crontab.

6. **QUEUE_SERIALIZES_SCHEDULE**: Each schedule uses `queue_name = scheduleId`. Graphile Worker processes one job per queue at a time, enforcing no-overlap without app-level checks. `job_key` handles slot deduplication; queue handles serialization.

7. **SKIP_MISSED_RUNS**: P0 does not backfill missed runs. Producer-chain scheduling means each run enqueues the next—if the chain breaks (worker down), only the next future slot is scheduled on recovery.

---

## Implementation Checklist

### P0: MVP Critical — Schedules + Grants + Worker

- [ ] Define `ExecutionGrant` type in `src/types/scheduling.ts`
- [ ] Create `ExecutionGrantPort` in `src/ports/execution-grant.port.ts`
- [ ] Create `ScheduleManagerPort` in `src/ports/schedule-manager.port.ts`
- [ ] Add `schedules` table (owner, graphId, input, cron, timezone, grantId, enabled, nextRunAt)
- [ ] Add `execution_grants` table (userId, billingAccountId, scopes, expiresAt, revokedAt)
- [ ] Implement `DrizzleScheduleManagerAdapter` in `src/adapters/server/scheduling/`
- [ ] Implement `DrizzleExecutionGrantAdapter` in `src/adapters/server/scheduling/`
- [ ] Create `/api/v1/schedules` CRUD routes (POST, GET, PATCH, DELETE)
- [ ] Wire ports in `bootstrap/container.ts`
- [ ] Create `packages/scheduler-worker/` with Graphile Worker task
- [ ] Implement `executeScheduledRun` task calling `GraphExecutorPort`
- [ ] Add `pnpm scheduler:dev` script for local development

#### Chores

- [ ] Observability instrumentation [observability.md](../.agent/workflows/observability.md)
- [ ] Documentation updates [document.md](../.agent/workflows/document.md)

### P1: Run History + Concurrency Policies

- [ ] Add `schedule_runs` table (scheduleId, runId, scheduledFor, startedAt, completedAt, status)
- [ ] Expose `/api/v1/schedules/:id/runs` read-only endpoint
- [ ] Add `concurrencyPolicy` column (Allow, Forbid, Replace)
- [ ] Implement Replace policy (cancel previous, start new)

### P2: Advanced Scheduling (Do NOT Build Preemptively)

- [ ] Evaluate: Does user demand exist for backfill?
- [ ] If yes: Add `backfillLimit` column and catchup logic
- [ ] If yes: Add `startingDeadlineSeconds` for missed run tolerance
- [ ] **Do NOT build this preemptively**

---

## File Pointers (P0 Scope)

| File                                                 | Change                                           |
| ---------------------------------------------------- | ------------------------------------------------ |
| `src/types/scheduling.ts`                            | New: `ExecutionGrant`, `ScheduleSpec` types      |
| `src/ports/execution-grant.port.ts`                  | New: `ExecutionGrantPort` interface              |
| `src/ports/schedule-manager.port.ts`                 | New: `ScheduleManagerPort` interface             |
| `src/shared/db/schema.scheduling.ts`                 | New: `schedules`, `execution_grants` tables      |
| `src/adapters/server/scheduling/drizzle.adapter.ts`  | New: `DrizzleScheduleManagerAdapter`             |
| `src/adapters/server/scheduling/grant.adapter.ts`    | New: `DrizzleExecutionGrantAdapter`              |
| `src/app/api/v1/schedules/route.ts`                  | New: POST (create), GET (list)                   |
| `src/app/api/v1/schedules/[scheduleId]/route.ts`     | New: PATCH (update), DELETE                      |
| `src/contracts/schedules.*.v1.contract.ts`           | New: Schedule CRUD contracts                     |
| `src/bootstrap/container.ts`                         | Wire `ScheduleManagerPort`, `ExecutionGrantPort` |
| `packages/scheduler-worker/`                         | New: Graphile Worker package                     |
| `packages/scheduler-worker/src/tasks/execute-run.ts` | New: `executeScheduledRun` task                  |

---

## Schema

### `execution_grants` table

| Column               | Type        | Constraints                   | Notes                     |
| -------------------- | ----------- | ----------------------------- | ------------------------- |
| `id`                 | uuid        | PK                            | Grant identity            |
| `user_id`            | text        | NOT NULL, FK users            | Grant owner               |
| `billing_account_id` | text        | NOT NULL, FK billing_accounts | Charge target             |
| `scopes`             | text[]      | NOT NULL                      | e.g., `["graph:execute"]` |
| `expires_at`         | timestamptz | NULL                          | Optional expiration       |
| `revoked_at`         | timestamptz | NULL                          | Soft revocation timestamp |
| `created_at`         | timestamptz | NOT NULL, default now()       |                           |

**Indexes:** `idx_grants_user_id`, `idx_grants_billing_account_id`

### `schedules` table

| Column               | Type        | Constraints                   | Notes                         |
| -------------------- | ----------- | ----------------------------- | ----------------------------- |
| `id`                 | uuid        | PK                            | Schedule identity             |
| `owner_user_id`      | text        | NOT NULL, FK users            | Schedule owner                |
| `execution_grant_id` | uuid        | NOT NULL, FK execution_grants | Linked grant for billing      |
| `graph_id`           | text        | NOT NULL                      | e.g., `langgraph:poet`        |
| `input`              | jsonb       | NOT NULL                      | Graph input payload           |
| `cron`               | text        | NOT NULL                      | 5-field cron expression       |
| `timezone`           | text        | NOT NULL                      | IANA timezone (e.g., `UTC`)   |
| `enabled`            | boolean     | NOT NULL, default true        | Pause/resume toggle           |
| `next_run_at`        | timestamptz | NULL                          | Next scheduled execution time |
| `last_run_at`        | timestamptz | NULL                          | Last execution start time     |
| `created_at`         | timestamptz | NOT NULL, default now()       |                               |
| `updated_at`         | timestamptz | NOT NULL, default now()       |                               |

**Indexes:** `idx_schedules_owner`, `idx_schedules_next_run` (for bootstrap query)

**Forbidden columns:**

- `session_id`, `oauth_token`, `api_key`, `secret` — Never store credentials

---

## Design Decisions

### 1. Graphile Worker Pattern (NOT Crontab)

**Why not Graphile crontab?** [Graphile crontab](https://worker.graphile.org/docs/cron) is for **static** deploy-time schedules, not dynamic user-created ones. Per docs: "Tasks are by default read from a crontab file next to the tasks/ folder."

**Correct pattern:** Use `graphile_worker.add_job()` with:

- `queue_name` — Serializes all jobs for a schedule (no overlap)
- `run_at` — Next execution timestamp
- `job_key` — Idempotency key `scheduleId:scheduledFor` (slot deduplication)

```sql
SELECT graphile_worker.add_job(
  'execute_scheduled_run',
  json_build_object('scheduleId', schedule_id, 'scheduledFor', next_run_at),
  queue_name := schedule_id::text,           -- serialization
  run_at := next_run_at,
  job_key := schedule_id || ':' || next_run_at::text,  -- slot dedupe
  job_key_mode := 'replace'
);
```

---

### 2. Execution Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│ CONTROL PLANE (API Routes)                                          │
│ ─────────────────────────────────                                   │
│ 1. User creates schedule via POST /api/v1/schedules                 │
│ 2. Validate cron expression + IANA timezone                         │
│ 3. Create ExecutionGrant for billing delegation                     │
│ 4. Compute next_run_at from cron + timezone                         │
│ 5. Insert schedule row + enqueue first job via add_job()            │
│ Result: Job queued for next_run_at with job_key                     │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (Graphile Worker executes at run_at)
┌─────────────────────────────────────────────────────────────────────┐
│ WORKER TASK: execute_scheduled_run                                  │
│ ───────────────────────────────────                                 │
│ 1. Load schedule from DB by scheduleId                              │
│ 2. Check enabled=true, else skip                                    │
│ 3. Validate grant not expired/revoked                               │
│ 4. Build LlmCaller from grant + billing account                     │
│ 5. Call GraphExecutorPort.runGraph()                                │
│ 6. Update last_run_at, compute next_run_at                          │
│ 7. Enqueue next job via add_job() (PRODUCER_ENQUEUES_NEXT)          │
│ (No overlap check needed—queue_name serializes per schedule)        │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ EXISTING PIPELINE (unchanged)                                       │
│ ─────────────────────────                                           │
│ - AggregatingGraphExecutor routes by graphId                        │
│ - Provider executes graph, emits AiEvents                           │
│ - Billing subscriber commits usage via existing idempotency         │
│ - All GRAPH_EXECUTION.md invariants preserved                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

### 3. Idempotency Model

| Layer           | Key                                     | Prevents                     |
| --------------- | --------------------------------------- | ---------------------------- |
| **Job enqueue** | `job_key = scheduleId:scheduledFor`     | Duplicate jobs for same slot |
| **Graph run**   | `runId` (UUID per execution)            | —                            |
| **Billing**     | `source_reference = runId/attempt/unit` | Duplicate charges (existing) |

**Why `scheduledFor` in job_key?** Without it, re-enabling a schedule could enqueue the same slot twice. ISO timestamp ensures each cron slot has exactly one job.

**Why not `runId` in job_key?** `runId` is generated at execution time, not enqueue time. Job deduplication must happen at enqueue.

---

### 4. Concurrency Policy (P0: Queue Serialization)

**Implementation:** `queue_name = scheduleId` ensures Graphile Worker processes one job per schedule at a time. No app-level overlap checks needed.

| Mechanism      | Purpose                                     |
| -------------- | ------------------------------------------- |
| `queue_name`   | Serializes execution—no concurrent runs     |
| `job_key`      | Deduplicates slots—no duplicate enqueues    |
| `job_key_mode` | `replace` allows rescheduling unlocked jobs |

P1 may add explicit `concurrencyPolicy` column for Allow/Replace semantics.

---

### 5. Missed Runs + Bootstrap Recovery

**P0 behavior:** Skip missed runs. Producer-chain scheduling means each run enqueues the next. If the chain breaks (worker restart, crash), recovery re-seeds the chain.

**Bootstrap recovery (on worker start):**

```sql
-- Find schedules with stale next_run_at (chain broken)
SELECT id, cron, timezone FROM schedules
WHERE enabled = true AND next_run_at < now();
```

For each:

1. Compute next **future** slot from cron + timezone
2. Enqueue exactly one job with `job_key = scheduleId:nextSlot`
3. Update `next_run_at` in DB

**Why no backfill in P0?**

- Backfill risks billing explosion (N missed runs × cost)
- Requires user consent for catch-up semantics
- Complex to implement correctly (overlapping backfill runs)

---

### 6. Billing Context Resolution

Worker builds `LlmCaller` from grant + billing account. Grant stores `billingAccountId`; `virtualKeyId` is derived from billing account's default key via `AccountService`. See [ACCOUNTS_DESIGN.md](ACCOUNTS_DESIGN.md) for canonical resolution.

---

## Port Interfaces

### ExecutionGrantPort

```typescript
export interface ExecutionGrant {
  readonly id: string;
  readonly userId: string;
  readonly billingAccountId: string;
  readonly scopes: readonly string[];
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
}

export interface ExecutionGrantPort {
  createGrant(input: {
    userId: string;
    billingAccountId: string;
    scopes: readonly string[];
    expiresAt?: Date;
  }): Promise<ExecutionGrant>;

  validateGrant(grantId: string): Promise<ExecutionGrant>;
  // Throws GrantExpiredError or GrantRevokedError

  revokeGrant(grantId: string): Promise<void>;
}
```

### ScheduleManagerPort

```typescript
export interface ScheduleSpec {
  readonly id: string;
  readonly ownerUserId: string;
  readonly executionGrantId: string;
  readonly graphId: string;
  readonly input: unknown;
  readonly cron: string;
  readonly timezone: string;
  readonly enabled: boolean;
  readonly nextRunAt: Date | null;
  readonly lastRunAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ScheduleManagerPort {
  createSchedule(
    callerUserId: string,
    input: { graphId: string; input: unknown; cron: string; timezone: string }
  ): Promise<ScheduleSpec>;

  listSchedules(callerUserId: string): Promise<readonly ScheduleSpec[]>;

  updateSchedule(
    callerUserId: string,
    scheduleId: string,
    patch: Partial<{
      input: unknown;
      cron: string;
      timezone: string;
      enabled: boolean;
    }>
  ): Promise<ScheduleSpec>;

  deleteSchedule(callerUserId: string, scheduleId: string): Promise<void>;
}
```

---

## Worker Task (Pseudo-code)

```typescript
// packages/scheduler-worker/src/tasks/execute-scheduled-run.ts
import { type Task } from "graphile-worker";

interface Payload {
  scheduleId: string;
  scheduledFor: string; // ISO timestamp
}

export const executeScheduledRun: Task = async (payload, helpers) => {
  const { scheduleId, scheduledFor } = payload as Payload;

  // 1. Load schedule
  const schedule = await scheduleRepo.findById(scheduleId);
  if (!schedule || !schedule.enabled) {
    helpers.logger.info("Schedule disabled or deleted, skipping");
    return;
  }

  // 2. Validate grant
  const grant = await grantPort.validateGrant(schedule.executionGrantId);

  // 3. Build caller (virtualKeyId via AccountService)
  const caller = await buildCallerFromGrant(grant);

  // 4. Execute graph
  const runId = crypto.randomUUID();
  await scheduleRepo.markRunStarted(scheduleId, scheduledFor);

  try {
    const result = graphExecutor.runGraph({
      runId,
      ingressRequestId: runId,
      graphId: schedule.graphId,
      messages: schedule.input.messages ?? [],
      model: schedule.input.model ?? "default",
      caller,
    });
    for await (const _event of result.stream) {
      /* drain */
    }
    await result.final;
    await scheduleRepo.markRunCompleted(scheduleId, scheduledFor, "success");
  } catch (error) {
    await scheduleRepo.markRunCompleted(scheduleId, scheduledFor, "error");
    throw error; // Graphile Worker handles retry
  }

  // 5. Enqueue next run (PRODUCER_ENQUEUES_NEXT)
  await enqueueNextRun(schedule, helpers);
};

async function enqueueNextRun(schedule: ScheduleSpec, helpers: Helpers) {
  const nextRunAt = computeNextCronTime(schedule.cron, schedule.timezone);
  await helpers.addJob(
    "execute_scheduled_run",
    { scheduleId: schedule.id, scheduledFor: nextRunAt.toISOString() },
    {
      queueName: schedule.id, // serialization (no overlap)
      runAt: nextRunAt,
      jobKey: `${schedule.id}:${nextRunAt.toISOString()}`, // slot dedupe
      jobKeyMode: "replace",
    }
  );
  await scheduleRepo.updateNextRunAt(schedule.id, nextRunAt);
}
```

---

## Anti-Patterns (Explicit)

| Anti-Pattern                            | Why Forbidden                                             |
| --------------------------------------- | --------------------------------------------------------- |
| Use Graphile crontab for user schedules | Crontab is static/deploy-time; user schedules are dynamic |
| Poll `schedules` table for due jobs     | Polling is inefficient; use `add_job()` with `run_at`     |
| App-level overlap checks                | Use `queue_name` for serialization; Graphile handles it   |
| Reuse NextAuth sessions in workers      | Sessions expire; workers are long-lived                   |
| Backfill without user consent           | Risk of billing explosion; requires explicit opt-in       |
| Generate `runId` at enqueue time        | `runId` is execution identity; generate at run start      |

---

## Related Documents

- [GRAPH_EXECUTION.md](GRAPH_EXECUTION.md) — Execution invariants, billing idempotency
- [ACCOUNTS_DESIGN.md](ACCOUNTS_DESIGN.md) — Billing account lifecycle, virtualKeyId
- [ARCHITECTURE.md](ARCHITECTURE.md) — Hexagonal port/adapter pattern

---

## Sources

- [Graphile Worker Cron Docs](https://worker.graphile.org/docs/cron)
- [Graphile Worker Job Key Docs](https://worker.graphile.org/docs/job-key)
- [Graphile Worker add_job Docs](https://worker.graphile.org/docs/sql-add-job)
- [Kubernetes CronJob Concurrency Policy](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/)
- [pg-boss Scheduling](https://logsnag.com/blog/deep-dive-into-background-jobs-with-pg-boss-and-typescript)

---

**Last Updated**: 2026-01-14
**Status**: Draft
