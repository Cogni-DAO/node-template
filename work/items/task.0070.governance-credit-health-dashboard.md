---
id: task.0070
type: task
title: DAO governance status page — user-facing transparency
status: Todo
priority: 0
estimate: 1
summary: Single page showing system tenant credit balance, next governance run time, and recent run history for DAO transparency
outcome: Users can see DAO governance financial status (credits), upcoming runs (next scheduled), and recent activity (last 10 runs)
spec_refs: openclaw-govern-distributed
assignees: []
credit:
project: proj.system-tenant-governance
branch:
pr:
reviewer:
created: 2026-02-16
updated: 2026-02-16
labels: [governance, ui, observability]
external_refs:
---

# DAO governance status page — user-facing transparency

## Context

**User Goal:** DAO members want to see governance system status through the website - basic financials (credit balance), deployment health (next run timing), and run history.

**NOT an ops monitoring tool** — this is user-facing transparency, not incident prevention. Absolute MVP.

**Research:** [governance-visibility-dashboard.md](../../docs/research/governance-visibility-dashboard.md)

## Outcome

Users visiting `/governance` see:

1. System tenant credit balance (how much runway the DAO has)
2. Next governance run time (when the AI council runs next)
3. Recent run history (last 10 governance executions)

## Design

### Approach

**Solution**: One page (`/governance`) + one API endpoint (`/api/v1/governance/status`) that queries existing tables.

**Reuses**:

- `ai_threads` table (governance runs already persisted here with system tenant ownership)
- `schedules` table (has next_run_at for governance schedules)
- `AccountService` port (balance queries)
- React Query polling pattern (from `/credits` page)
- shadcn/ui Card components

**Rejected**:

- ❌ **New ports/adapters/services** — unnecessary for simple read operations
- ❌ **Runway calculations with burn rate** — over-engineered, defer to later
- ❌ **Health color coding (🟢/🟡/🔴)** — premature, just show the number
- ❌ **Failed runs filtering** — `ai_threads` has full history, show recent only
- ❌ **Separate endpoints per concern** — one status endpoint is simpler

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] SYSTEM_TENANT_QUERIES: All queries filter by `COGNI_SYSTEM_PRINCIPAL_USER_ID` (spec: system-tenant)
- [ ] RLS_SAFE: Use proper RLS context when querying ai_threads (spec: architecture)
- [ ] CONTRACT_FIRST: Define Zod contract for status endpoint (spec: architecture)
- [ ] SIMPLE_SOLUTION: Leverages existing tables/ports, no new infrastructure
- [ ] ARCHITECTURE_ALIGNMENT: Server component + React Query polling pattern (spec: architecture)

### Files

**Create:**

- `src/contracts/governance.status.v1.contract.ts` — Status endpoint contract (balance, nextRunAt, recentRuns[])
- `src/app/api/v1/governance/status/route.ts` — Query ai_threads + schedules + balance
- `src/app/(app)/governance/page.tsx` — Server component (auth check)
- `src/app/(app)/governance/view.tsx` — Client component with React Query polling
- `src/features/governance/hooks/useGovernanceStatus.ts` — React Query hook (10s polling)

**Modify:**

- None (purely additive)

**Test:**

- Manual: Navigate to `/governance`, verify data displays
- E2E: Load page, verify status endpoint returns expected shape

## Plan

### 1. Define Contract (10 min)

```typescript
// src/contracts/governance.status.v1.contract.ts
export const governanceStatusOperation = {
  input: z.object({}),
  output: z.object({
    systemCredits: z.string().describe("Balance as string (BigInt serialized)"),
    nextRunAt: z
      .string()
      .datetime()
      .nullable()
      .describe("Next scheduled governance run"),
    recentRuns: z.array(
      z.object({
        id: z.string(),
        title: z.string().nullable(),
        startedAt: z.string().datetime(),
        lastActivity: z.string().datetime(),
        // Optional: graphId from metadata if structured
      })
    ),
  }),
};
```

### 2. Implement API Route (30 min)

