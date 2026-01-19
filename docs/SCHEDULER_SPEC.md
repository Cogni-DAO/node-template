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

8. **RECONCILER_GUARANTEES_CHAIN**: Reconciler task runs on worker startup AND self-reschedules every 5 minutes via `add_job(run_at=now+5m)`. For each enabled schedule where `next_run_at IS NULL OR next_run_at < now()`, it computes the next future slot and enqueues with `job_key=scheduleId:slot`. The NULL check handles edge cases like re-enable after disable. This guarantees chain recovery after crashes without relying on PRODUCER_ENQUEUES_NEXT alone.

9. **GRANT_SCOPES_CONSTRAIN_GRAPHS**: Every `ExecutionGrant` specifies which `graphId`s it can execute via scopes. Worker task validates grant scope includes the schedule's `graphId` before calling `GraphExecutorPort.runGraph()`. Scope format: `graph:execute:{graphId}` or `graph:execute:*` for wildcard (requires explicit user consent).

10. **RUN_LEDGER_FOR_GOVERNANCE**: Every scheduled execution creates a `schedule_runs` record with status progression (pending→running→success/error). This execution ledger enables debugging, audit trails, and governance loops.

---

## Worker Architecture

### Phase 1: Entry Point in `src/` (Current)

The scheduler worker runs as a **separate Node.js process** but its entry point lives in `src/` to satisfy monorepo architecture rules (`packages/` cannot import from `src/`).

```
src/
└── scripts/
    └── run-scheduler-worker.ts    ← Entry point (CAN import from src/)
        ├── imports @/bootstrap/container
        ├── imports @/bootstrap/graph-executor.factory
        ├── imports @/shared/env, @/shared/observability
        └── calls task factories from @cogni/scheduler-worker

packages/scheduler-worker/
├── src/
│   ├── tasks/
│   │   ├── execute-run.ts         ← Pure task factory (NO src/ imports)
│   │   └── reconcile.ts           ← Pure task factory (NO src/ imports)
│   ├── schemas/
│   │   └── payloads.ts            ← Zod schemas for payloads
│   ├── utils/
│   │   └── cron.ts                ← Cron utilities
│   └── index.ts                   ← Exports task factories + utils
└── package.json
```

**Why this structure?**

- `packages/**` must not import from `src/**` (enforced by `pnpm arch:check`)
- Task factories use dependency injection—they receive ports/adapters, don't import them
- Entry script in `src/` resolves deps from bootstrap container, passes to task factories
- Worker process runs via `pnpm scheduler:dev` which executes `src/scripts/run-scheduler-worker.ts`

### Phase 2: Package Extraction (Future PR)

Once MVP is proven, extract shared code to packages for better modularity:

| Extract From                         | Extract To              | Contents            |
| ------------------------------------ | ----------------------- | ------------------- |
| `src/types/scheduling.ts`            | `@cogni/scheduler-core` | Types + Zod schemas |
| `src/ports/scheduling/*`             | `@cogni/scheduler-core` | Port interfaces     |
| `src/adapters/server/scheduling/*`   | `@cogni/db-client`      | Drizzle adapters    |
| `src/shared/db/schema.scheduling.ts` | `@cogni/db-client`      | DB schema           |
| `src/shared/observability`           | `@cogni/observability`  | Logger factory      |

After extraction:

- Both `src/` (Next.js) and `packages/scheduler-worker/` import from shared packages
- Worker entry point can move to `packages/scheduler-worker/src/worker.ts`
- Full architectural symmetry achieved

**Defer until:** MVP runs end-to-end and proves value.

---

## Implementation Checklist

### P0: MVP Critical — Schedules + Grants + Worker

#### Types & Schema

