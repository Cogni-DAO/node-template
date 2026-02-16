---
id: task.0070
type: task
title: Governance credit health dashboard — prevent silent credit outages
status: Todo
priority: 0
estimate: 2
summary: Build governance observability dashboard with credit health indicator, failed run visibility, and next run countdown to prevent incidents like 2026-02-15
outcome: System operators can see governance credit balance with runway estimate (🟢/🟡/🔴), failed runs with error codes, and next scheduled run time
spec_refs: openclaw-govern-distributed
assignees: []
credit:
project: proj.system-tenant-governance
branch:
pr:
reviewer:
created: 2026-02-16
updated: 2026-02-16
labels: [governance, ui, observability, p0]
external_refs:
---

# Governance credit health dashboard — prevent silent credit outages

## Context

**2026-02-15 Incident:** All 4 governance schedules failed silently for hours due to 0 credit balance in the governance billing account (`cogni_system`). The system appeared healthy (schedules triggering on time) but every run was rejected with `insufficient_credits` error. No monitoring detected the outage.

**Research:** [governance-visibility-dashboard.md](../../docs/research/governance-visibility-dashboard.md)

**Design Decision:** Build server-component dashboard with React Query polling (Option A from research). Simplest path to production, reuses existing patterns, extensible for future real-time features.

## Requirements

### Must Have (MVP)

**Credit Health Widget:**

- Current credit balance for `cogni_system` billing account
- Runway estimate: "XX hours of governance remaining"
- Color-coded health indicator:
  - 🟢 Green: > 24 hours runway
  - 🟡 Yellow: 6-24 hours runway
  - 🔴 Red: < 6 hours or balance ≤ 0
- Last 24h burn rate (credits spent)

**Failed Runs Table:**

- Last 10 failed governance runs (status='error')
- Columns: Charter (graphId), Scheduled Time, Error Message, Run ID
- Filter: `cogni_system` billing account only
- Time range: Last 24 hours by default

**Next Run Countdown:**

- "Next governance run in: XX minutes"
- Show all 4 governance charters with their next scheduled times
- Highlight earliest upcoming run

**Last Successful Run:**

- Timestamp of last successful run per charter
- Helps detect "all charters failing" vs "one charter broken"

### Nice to Have (Defer to Post-MVP)

- Live activity stream during governance runs
- Charter heartbeat history from gateway workspace
- Budget gate status display
- EDO (Event-Decision-Outcome) index
- Revenue share distribution tracking
- Export failed runs to CSV

## Allowed Changes

**Backend:**

- `src/contracts/governance.health.v1.contract.ts` (new)
- `src/contracts/governance.failed-runs.v1.contract.ts` (new)
- `src/contracts/governance.next-run.v1.contract.ts` (new)
- `src/app/api/v1/governance/health/route.ts` (new)
- `src/app/api/v1/governance/failed-runs/route.ts` (new)
- `src/app/api/v1/governance/next-run/route.ts` (new)
- `src/app/_facades/governance/` (new - business logic)

**Frontend:**

- `src/app/(app)/governance/page.tsx` (new)
- `src/app/(app)/governance/view.tsx` (new - client component)
- `src/features/governance/` (new - hooks, components, types)

**Infrastructure:**

- No new dependencies (uses existing React Query, shadcn/ui)

## Plan

### Phase 1: API Contracts & Backend (2-3 hours)

- [x] **Design decision:** Server-component dashboard with polling (from research)

**1.1 Create API contracts**

File: `src/contracts/governance.health.v1.contract.ts`

```typescript
import { z } from "zod";

export const governanceHealthOperation = {
  input: z.object({
    // No input - always queries cogni_system
  }),
  output: z.object({
    balanceCredits: z
      .bigint()
      .describe("Current credit balance for cogni_system"),
    runwayHours: z
      .number()
      .describe("Estimated hours until balance reaches zero"),
    burnRateLast24h: z.bigint().describe("Credits spent in last 24 hours"),
    healthStatus: z
      .enum(["green", "yellow", "red"])
      .describe("Color-coded health"),
    lastUpdatedAt: z
      .string()
      .datetime()
      .describe("When balance was last checked"),
  }),
};
```

