// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/governance/components/ContributionRow`
 * Purpose: Single activity row within a contributor card — source badge, type label, description.
 * Scope: Governance feature component. Does not perform data fetching or server-side logic.
 * Invariants: Event types map to display labels and emoji icons.
 * Side-effects: none
 * Links: src/contracts/governance.epoch.v1.contract.ts
 * @public
 */

"use client";

import type { ReactElement } from "react";
import type { z } from "zod";

import type { activityEventSchema } from "@/contracts/governance.epoch.v1.contract";

import { SourceBadge } from "./SourceBadge";

type ActivityEvent = z.infer<typeof activityEventSchema>;

const TYPE_ICONS: Record<string, string> = {
  pr_merged: "⬆️",
  commit_pushed: "📝",
  review_submitted: "👁️",
  comment_created: "💬",
  message_sent: "🗨️",
  reaction_added: "👍",
};

const TYPE_LABELS: Record<string, string> = {
  pr_merged: "PR",
  commit_pushed: "Commit",
  review_submitted: "Review",
  comment_created: "Comment",
  message_sent: "Message",
  reaction_added: "Reaction",
};

export function ContributionRow({
  activity,
}: {
  activity: ActivityEvent;
}): ReactElement {
  return (
    <div className="flex items-center justify-between rounded bg-secondary/30 px-2 py-1 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-xs">
          {TYPE_ICONS[activity.eventType] ?? "📌"}
        </span>
        <SourceBadge source={activity.source} />
        <span className="text-muted-foreground text-xs">
          {TYPE_LABELS[activity.eventType] ?? activity.eventType}
        </span>
      </div>
    </div>
  );
}
