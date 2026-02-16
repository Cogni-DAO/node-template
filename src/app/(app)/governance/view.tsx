// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/governance/view`
 * Purpose: Client component displaying DAO governance status — credit balance, next run, recent runs.
 * Scope: Renders governance data fetched via React Query hook. Does not perform server-side logic or direct DB access.
 * Invariants: Matches dashboard layout pattern (max-width-container-screen); 30s polling via hook.
 * Side-effects: IO (via useGovernanceStatus hook)
 * Links: docs/spec/governance-status-api.md
 * @public
 */

"use client";

import type { ReactElement } from "react";

import {
  SectionCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components";
import { useGovernanceStatus } from "@/features/governance/hooks/useGovernanceStatus";

export function GovernanceView(): ReactElement {
  const { data, isLoading, error } = useGovernanceStatus();

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
          <div className="h-64 rounded-lg bg-muted" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-[var(--max-width-container-screen)] flex-col gap-8 p-4 md:p-8 lg:px-16">
      <h1 className="font-bold text-3xl tracking-tight">
        DAO Governance Status
      </h1>

      {/* Stats row */}
      <div className="grid gap-4 md:grid-cols-2">
        <SectionCard title="Credit Balance">
          <span className="font-bold text-4xl">
            {Number(data.systemCredits).toLocaleString()}
          </span>
          <span className="ml-2 text-lg text-muted-foreground">credits</span>
        </SectionCard>

        <SectionCard title="Next Governance Run">
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

      {/* Recent Runs table */}
      <div className="space-y-4">
        <h2 className="font-semibold text-xl tracking-tight">Recent Runs</h2>
        {data.recentRuns.length === 0 ? (
          <div className="rounded-lg border bg-card p-12 text-center">
            <p className="text-muted-foreground">No governance runs yet</p>
            <p className="mt-2 text-muted-foreground text-sm">
              Runs will appear here once the governance council executes.
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