- [x] Define `ExecutionGrant`, `ScheduleSpec`, `ScheduleRun` types in `src/types/scheduling.ts`
- [x] Add `execution_grants` table (userId, billingAccountId, scopes, expiresAt, revokedAt)
- [x] Add `schedules` table (owner, graphId, input, cron, timezone, grantId, enabled, nextRunAt)
- [x] Add `schedule_runs` table (scheduleId, runId, scheduledFor, startedAt, completedAt, status)
- [x] Run migration: `pnpm drizzle-kit generate`

#### Ports

- [x] Create `JobQueuePort` (generic `enqueueJob(taskId, payload, runAt, jobKey, queueName)`)
- [x] Create `ExecutionGrantPort` (with `validateGrantForGraph`, `deleteGrant` for cleanup)
- [x] Create `ScheduleManagerPort`
- [x] Create `ScheduleRunRepository` (run ledger)

#### Adapters

- [x] Implement `DrizzleJobQueueAdapter` (encapsulates `add_job` SQL)
- [x] Implement `DrizzleExecutionGrantAdapter`
- [x] Implement `DrizzleScheduleManagerAdapter` (atomic grant+schedule+enqueue)
- [x] Implement `DrizzleScheduleRunAdapter`

#### Bootstrap & Routes

- [x] Wire ports in `bootstrap/container.ts`
- [x] Create contracts: `schedules.create.v1`, `schedules.list.v1`, `schedules.update.v1`, `schedules.delete.v1`
- [x] Create `/api/v1/schedules` routes (POST, GET)
- [x] Create `/api/v1/schedules/[scheduleId]` routes (PATCH, DELETE)

#### Worker Package

- [x] Create `packages/scheduler-worker/` with task factories
- [x] Implement `createExecuteScheduledRunTask` with Zod validation (v0: stub logs + marks complete)
- [x] Implement `createReconcileSchedulesTask`
- [x] Add Zod payload schemas (`ExecuteScheduledRunPayloadSchema`, etc.)
- [x] Add `pnpm scheduler:dev` script for local development
- [x] Verify `pnpm arch:check` passes (zero `packages/** → src/**` violations)

#### Graph Execution Endpoint (next PR)

- [ ] `POST /api/internal/graphs/{graphId}:run` — service-auth endpoint for worker to call
- [ ] Worker calls via HTTP with `executionGrantId`; endpoint resolves caller context, runs graph, returns `{runId, traceId, ok, errorCode?}`

#### Atomicity & Cleanup

- [ ] Ensure `createSchedule` is atomic: grant+schedule+enqueue in single transaction OR compensating `deleteGrant` on failure
- [ ] Remove `virtualKeyId` from `ExecutionGrant` (resolve at runtime via AccountService)

#### Chores

- [ ] Observability instrumentation [observability.md](../.agent/workflows/observability.md)
- [ ] Documentation updates [document.md](../.agent/workflows/document.md)
- [ ] (Phase 2) Remove `src/scripts/` layer and `.dependency-cruiser.cjs` scripts rule after worker moves to `services/scheduler-worker`
- [ ] (Phase 2) Remove `@cogni/scheduler-worker` from root `package.json` dependencies after worker becomes standalone service
- [ ] (Phase 2) Add `error_code` column to `schedule_runs` following ai-core pattern (`SCHEDULE_RUN_ERROR_CODES` enum, e.g., `grant_expired`, `grant_revoked`, `rate_limit`, `timeout`, `internal`)

### P1: Concurrency Policies + Runs API

- [ ] Expose `/api/v1/schedules/:id/runs` read-only endpoint
- [ ] Add `concurrencyPolicy` column (Allow, Forbid, Replace)
- [ ] Implement Replace policy (cancel previous, start new)

### P2: Advanced Scheduling (Do NOT Build Preemptively)

- [ ] Evaluate: Does user demand exist for backfill?
- [ ] If yes: Add `backfillLimit` column and catchup logic
- [ ] If yes: Add `startingDeadlineSeconds` for missed run tolerance
- [ ] **Do NOT build this preemptively**

---

## Test Infrastructure