File: `src/contracts/governance.failed-runs.v1.contract.ts`

```typescript
export const governanceFailedRunsOperation = {
  input: z.object({
    hours: z
      .number()
      .int()
      .min(1)
      .max(168)
      .default(24)
      .describe("Hours to look back"),
    limit: z.number().int().min(1).max(100).default(10).describe("Max results"),
  }),
  output: z.object({
    runs: z.array(
      z.object({
        runId: z.string(),
        charter: z.string().describe("graphId of the charter"),
        scheduledFor: z.string().datetime(),
        status: z.literal("error"),
        errorMessage: z.string().nullable(),
      })
    ),
  }),
};
```

File: `src/contracts/governance.next-run.v1.contract.ts`

```typescript
export const governanceNextRunOperation = {
  input: z.object({}),
  output: z.object({
    nextRunAt: z
      .string()
      .datetime()
      .nullable()
      .describe("Earliest next run across all charters"),
    charters: z.array(
      z.object({
        graphId: z.string(),
        nextRunAt: z.string().datetime().nullable(),
        enabled: z.boolean(),
        lastRunAt: z.string().datetime().nullable(),
      })
    ),
  }),
};
```

**1.2 Implement governance health facade**

File: `src/app/_facades/governance/health.server.ts`

```typescript
import { COGNI_SYSTEM_BILLING_ACCOUNT_ID } from "@/shared/constants/system-tenant";
import type { RequestContext } from "@/shared/observability";

export async function getGovernanceHealthFacade(ctx: RequestContext) {
  const container = getContainer();
  const accountService = container.accountsForSystem();

  // Get current balance
  const balanceCredits = await accountService.getBalance(
    COGNI_SYSTEM_BILLING_ACCOUNT_ID
  );

  // Calculate burn rate (last 24h)
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentCharges = await db.query.chargeReceipts.findMany({
    where: and(
      eq(chargeReceipts.billingAccountId, COGNI_SYSTEM_BILLING_ACCOUNT_ID),
      gte(chargeReceipts.createdAt, twentyFourHoursAgo)
    ),
  });

  const burnRateLast24h = recentCharges.reduce(
    (sum, charge) => sum + BigInt(charge.chargedCredits),
    BigInt(0)
  );

  // Calculate runway (hours until balance reaches zero)
  const hourlyBurnRate = Number(burnRateLast24h) / 24;
  const runwayHours =
    hourlyBurnRate > 0 ? Number(balanceCredits) / hourlyBurnRate : Infinity;

  // Determine health status
  let healthStatus: "green" | "yellow" | "red";
  if (balanceCredits <= BigInt(0)) {
    healthStatus = "red";
  } else if (runwayHours < 6) {
    healthStatus = "red";
  } else if (runwayHours < 24) {
    healthStatus = "yellow";
  } else {
    healthStatus = "green";
  }

  return {
    balanceCredits,
    runwayHours: runwayHours === Infinity ? 999 : Math.floor(runwayHours),
    burnRateLast24h,
    healthStatus,
    lastUpdatedAt: new Date().toISOString(),
  };
}
```

**1.3 Implement failed runs facade**

File: `src/app/_facades/governance/failed-runs.server.ts`