```typescript
// src/app/api/v1/governance/status/route.ts
import {
  COGNI_SYSTEM_BILLING_ACCOUNT_ID,
  COGNI_SYSTEM_PRINCIPAL_USER_ID,
} from "@/shared/constants/system-tenant";
import { toUserId } from "@cogni/ids";

export const GET = wrapRouteHandlerWithLogging(
  { routeId: "governance.status", auth: { mode: "required", getSessionUser } },
  async (ctx, _request, sessionUser) => {
    const container = getContainer();

    // 1. System credit balance (reuse AccountService)
    const accountService = container.accountsForUser(
      toUserId(COGNI_SYSTEM_PRINCIPAL_USER_ID)
    );
    const balance = await accountService.getBalance(
      COGNI_SYSTEM_BILLING_ACCOUNT_ID
    );

    // 2. Next governance run (query schedules)
    const db = container.db;
    const governanceSchedules = await db.query.schedules.findMany({
      where: and(
        eq(schedules.ownerUserId, COGNI_SYSTEM_PRINCIPAL_USER_ID),
        eq(schedules.enabled, true),
        isNotNull(schedules.nextRunAt)
      ),
      orderBy: asc(schedules.nextRunAt),
      limit: 1,
    });

    // 3. Recent runs (query ai_threads with system tenant RLS)
    const threads = await db.query.aiThreads.findMany({
      where: and(
        eq(aiThreads.ownerUserId, COGNI_SYSTEM_PRINCIPAL_USER_ID),
        isNull(aiThreads.deletedAt) // Soft delete filter
      ),
      orderBy: desc(aiThreads.updatedAt),
      limit: 10,
    });

    return NextResponse.json(
      governanceStatusOperation.output.parse({
        systemCredits: balance.toString(), // BigInt → string
        nextRunAt: governanceSchedules[0]?.nextRunAt?.toISOString() ?? null,
        recentRuns: threads.map((t) => ({
          id: t.stateKey,
          title: t.metadata?.title ?? null,
          startedAt: t.createdAt.toISOString(),
          lastActivity: t.updatedAt.toISOString(),
        })),
      })
    );
  }
);
```

### 3. Create Page (20 min)

```typescript
// src/app/(app)/governance/page.tsx
export default async function GovernancePage() {
  const user = await getServerSessionUser();
  if (!user) redirect("/");

  return <GovernanceView />;
}
```

```typescript
// src/app/(app)/governance/view.tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components";
import { useGovernanceStatus } from "@/features/governance/hooks/useGovernanceStatus";

export function GovernanceView() {
  const { data, isLoading } = useGovernanceStatus();

  if (isLoading) return <div>Loading...</div>;
  if (!data) return <div>Failed to load governance status</div>;

  return (
    <div className="container mx-auto py-8 space-y-6">
      <h1 className="text-3xl font-bold">DAO Governance Status</h1>

      <Card>
        <CardHeader><CardTitle>Credit Balance</CardTitle></CardHeader>
        <CardContent>
          <div className="text-2xl font-mono">{data.systemCredits} credits</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Next Run</CardTitle></CardHeader>
        <CardContent>
          {data.nextRunAt ? (
            <div>Scheduled: {new Date(data.nextRunAt).toLocaleString()}</div>
          ) : (
            <div>No runs scheduled</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent Runs</CardTitle></CardHeader>
        <CardContent>
          {data.recentRuns.map(run => (
            <div key={run.id} className="border-b py-2 last:border-0">
              <div className="font-medium">{run.title || run.id}</div>
              <div className="text-sm text-muted-foreground">
                Started: {new Date(run.startedAt).toLocaleString()}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
```

### 4. React Query Hook (10 min)

```typescript
// src/features/governance/hooks/useGovernanceStatus.ts
import { useQuery } from "@tanstack/react-query";
import type { governanceStatusOperation } from "@/contracts/governance.status.v1.contract";
import { z } from "zod";

type GovernanceStatus = z.infer<typeof governanceStatusOperation.output>;

export function useGovernanceStatus() {
  return useQuery<GovernanceStatus>({
    queryKey: ["governance", "status"],
    queryFn: async () => {
      const res = await fetch("/api/v1/governance/status");
      if (!res.ok) throw new Error("Failed to fetch governance status");
      return res.json();
    },
    refetchInterval: 30000, // 30s polling (not aggressive)
  });
}
```

## Validation

**Manual:**

1. Start dev: `pnpm dev:stack`
2. Navigate to `/governance`
3. Verify:
   - Credit balance displays (number)
   - Next run time displays (or "No runs scheduled")
   - Recent runs list shows last 10 threads
4. Wait 30s, verify page auto-refreshes

**Automated:**

```bash
pnpm check  # Type check + lint
```

## Future Enhancements (NOT MVP)

Deferred to later:

- Runway calculation (balance ÷ burn rate → hours remaining)
- Health color coding (🟢/🟡/🔴)
- Failed runs filtering (status='error')
- Per-charter breakdown
- Drill-down into individual run transcripts
- Real-time updates (WebSocket instead of polling)

## Review Checklist

- [ ] **Work Item:** `task.0070` linked in PR body
- [ ] **Spec:** System tenant constants used correctly
- [ ] **Simplicity:** No new ports/adapters/services for simple reads
- [ ] **Tests:** Manual validation complete
- [ ] **Contracts:** Zod contract defined and used
- [ ] **Reviewer:** assigned and approved

## Attribution

- Design: Claude (Sonnet 4.5)
- Implementation: TBD
