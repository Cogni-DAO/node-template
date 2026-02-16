// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/governance/view`
 * Purpose: Client component displaying DAO governance status — credit balance, next run, recent runs.
 * Scope: Renders governance data fetched via React Query hook. Does not perform server-side logic or direct DB access.
 * Invariants: Uses PageContainer + SectionCard layout primitives; 30s polling via hook.
 * Side-effects: IO (via useGovernanceStatus hook)
 * Links: docs/spec/governance-status-api.md
 * @public
 */

"use client";

import type { ReactElement } from "react";

import { PageContainer, SectionCard } from "@/components";
import { useGovernanceStatus } from "@/features/governance/hooks/useGovernanceStatus";

export function GovernanceView(): ReactElement {
  const { data, isLoading, isError } = useGovernanceStatus();

  if (isLoading) {
    return (
      <PageContainer>
        <h1 className="font-bold text-3xl">DAO Governance Status</h1>
        <div className="text-foreground-muted">Loading...</div>
      </PageContainer>
    );
  }

  if (isError || !data) {
    return (
      <PageContainer>
        <h1 className="font-bold text-3xl">DAO Governance Status</h1>
        <div className="text-foreground-muted">
          Failed to load governance status
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <h1 className="font-bold text-3xl">DAO Governance Status</h1>

      <SectionCard title="Credit Balance">
        <div className="font-mono text-2xl">{data.systemCredits} credits</div>
      </SectionCard>

      <SectionCard title="Next Governance Run">
        {data.nextRunAt ? (
          <div>Scheduled: {new Date(data.nextRunAt).toLocaleString()}</div>
        ) : (
          <div className="text-foreground-muted">No runs scheduled</div>
        )}
      </SectionCard>

      <SectionCard title="Recent Runs">
        {data.recentRuns.length === 0 ? (
          <div className="text-foreground-muted">No recent runs</div>
        ) : (
          <div className="divide-y divide-border">
            {data.recentRuns.map((run) => (
              <div key={run.id} className="py-3 first:pt-0 last:pb-0">
                <div className="font-medium">{run.title ?? run.id}</div>
                <div className="text-foreground-muted text-sm">
                  Started: {new Date(run.startedAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </PageContainer>
  );
}