```typescript
export async function getGovernanceFailedRunsFacade(
  input: { hours: number; limit: number },
  ctx: RequestContext
) {
  const lookbackTime = new Date(Date.now() - input.hours * 60 * 60 * 1000);

  const db = getContainer().db;
  const runs = await db
    .select({
      runId: scheduleRuns.runId,
      charter: schedules.graphId,
      scheduledFor: scheduleRuns.scheduledFor,
      status: scheduleRuns.status,
      errorMessage: scheduleRuns.errorMessage,
    })
    .from(scheduleRuns)
    .innerJoin(schedules, eq(scheduleRuns.scheduleId, schedules.id))
    .innerJoin(
      executionGrants,
      eq(schedules.executionGrantId, executionGrants.id)
    )
    .where(
      and(
        eq(executionGrants.billingAccountId, COGNI_SYSTEM_BILLING_ACCOUNT_ID),
        eq(scheduleRuns.status, "error"),
        gte(scheduleRuns.scheduledFor, lookbackTime)
      )
    )
    .orderBy(desc(scheduleRuns.scheduledFor))
    .limit(input.limit);

  return {
    runs: runs.map((r) => ({
      runId: r.runId,
      charter: r.charter,
      scheduledFor: r.scheduledFor.toISOString(),
      status: "error" as const,
      errorMessage: r.errorMessage,
    })),
  };
}
```

**1.4 Implement next run facade**

File: `src/app/_facades/governance/next-run.server.ts`

```typescript
export async function getGovernanceNextRunFacade(ctx: RequestContext) {
  const db = getContainer().db;
  const governanceSchedules = await db
    .select({
      graphId: schedules.graphId,
      nextRunAt: schedules.nextRunAt,
      enabled: schedules.enabled,
      lastRunAt: schedules.lastRunAt,
    })
    .from(schedules)
    .innerJoin(
      executionGrants,
      eq(schedules.executionGrantId, executionGrants.id)
    )
    .where(
      eq(executionGrants.billingAccountId, COGNI_SYSTEM_BILLING_ACCOUNT_ID)
    );

  const enabledRuns = governanceSchedules
    .filter((s) => s.enabled && s.nextRunAt)
    .map((s) => s.nextRunAt!)
    .sort((a, b) => a.getTime() - b.getTime());

  const nextRunAt = enabledRuns[0] ?? null;

  return {
    nextRunAt: nextRunAt?.toISOString() ?? null,
    charters: governanceSchedules.map((s) => ({
      graphId: s.graphId,
      nextRunAt: s.nextRunAt?.toISOString() ?? null,
      enabled: s.enabled,
      lastRunAt: s.lastRunAt?.toISOString() ?? null,
    })),
  };
}
```

**1.5 Create API routes**

File: `src/app/api/v1/governance/health/route.ts`

```typescript
export const GET = wrapRouteHandlerWithLogging(
  { routeId: "governance.health", auth: { mode: "required", getSessionUser } },
  async (ctx, _request, sessionUser) => {
    if (!sessionUser) throw new Error("sessionUser required");

    const health = await getGovernanceHealthFacade(ctx);
    return NextResponse.json(governanceHealthOperation.output.parse(health));
  }
);
```

Similar for `/failed-runs` and `/next-run` routes.

### Phase 2: Frontend Dashboard (2-3 hours)

**2.1 Create React Query hooks**

File: `src/features/governance/hooks/useGovernanceHealth.ts`

```typescript
export function useGovernanceHealth() {
  return useQuery({
    queryKey: ["governance", "health"],
    queryFn: async () => {
      const res = await fetch("/api/v1/governance/health");
      if (!res.ok) throw new Error("Failed to fetch governance health");
      return res.json();
    },
    refetchInterval: 10000, // Poll every 10 seconds
  });
}
```

Similar for `useGovernanceFailedRuns` and `useGovernanceNextRun`.

**2.2 Create credit health widget component**

File: `src/features/governance/components/CreditHealthWidget.tsx`