### Current State (P0)

Stack tests for schedule CRUD are **skipped** because they require the `graphile_worker` schema to exist. The schema is created when the scheduler worker starts, not by Drizzle migrations.

| Test Type                                             | Status     | Notes                             |
| ----------------------------------------------------- | ---------- | --------------------------------- |
| Unit tests (`packages/scheduler-worker/tests/`)       | ✅ Pass    | Mocked deps, no DB                |
| Contract tests (`tests/contract/schedules.*.test.ts`) | ✅ Pass    | Schema validation only            |
| Stack tests (`tests/stack/scheduling/`)               | ⏭️ Skipped | Requires `graphile_worker` schema |

### V1 Improvement

Add Graphile Worker to test stack infrastructure:

```bash
# Option A: Schema-only (lightweight)
pnpm exec graphile-worker --schema-only --connection "$TEST_DATABASE_URL"

# Option B: Full worker (integration tests)
# Add to dev:stack:test alongside next dev
```

**Files to update:**

- `package.json` — Add `db:setup:test:worker` script
- `tests/stack/scheduling/schedules-crud.stack.test.ts` — Remove `.skip`

---

## File Pointers (P0 Scope)

| File                                                          | Purpose                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------- |
| `src/types/scheduling.ts`                                     | `ExecutionGrant`, `ScheduleSpec`, `ScheduleRun` types   |
| `src/shared/db/schema.scheduling.ts`                          | `execution_grants`, `schedules`, `schedule_runs` tables |
| `src/ports/scheduling/job-queue.port.ts`                      | `JobQueuePort` (generic `enqueueJob`)                   |
| `src/ports/scheduling/execution-grant.port.ts`                | `ExecutionGrantPort` + `validateGrantForGraph`          |
| `src/ports/scheduling/schedule-manager.port.ts`               | `ScheduleManagerPort` interface                         |
| `src/ports/scheduling/schedule-run.port.ts`                   | `ScheduleRunRepository` (run ledger)                    |
| `src/adapters/server/scheduling/drizzle-job-queue.adapter.ts` | `DrizzleJobQueueAdapter` (encapsulates `add_job` SQL)   |
| `src/adapters/server/scheduling/drizzle-grant.adapter.ts`     | `DrizzleExecutionGrantAdapter`                          |
| `src/adapters/server/scheduling/drizzle-schedule.adapter.ts`  | `DrizzleScheduleManagerAdapter`                         |
| `src/adapters/server/scheduling/drizzle-run.adapter.ts`       | `DrizzleScheduleRunAdapter`                             |
| `src/contracts/schedules.*.v1.contract.ts`                    | Schedule CRUD contracts (4 files)                       |
| `src/app/api/v1/schedules/route.ts`                           | POST (create), GET (list)                               |
| `src/app/api/v1/schedules/[scheduleId]/route.ts`              | PATCH (update), DELETE                                  |
| `src/bootstrap/container.ts`                                  | Wire all scheduling ports                               |
| `src/scripts/run-scheduler-worker.ts`                         | Worker entry point (wires deps, calls task factories)   |
| `packages/scheduler-worker/src/tasks/execute-run.ts`          | `createExecuteScheduledRunTask` factory                 |
| `packages/scheduler-worker/src/tasks/reconcile.ts`            | `createReconcileSchedulesTask` factory                  |
| `packages/scheduler-worker/src/schemas/payloads.ts`           | Zod schemas for task payloads                           |
| `packages/scheduler-worker/src/utils/cron.ts`                 | `computeNextCronTime` utility                           |

---

## Schema

### `execution_grants` table

