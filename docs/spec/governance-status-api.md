---
id: governance-status-api
type: spec
title: Governance Status API
status: draft
spec_state: draft
trust: draft
summary: User-facing governance transparency API showing system tenant credit balance, scheduled runs, and recent execution history
read_when: Building governance dashboards, system health monitoring, or DAO transparency features
implements: proj.system-tenant-governance
owner: derekg1729
created: 2026-02-16
verified: 2026-02-16
tags: [governance, api, transparency]
---

# Governance Status API

> User-facing API for DAO governance transparency — shows credit balance, upcoming runs, and recent activity

### Key References

|             |                                                                                       |                                    |
| ----------- | ------------------------------------------------------------------------------------- | ---------------------------------- |
| **Project** | [proj.system-tenant-governance](../../work/projects/proj.system-tenant-governance.md) | Roadmap and planning               |
| **Spec**    | [activity-metrics](./activity-metrics.md)                                             | Related: user activity dashboard   |
| **Spec**    | [governance-council](./governance-council.md)                                         | Runtime state model for governance |

## Goal

Enable DAO members to see governance system status through the website: financial health (credit balance), operational status (scheduled runs), and recent activity (execution history).

## Non-Goals

- Real-time streaming updates (polling is sufficient for MVP)
- Historical analytics / trend analysis (defer to future)
- Governance control/management APIs (this is read-only status)
- Internal ops monitoring / alerting (this is user-facing transparency)

## Design

### Architecture

Governance status follows strict hexagonal architecture with proper port abstraction:

```
┌─────────────────────────────────────────────────────────────────┐
│ /governance page (user-facing)                                   │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ GET /api/v1/governance/status (route)                            │
│ ────────────────────────────────────                             │
│ Contract: governance.status.v1.contract.ts                       │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ getGovernanceStatus (feature service)                            │
│ ────────────────────────────────────────                         │
│ Orchestrates: AccountService + GovernanceStatusPort              │
└────────────────────┬────────────────────────────────────────────┘
                     │
         ┌───────────┴───────────┐
         │                       │
         ▼                       ▼
┌─────────────────┐  ┌────────────────────────┐
│ AccountService  │  │ GovernanceStatusPort   │
│ (port)          │  │ (port)                 │
│                 │  │                        │
│ getBalance()    │  │ getScheduleStatus()    │
│                 │  │ getRecentRuns()        │
└─────────────────┘  └────────┬───────────────┘
                              │
                              ▼
                     ┌────────────────────────┐
                     │ DrizzleGovernanceStatus│
                     │ (adapter)              │
                     │                        │
                     │ Query schedules table  │
                     │ Query ai_threads table │
                     └────────────────────────┘
```

**Layering:**

- **Route** (app layer): Validates contract, calls feature service, returns JSON
- **Feature service** (features layer): Orchestrates ports (AccountService + GovernanceStatusPort)
- **Ports** (ports layer): Interface contracts for data access
- **Adapters** (adapters/server): Drizzle implementations of ports

**Why create a port for single caller?**

1. **Architecture compliance**: Features must never import adapters directly
2. **Testability**: Feature service can be unit tested with mocked ports
3. **Boundaries**: Clear separation between orchestration and data access
4. **Future-proof**: Easy to swap implementations without touching features

## Invariants

