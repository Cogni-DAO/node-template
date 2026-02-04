# db-client · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @cogni-dao
- **Last reviewed:** 2026-02-04
- **Status:** stable

## Purpose

Database client factory and Drizzle adapter implementations for scheduling domain ports. Provides portable database access for the scheduler-worker service without framework dependencies.

## Pointers

- [SCHEDULER_SPEC.md](../../docs/SCHEDULER_SPEC.md): Scheduling architecture and invariants
- [DATABASE_RLS_SPEC.md](../../docs/DATABASE_RLS_SPEC.md): RLS tenant isolation design
- [PACKAGES_ARCHITECTURE.md](../../docs/PACKAGES_ARCHITECTURE.md): Package isolation boundaries
- [scheduler-core](../scheduler-core): Port interfaces implemented by adapters

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

**External deps:** `drizzle-orm`, `postgres`, `type-fest`. Internal deps: `@cogni/db-schema`, `@cogni/scheduler-core`, `@cogni/ai-core`.

## Public Surface

- **Exports (root `@cogni/db-client`):**
  - `createAppDbClient(url)` — client factory for `app_user` role (RLS enforced)
  - `createDbClient(url)` — deprecated alias (backward compat)
  - `withTenantScope(db, actorId, fn)` — transaction wrapper setting RLS context
  - `setTenantContext(tx, actorId)` — sets RLS context in existing transaction
  - `UserActorId`, `ActorId`, `UserId` — branded types for RLS identity
  - `toUserId(raw)` — validate + brand a raw string as `UserId`
  - `userActor(userId)` — `UserId` → `UserActorId` for user-initiated ops
  - `Database`, `LoggerLike` — Drizzle client type and logger interface
  - `DrizzleScheduleManagerAdapter`, `DrizzleExecutionGrantAdapter`, `DrizzleExecutionRequestAdapter`, `DrizzleScheduleRunAdapter`
  - Re-exports from `@cogni/db-schema` (tables, types)
- **Exports (sub-path `@cogni/db-client/service`):**
  - `createServiceDbClient(url)` — client factory for `app_service` role (BYPASSRLS)
  - `SYSTEM_ACTOR` — deterministic UUID for system-initiated ops (scheduler, settlement)
  - `SystemActorId` — branded type for system actors. Physically gated: user-facing code cannot import this.
- **CLI:** none
- **Env/Config keys:** none (accepts DATABASE_URL via factory parameter)
- **Files considered API:** `index.ts` (root), `service.ts` (sub-path)

## Ports

- **Uses ports:** none
- **Implements ports:** `ScheduleManagerPort`, `ExecutionGrantPort`, `ExecutionRequestPort`, `ScheduleRunRepository`
- **Contracts:** Contract tests in `tests/contract/<port>.contract.ts`

## Responsibilities

- This directory **does**: Provide Drizzle-based adapter implementations for scheduling ports
- This directory **does not**: Access process.env, contain business logic, or depend on Next.js

## Usage

```bash
pnpm --filter @cogni/db-client typecheck
pnpm --filter @cogni/db-client build
```

## Standards

- Per FORBIDDEN: No `@/`, `src/`, `process.env`, or Next.js imports
- Per ALLOWED: Pure database operations via Drizzle ORM
- Adapters implement port interfaces from `@cogni/scheduler-core`

## Dependencies

- **Internal:** `@cogni/db-schema`, `@cogni/scheduler-core`, `@cogni/ai-core`
- **External:** `drizzle-orm`, `postgres`, `type-fest`

## Change Protocol

- Update this file when exports or port implementations change
- Bump **Last reviewed** date
- Ensure contract tests pass for implemented ports

## Notes

- Re-exports scheduling schema so consumers (scheduler-worker) get schema transitively
- All adapters accept a `Database` instance via constructor (dependency injection)
- `createServiceDbClient` is isolated in `./service` sub-path; root barrel does NOT re-export it
- `Database` type lives in root only — not exported from `./service`