| Column               | Type        | Constraints                   | Notes                                    |
| -------------------- | ----------- | ----------------------------- | ---------------------------------------- |
| `id`                 | uuid        | PK                            | Grant identity                           |
| `user_id`            | text        | NOT NULL, FK users            | Grant owner                              |
| `billing_account_id` | text        | NOT NULL, FK billing_accounts | Charge target                            |
| `scopes`             | text[]      | NOT NULL                      | e.g., `["graph:execute:langgraph:poet"]` |
| `expires_at`         | timestamptz | NULL                          | Optional expiration                      |
| `revoked_at`         | timestamptz | NULL                          | Soft revocation timestamp                |
| `created_at`         | timestamptz | NOT NULL, default now()       |                                          |

**Indexes:** `idx_grants_user_id`, `idx_grants_billing_account_id`

**Scope format:** `graph:execute:{graphId}` or `graph:execute:*` for wildcard.

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

**Indexes:** `idx_schedules_owner`, `idx_schedules_next_run` (for reconciler query), `idx_schedules_grant`

**Forbidden columns:** `session_id`, `oauth_token`, `api_key`, `secret` — Never store credentials

### `schedule_runs` table (P0)

| Column              | Type        | Constraints                 | Notes                              |
| ------------------- | ----------- | --------------------------- | ---------------------------------- |
| `id`                | uuid        | PK                          | Run record identity                |
| `schedule_id`       | uuid        | NOT NULL, FK schedules      | Parent schedule                    |
| `run_id`            | text        | NOT NULL                    | GraphExecutorPort runId            |
| `scheduled_for`     | timestamptz | NOT NULL                    | Intended execution time (job slot) |
| `started_at`        | timestamptz | NULL                        | Actual start time                  |
| `completed_at`      | timestamptz | NULL                        | Completion time                    |
| `status`            | text        | NOT NULL, default 'pending' | pending/running/success/error      |
| `attempt_count`     | integer     | NOT NULL, default 0         | Retry attempts (for future use)    |
| `langfuse_trace_id` | text        | NULL                        | Observability correlation          |
| `error_message`     | text        | NULL                        | Error details if failed            |

**Indexes:** `idx_runs_schedule`, `idx_runs_scheduled_for`, `idx_runs_run_id`

**Unique constraint:** `UNIQUE(schedule_id, scheduled_for)` prevents duplicate run records per slot

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

Port definitions live in `src/ports/scheduling/`. Future: move to `@cogni/scheduler-core`.

| Port                    | File                                            | Key Methods                                                                                 |
| ----------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `JobQueuePort`          | `src/ports/scheduling/job-queue.port.ts`        | `enqueueJob(taskId, payload, runAt, jobKey, queueName?)`                                    |
| `ExecutionGrantPort`    | `src/ports/scheduling/execution-grant.port.ts`  | `createGrant`, `validateGrantForGraph`, `deleteGrant`                                       |
| `ScheduleManagerPort`   | `src/ports/scheduling/schedule-manager.port.ts` | `createSchedule`, `listSchedules`, `updateSchedule`, `deleteSchedule`, `findStaleSchedules` |
| `ScheduleRunRepository` | `src/ports/scheduling/schedule-run.port.ts`     | `createRun`, `markRunStarted`, `markRunCompleted`                                           |

**Design notes:**

- `JobQueuePort.enqueueJob()` is generic (taskId-based), not graph-specific—enables future non-graph scheduled jobs
- `ExecutionGrantPort.deleteGrant()` exists for atomicity cleanup when schedule creation fails mid-transaction
- `ScheduleRunRepository` is separate from `ScheduleManagerPort` per single-responsibility (run ledger vs schedule CRUD)

---

## Grant Authorization

### Boundary Principle

**Worker knows resources, not scopes.** The scheduler-worker package receives `(grantId, graphId)` and delegates authorization to the adapter layer. Scope format (`graph:execute:{graphId}`) is owned exclusively by `ExecutionGrantPort` implementations.

### File Pointers