| Rule                   | Constraint                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| SYSTEM_TENANT_SCOPE    | All queries filter by `COGNI_SYSTEM_PRINCIPAL_USER_ID` — never accepts userId parameter                     |
| RLS_COMPATIBLE         | Queries use `owner_user_id` filter compatible with RLS policies (even though route has elevated privileges) |
| CONTRACT_FIRST         | API shape defined via Zod contract before implementation                                                    |
| BIGINT_SERIALIZATION   | Balance returned as string (BigInt cannot be JSON.stringify'd)                                              |
| AUTH_REQUIRED          | Endpoint requires authenticated user (public read for DAO transparency)                                     |
| NO_PAGINATION_MVP      | Recent runs limited to 10 (hard cap) — pagination deferred                                                  |
| HEXAGONAL_ARCHITECTURE | Feature service calls ports only; never imports adapters or database clients directly                       |
| FEATURE_SERVICE_LAYER  | Route delegates to feature service; route never queries database directly                                   |
| PORT_ABSTRACTION       | GovernanceStatusPort provides clean interface; adapter handles Drizzle queries                              |

### API Contract

```typescript
// src/contracts/governance.status.v1.contract.ts
export const governanceStatusOperation = {
  id: "governance.status.v1",
  input: z.object({}),
  output: z.object({
    systemCredits: z
      .string()
      .describe("System tenant balance (BigInt as string)"),
    nextRunAt: z
      .string()
      .datetime()
      .nullable()
      .describe("Next scheduled governance run (ISO 8601)"),
    recentRuns: z.array(
      z.object({
        id: z.string().describe("Thread state key"),
        title: z.string().nullable().describe("Run title from metadata"),
        startedAt: z.string().datetime(),
        lastActivity: z.string().datetime(),
      })
    ),
  }),
};
```

### Data Sources

| Field         | Port Method                                | Adapter Implementation                                                                            |
| ------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| systemCredits | `AccountService.getBalance()`              | Query `billing_accounts` table                                                                    |
| nextRunAt     | `GovernanceStatusPort.getScheduleStatus()` | `WHERE owner_user_id = SYSTEM_PRINCIPAL AND enabled = true ORDER BY next_run_at LIMIT 1`          |
| recentRuns    | `GovernanceStatusPort.getRecentRuns()`     | `WHERE owner_user_id = SYSTEM_PRINCIPAL AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 10` |

### Query Optimization

**Index usage:**

- `ai_threads_owner_updated_idx` on `(owner_user_id, updated_at)` — O(log n) lookup for recent runs
- `schedules` needs index on `(owner_user_id, enabled, next_run_at)` if not already present

**Performance:**

- All queries filter by constant system tenant ID
- LIMIT 10 on recent runs (bounded)
- Single next run query (LIMIT 1)

### Port Interface

```typescript
// src/ports/governance-status.port.ts

export interface GovernanceRun {
  id: string;
  title: string | null;
  startedAt: Date;
  lastActivity: Date;
}

export interface GovernanceStatusPort {
  /**
   * Get next scheduled governance run time for system tenant.
   * Returns null if no runs are scheduled.
   */
  getScheduleStatus(): Promise<Date | null>;

  /**
   * Get recent governance runs for system tenant.
   * Returns up to `limit` runs ordered by most recent first.
   */
  getRecentRuns(params: { limit: number }): Promise<GovernanceRun[]>;
}
```

### Future Extensions

When additional governance data is needed:

- Add methods to `GovernanceStatusPort` (e.g., `getRunDetails()`, `getRunMetrics()`)
- Adapter implementation grows but port interface stays focused
- Feature services remain decoupled from database schema

## File Pointers

| File                                                                  | Purpose                                     |
| --------------------------------------------------------------------- | ------------------------------------------- |
| `src/contracts/governance.status.v1.contract.ts`                      | Zod contract for status endpoint            |
| `src/ports/governance-status.port.ts`                                 | Port interface for governance queries       |
| `src/adapters/server/governance/drizzle-governance-status.adapter.ts` | Drizzle implementation of port              |
| `src/features/governance/services/get-governance-status.ts`           | Feature service (orchestrates ports)        |
| `src/app/api/v1/governance/status/route.ts`                           | Route handler (calls feature service)       |
| `src/app/(app)/governance/page.tsx`                                   | Server component (auth check)               |
| `src/app/(app)/governance/view.tsx`                                   | Client component with React Query polling   |
| `src/features/governance/hooks/useGovernanceStatus.ts`                | React Query hook (30s polling)              |
| `src/features/governance/AGENTS.md`                                   | Feature slice documentation                 |
| `src/shared/constants/system-tenant.ts`                               | System tenant constants (already exists)    |
| `packages/db-schema/src/ai-threads.ts`                                | ai_threads schema with RLS (already exists) |
| `packages/db-schema/src/scheduling.ts`                                | schedules schema (already exists)           |

## Open Questions

None (ready for implementation).

## Related

- [System Tenant Design](./system-tenant.md) — System tenant foundation
- [Activity Metrics](./activity-metrics.md) — User activity dashboard (similar pattern)
- [Governance Council](./governance-council.md) — Runtime state model
- [Thread Persistence](./thread-persistence.md) — ai_threads table schema
- [Scheduler](./scheduler.md) — schedules table schema