```typescript
export function CreditHealthWidget() {
  const { data, isLoading } = useGovernanceHealth();

  if (isLoading) return <Skeleton />;
  if (!data) return <ErrorAlert />;

  const statusColors = {
    green: "text-green-600 bg-green-50",
    yellow: "text-yellow-600 bg-yellow-50",
    red: "text-red-600 bg-red-50",
  };

  const statusEmoji = {
    green: "🟢",
    yellow: "🟡",
    red: "🔴",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Governance Credit Health</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={cn("p-4 rounded-lg", statusColors[data.healthStatus])}>
          <div className="text-2xl font-bold">
            {statusEmoji[data.healthStatus]} {formatCredits(data.balanceCredits)}
          </div>
          <div className="text-sm mt-2">
            {data.runwayHours} hours remaining
          </div>
          <div className="text-xs mt-1 opacity-75">
            Burn rate: {formatCredits(data.burnRateLast24h)}/24h
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

**2.3 Create failed runs table component**

File: `src/features/governance/components/FailedRunsTable.tsx`

```typescript
export function FailedRunsTable() {
  const { data, isLoading } = useGovernanceFailedRuns({ hours: 24, limit: 10 });

  if (isLoading) return <Skeleton />;
  if (!data?.runs.length) {
    return <div className="text-muted-foreground">No failed runs in last 24 hours</div>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Charter</TableHead>
          <TableHead>Scheduled</TableHead>
          <TableHead>Error</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.runs.map((run) => (
          <TableRow key={run.runId}>
            <TableCell>{run.charter}</TableCell>
            <TableCell>{formatDateTime(run.scheduledFor)}</TableCell>
            <TableCell className="text-red-600">{run.errorMessage}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

**2.4 Create dashboard page**

File: `src/app/(app)/governance/page.tsx` (server component)

```typescript
export default async function GovernancePage() {
  const user = await getServerSessionUser();
  if (!user) redirect("/");

  return <GovernanceView />;
}
```

File: `src/app/(app)/governance/view.tsx` (client component)

```typescript
"use client";

export function GovernanceView() {
  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-6">Governance Dashboard</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CreditHealthWidget />
        <NextRunCountdown />
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Failed Runs (Last 24h)</CardTitle>
          </CardHeader>
          <CardContent>
            <FailedRunsTable />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

**2.5 Add navigation link**

Update main navigation to include "/governance" link (only for authenticated users).

## Validation

**Automated:**

```bash
pnpm check  # Type check + lint
pnpm test   # Unit tests for facades
```

**Manual:**

1. **Credit health indicator:**
   - Start dev stack: `pnpm dev:stack`
   - Navigate to `/governance`
   - Verify credit balance displays
   - Verify runway calculation is accurate
   - Verify color matches runway (green/yellow/red)

2. **Failed runs table:**
   - Manually cause a governance run to fail (disable credits)
   - Wait for next scheduled run
   - Verify failed run appears in table with error message

3. **Next run countdown:**
   - Verify countdown shows "Next run in: XX minutes"
   - Wait until run time passes
   - Verify countdown updates to next run

4. **Polling:**
   - Open browser dev tools → Network tab
   - Verify API calls happen every 10 seconds
   - Verify dashboard updates without page refresh

**Test with zero credits:**

```sql
-- Simulate zero credit scenario
UPDATE credit_ledger
SET amount = -1000000000, balance_after = 0
WHERE billing_account_id = '00000000-0000-4000-b000-000000000000';
```

Verify dashboard shows 🔴 red status.

## Review Checklist

- [ ] **Work Item:** `task.0070` linked in PR body
- [ ] **Spec:** [openclaw-govern-distributed](../../docs/spec/governance-council.md) runtime state model upheld
- [ ] **Research:** [governance-visibility-dashboard.md](../../docs/research/governance-visibility-dashboard.md) recommendations followed
- [ ] **Tests:** Facades have unit tests, manual validation complete
- [ ] **Contracts:** All API contracts defined with Zod schemas
- [ ] **Performance:** Polling interval set to 10s (not too aggressive)
- [ ] **Security:** Only queries `cogni_system` billing account (no user input for account ID)
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Research: [governance-visibility-dashboard.md](../../docs/research/governance-visibility-dashboard.md)
- Story: [story.0063](./story.0063.governance-visibility-dashboard.md)

## Attribution

- Research: Claude (Sonnet 4.5)
- Implementation: TBD
