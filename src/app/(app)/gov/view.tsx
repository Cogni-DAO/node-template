// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/gov/view`
 * Purpose: Client component displaying DAO governance status — credit balance, next run, recent runs, and activity charts.
 * Scope: Renders governance data fetched via React Query hooks. Does not perform server-side logic or direct DB access.
 * Invariants: Matches dashboard layout pattern (max-width-container-screen); 30s polling for status, stale-while-revalidate for activity.
 * Side-effects: IO (via useGovernanceStatus hook and activity fetch)
 * Links: docs/spec/governance-status-api.md
 * @public
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import type { ReactElement } from "react";
import type { z } from "zod";
import {
  SectionCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TimeRangeSelector,
} from "@/components";
import { ActivityChart } from "@/components/kit/data-display/ActivityChart";
import type {
  aiActivityOperation,
  TimeRange,
} from "@/contracts/ai.activity.v1.contract";
import { creditsToUsd } from "@/core";
import { useGovernanceStatus } from "@/features/governance/hooks/useGovernanceStatus";
import { fetchGovernanceActivity } from "./_api/fetchGovernanceActivity";

export function GovernanceView(): ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const range = (searchParams.get("range") as TimeRange) || "1d";

  const { data, isLoading, error } = useGovernanceStatus();

  const {
    data: activity,
    isLoading: activityLoading,
    error: activityError,
  } = useQuery({
    queryKey: ["governance-activity", range],
    queryFn: () => fetchGovernanceActivity({ range }),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: 2,
  });

  const handleRangeChange = (newRange: TimeRange) => {
    router.replace(`/gov?range=${newRange}`, { scroll: false });
  };

  // Error state — matches activity/schedules pattern
  if (error) {
    return (
      <div className="mx-auto flex max-w-[var(--max-width-container-screen)] flex-col gap-8 p-4 md:p-8 lg:px-16">
        <div className="rounded-lg border border-destructive bg-destructive/10 p-6">
          <h2 className="font-semibold text-destructive text-lg">
            Error loading governance data
          </h2>
          <p className="text-muted-foreground text-sm">
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
        </div>
      </div>
    );
  }

  // Loading skeleton — matches activity page pattern
  if (isLoading || !data) {
    return (
      <div className="mx-auto flex max-w-[var(--max-width-container-screen)] flex-col gap-8 p-4 md:p-8 lg:px-16">
        <div className="animate-pulse space-y-8">
          <div className="h-8 w-64 rounded-md bg-muted" />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="h-32 rounded-lg bg-muted" />
            <div className="h-32 rounded-lg bg-muted" />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="h-64 rounded-lg bg-muted" />
            <div className="h-64 rounded-lg bg-muted" />
            <div className="h-64 rounded-lg bg-muted" />
          </div>
          <div className="h-64 rounded-lg bg-muted" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-[var(--max-width-container-screen)] flex-col gap-8 p-4 md:p-8 lg:px-16">
      <h1 className="font-bold text-3xl tracking-tight">
        Cogni System Activity
      </h1>

      {/* Stats row */}
      <div className="grid gap-4 md:grid-cols-2">
        <SectionCard title="System Credit Balance">
          <span className="font-bold text-4xl">
            $
            {creditsToUsd(Number(data.systemCredits)).toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
          <span className="ml-2 text-lg text-muted-foreground">USD</span>
        </SectionCard>

        <SectionCard title="Next Scheduled Run">
          {data.nextRunAt ? (
            <>
              <span className="font-bold text-4xl">
                {new Date(data.nextRunAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </span>
              <span className="ml-2 text-lg text-muted-foreground">
                {new Date(data.nextRunAt).toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                  hour12: true,
                })}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">No runs scheduled</span>
          )}
        </SectionCard>
      </div>

      {/* Activity charts */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-xl tracking-tight">
            Usage Metrics
          </h2>
          <TimeRangeSelector
            value={range}
            onValueChange={handleRangeChange}
            className="w-40 rounded-lg"
          />
        </div>

        {activityError ? (
          <div className="rounded-lg border border-destructive bg-destructive/10 p-6">
            <p className="text-destructive text-sm">
              Failed to load activity charts.
            </p>
          </div>
        ) : activityLoading || !activity ? (
          <div className="grid animate-pulse gap-4 md:grid-cols-3">
            <div className="h-64 rounded-lg bg-muted" />
            <div className="h-64 rounded-lg bg-muted" />
            <div className="h-64 rounded-lg bg-muted" />
          </div>
        ) : (
          <ActivityCharts activity={activity} />
        )}
      </div>

      {/* Recent Runs table */}
      <div className="space-y-4">
        <h2 className="font-semibold text-xl tracking-tight">Recent Runs</h2>
        {data.recentRuns.length === 0 ? (
          <div className="rounded-lg border bg-card p-12 text-center">
            <p className="text-muted-foreground">No recent activity</p>
            <p className="mt-2 text-muted-foreground text-sm">
              System activity will appear here once scheduled runs execute.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Last Activity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentRuns.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="font-medium">
                      {run.title ?? run.id}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(run.startedAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(run.lastActivity).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

type ActivityData = z.infer<typeof aiActivityOperation.output>;

function ActivityCharts({ activity }: { activity: ActivityData }) {
  const spendData = activity.chartSeries.map((d) => ({
    date: d.bucketStart,
    value: Number.parseFloat(d.spend),
  }));

  const tokenData = activity.chartSeries.map((d) => ({
    date: d.bucketStart,
    value: d.tokens,
  }));

  const requestData = activity.chartSeries.map((d) => ({
    date: d.bucketStart,
    value: d.requests,
  }));

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <ActivityChart
        title="Total Spend"
        description={`$${activity.totals.spend.total} total`}
        data={spendData}
        config={{
          value: {
            label: "Spend ($)",
            color: "hsl(var(--chart-1))",
          },
        }}
        color="hsl(var(--chart-1))"
        effectiveStep={activity.effectiveStep}
      />
      <ActivityChart
        title="Total Tokens"
        description={`${activity.totals.tokens.total.toLocaleString()} tokens`}
        data={tokenData}
        config={{
          value: {
            label: "Tokens",
            color: "hsl(var(--chart-2))",
          },
        }}
        color="hsl(var(--chart-2))"
        effectiveStep={activity.effectiveStep}
      />
      <ActivityChart
        title="Total Requests"
        description={`${activity.totals.requests.total.toLocaleString()} requests`}
        data={requestData}
        config={{
          value: {
            label: "Requests",
            color: "hsl(var(--chart-3))",
          },
        }}
        color="hsl(var(--chart-3))"
        effectiveStep={activity.effectiveStep}
      />
    </div>
  );
}