| Layer            | File                                                      | Responsibility                                                   |
| ---------------- | --------------------------------------------------------- | ---------------------------------------------------------------- |
| Worker task      | `packages/scheduler-worker/src/tasks/execute-run.ts`      | Calls `validateGrantForGraph(grantId, graphId)` before execution |
| Worker interface | `packages/scheduler-worker/src/worker.ts`                 | Declares `validateGrantForGraph` in `ExecuteRunDeps`             |
| Wiring           | `src/scripts/run-scheduler-worker.ts`                     | Pass-through to `executionGrantPort.validateGrantForGraph`       |
| Port             | `src/ports/scheduling/execution-grant.port.ts`            | Defines `validateGrantForGraph(grantId, graphId)` contract       |
| Adapter          | `src/adapters/server/scheduling/drizzle-grant.adapter.ts` | Owns scope format, checks `graph:execute:{graphId}` or wildcard  |
| Schema           | `src/shared/db/schema.scheduling.ts`                      | `scopes` column in `execution_grants` table                      |

### Invariants

1. **SCOPE_FORMAT_CENTRALIZED**: Only `DrizzleExecutionGrantAdapter` knows scope string format. Worker and wiring layers pass `graphId` only.
2. **VALIDATE_BEFORE_EXECUTE**: `execute-run.ts` must call `validateGrantForGraph` after loading schedule, before any execution logic.
3. **SKIP_ON_GRANT_FAILURE**: On validation failure, mark run as `skipped` with error message, enqueue next run, return early.
4. **NO_SCOPE_PARSING_IN_WORKER**: Worker package must never import or construct scope strings.

### Authorization Flow

```
execute-run.ts
  │
  ├─ 1. Load schedule (includes executionGrantId, graphId)
  │
  ├─ 2. deps.validateGrantForGraph(grantId, graphId)
  │     │
  │     └─ run-scheduler-worker.ts (pass-through)
  │         │
  │         └─ executionGrantPort.validateGrantForGraph(grantId, graphId)
  │             │
  │             └─ DrizzleExecutionGrantAdapter
  │                 ├─ Check grant exists, not expired, not revoked
  │                 └─ Check scopes includes "graph:execute:{graphId}" OR "graph:execute:*"
  │
  ├─ 3a. On success → proceed to execution
  │
  └─ 3b. On failure → markRunCompleted("skipped"), enqueue next, return
```

### Roadmap

| Phase            | Scope                                                                               |
| ---------------- | ----------------------------------------------------------------------------------- |
| **P0 (current)** | Single resource type (`graph:execute`), exact match or wildcard                     |
| **P1**           | Grant expiration enforcement, revocation propagation                                |
| **P2**           | Additional resource types via new port methods (e.g., `validateGrantForWorkflow`)   |
| **P3**           | Fine-grained scopes (e.g., `graph:execute:langgraph:*` for provider-level wildcard) |

---

## Worker Tasks

Task implementations use dependency injection via factory functions. Payloads are validated with Zod schemas at task entry.

| Task                    | Current Location                                     | Future Location                                                      |
| ----------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| `execute_scheduled_run` | `packages/scheduler-worker/src/tasks/execute-run.ts` | Same                                                                 |
| `reconcile_schedules`   | `packages/scheduler-worker/src/tasks/reconcile.ts`   | Same                                                                 |
| Zod payload schemas     | `packages/scheduler-worker/src/schemas/payloads.ts`  | `@cogni/scheduler-core`                                              |
| Worker entry point      | `src/scripts/run-scheduler-worker.ts`                | `packages/scheduler-worker/src/worker.ts` (after package extraction) |

**Key implementation details:**

- Tasks call `Schema.parse(payload)` before processing (no `as` casts)
- `virtualKeyId` resolved at runtime via `AccountService.getDefaultVirtualKeyForUser()`
- Stream fully drained before awaiting `result.final` (per GRAPH_EXECUTION.md)
- Errors thrown to trigger Graphile Worker retry semantics

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

**Last Updated**: 2026-01-19
**Status**: Draft (P0 in progress)
