// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/governance/components/ContributorCard`
 * Purpose: Card displaying a contributor's rank, score, share, and activity breakdown.
 * Scope: Governance feature component for epoch detail pages. Does not perform data fetching or server-side logic.
 * Invariants: Colors applied via inline style (runtime HSL values). BigInt units displayed as Number for presentation.
 * Side-effects: none
 * Links: src/contracts/governance.epoch.v1.contract.ts
 * @public
 */

"use client";

import type { ReactElement } from "react";
import type { z } from "zod";

import { Card, CardContent } from "@/components";
import type { epochContributorSchema } from "@/contracts/governance.epoch.v1.contract";

import { ContributionRow } from "./ContributionRow";

type Contributor = z.infer<typeof epochContributorSchema>;

interface ContributorCardProps {
  readonly contributor: Contributor;
  readonly rank: number;
}

export function ContributorCard({
  contributor,
  rank,
}: ContributorCardProps): ReactElement {
  const totalScore = Math.round(Number(contributor.proposedUnits) / 1000);

  return (
    <Card className="border-border/50 bg-card/50">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full text-lg"
              style={{
                backgroundColor: `hsl(${contributor.color} / 0.15)`,
              }}
            >
              {contributor.avatar}
            </div>
            <div>
              <span className="text-muted-foreground text-sm">#{rank}</span>
              <div className="font-medium text-sm">
                {contributor.creditShare}% share
              </div>
            </div>
          </div>
          <div className="text-right">
            <div
              className="font-bold text-lg"
              style={{ color: `hsl(${contributor.color})` }}
            >
              {totalScore}
            </div>
            <div className="text-muted-foreground text-xs">points</div>
          </div>
        </div>
        <div className="space-y-1.5">
          {contributor.activities.map((activity) => (
            <ContributionRow key={activity.id} activity={activity} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
