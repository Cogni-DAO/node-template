// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/governance/mock/epoch-mock-data`
 * Purpose: Static mock data for epoch ledger UI pages. Shaped to match contract schemas.
 * Scope: Consumed by feature hooks only. Will be replaced by real API calls. Does not perform IO or access external services.
 * Invariants: Data shapes match governance.epoch.v1 and governance.holdings.v1 contracts exactly.
 * Side-effects: none
 * Links: src/contracts/governance.epoch.v1.contract.ts, src/contracts/governance.holdings.v1.contract.ts
 * @internal
 */

import type { z } from "zod";

import type {
  currentEpochOperation,
  epochHistoryOperation,
} from "@/contracts/governance.epoch.v1.contract";
import type { holdingsOperation } from "@/contracts/governance.holdings.v1.contract";

type CurrentEpochOutput = z.infer<(typeof currentEpochOperation)["output"]>;
type EpochHistoryOutput = z.infer<(typeof epochHistoryOperation)["output"]>;
type HoldingsOutput = z.infer<(typeof holdingsOperation)["output"]>;

const AVATARS = ["🦊", "🐙", "🦉", "🐺", "🦅", "🐋", "🦎"] as const;
const COLORS = [
  "265 90% 65%",
  "175 70% 45%",
  "38 92% 55%",
  "340 80% 60%",
  "200 85% 55%",
  "150 70% 45%",
  "15 85% 55%",
] as const;

const NAMES = [
  "alice.eth",
  "bob.eth",
  "carol.eth",
  "dave.eth",
  "eve.eth",
  "frank.eth",
  "grace.eth",
];

type EventType =
  | "pr_merged"
  | "commit_pushed"
  | "review_submitted"
  | "comment_created"
  | "message_sent"
  | "reaction_added";

const EVENT_META: Record<
  EventType,
  { source: "github" | "discord"; descriptions: string[] }
> = {
  pr_merged: {
    source: "github",
    descriptions: [
      "Refactor: scoring pipeline",
      "Feature: token distribution module",
      "Fix: epoch boundary calculation",
      "Add: contributor analytics view",
    ],
  },
  commit_pushed: {
    source: "github",
    descriptions: [
      "Add migration scripts",
      "Update governance config",
      "Patch voting threshold",
      "Optimize query performance",
    ],
  },
  review_submitted: {
    source: "github",
    descriptions: [
      "Review: treasury module PR",
      "Review: auth flow changes",
      "Review: API rate limiting",
      "Review: dashboard components",
    ],
  },
  comment_created: {
    source: "github",
    descriptions: [
      "Feedback on tokenomics draft",
      "Discussion on proposal #42",
      "Clarification on voting rules",
      "Input on roadmap priorities",
    ],
  },
  message_sent: {
    source: "discord",
    descriptions: [
      "Technical architecture debate",
      "Weekly sync discussion",
      "Onboarding new contributors",
      "Community event planning",
    ],
  },
  reaction_added: {
    source: "discord",
    descriptions: [
      "Reacted to announcement",
      "Endorsed community decision",
      "Supported feature request",
      "Acknowledged proposal update",
    ],
  },
};

const EVENT_TYPES: EventType[] = [
  "pr_merged",
  "commit_pushed",
  "review_submitted",
  "comment_created",
  "message_sent",
  "reaction_added",
];

function makeActivities(seed: number) {
  const count = 3 + (seed % 5);
  return Array.from({ length: count }, (_, i) => {
    const type = EVENT_TYPES[(seed + i) % EVENT_TYPES.length] as EventType;
    const meta = EVENT_META[type];
    const desc = meta.descriptions[(seed + i) % meta.descriptions.length] ?? "";
    const score = 5 + ((seed * 7 + i * 13) % 45);
    return {
      id: `${meta.source}:${type}:cogni-dao/cogni-template:${seed * 100 + i}`,
      source: meta.source as "github" | "discord",
      eventType: type,
      platformLogin: NAMES[seed % NAMES.length] ?? "unknown",
      artifactUrl: `https://${meta.source === "github" ? "github.com" : "discord.com"}/example/${seed * 100 + i}`,
      eventTime: new Date(2026, 1, 14 + (i % 7), 10 + i).toISOString(),
      description: desc,
      score,
    };
  });
}

function makeContributors(epochSeed: number, count: number) {
  const raw = Array.from({ length: count }, (_, i) => {
    const activities = makeActivities(epochSeed * 10 + i);
    const totalScore = activities.reduce((s, a) => s + a.score, 0);
    return {
      userId: `user_${(NAMES[i % NAMES.length] ?? "unknown").split(".")[0]}`,
      displayName: NAMES[i % NAMES.length] ?? null,
      avatar: AVATARS[i % AVATARS.length] ?? "🦊",
      color: COLORS[i % COLORS.length] ?? "265 90% 65%",
      proposedUnits: String(totalScore * 1000),
      finalUnits: null,
      creditShare: 0,
      activityCount: activities.length,
      activities: activities.map(
        ({ description: _d, score: _s, ...rest }) => rest
      ),
      _totalScore: totalScore,
      _activities: activities,
    };
  });

  const total = raw.reduce((s, c) => s + c._totalScore, 0);
  return raw.map(({ _totalScore, _activities, ...c }) => ({
    ...c,
    creditShare: Math.round((_totalScore / total) * 1000) / 10,
    _totalScore,
    _activities,
  }));
}

// Current open epoch
const currentContributors = makeContributors(5, 6);
export const MOCK_CURRENT_EPOCH: CurrentEpochOutput = {
  epoch: {
    id: 5,
    status: "open",
    periodStart: new Date(2026, 1, 16).toISOString(),
    periodEnd: new Date(2026, 1, 23).toISOString(),
    poolTotalCredits: null,
    signedBy: null,
    signedAt: null,
    contributors: currentContributors.map(
      ({ _totalScore, _activities, ...c }) => c
    ),
  },
};

// Past closed epochs
function makePastEpoch(
  id: number,
  start: Date,
  end: Date,
  credits: number,
  contributorCount: number,
  signedAt: Date
) {
  const contributors = makeContributors(id, contributorCount);
  return {
    id,
    status: "closed" as const,
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    poolTotalCredits: String(credits),
    signedBy: "Admin",
    signedAt: signedAt.toISOString(),
    contributors: contributors.map(({ _totalScore, _activities, ...c }) => c),
    _contributors: contributors,
  };
}

const pastEpochsRaw = [
  makePastEpoch(
    4,
    new Date(2026, 1, 9),
    new Date(2026, 1, 16),
    10000,
    7,
    new Date(2026, 1, 16, 14)
  ),
  makePastEpoch(
    3,
    new Date(2026, 1, 2),
    new Date(2026, 1, 9),
    8500,
    5,
    new Date(2026, 1, 9, 15)
  ),
  makePastEpoch(
    2,
    new Date(2026, 0, 26),
    new Date(2026, 1, 2),
    9200,
    6,
    new Date(2026, 1, 2, 12)
  ),
  makePastEpoch(
    1,
    new Date(2026, 0, 19),
    new Date(2026, 0, 26),
    7800,
    4,
    new Date(2026, 0, 26, 11)
  ),
];

export const MOCK_EPOCH_HISTORY: EpochHistoryOutput = {
  epochs: pastEpochsRaw.map(({ _contributors, ...e }) => e),
};

// Holdings — aggregate across all past epochs
function computeHoldings() {
  const userMap = new Map<
    string,
    {
      userId: string;
      displayName: string | null;
      avatar: string;
      color: string;
      totalCredits: number;
      epochs: Set<number>;
    }
  >();

  for (const epoch of pastEpochsRaw) {
    const credits = Number(epoch.poolTotalCredits);
    for (const c of epoch._contributors) {
      const existing = userMap.get(c.userId);
      const userCredits = Math.round((credits * c.creditShare) / 100);
      if (existing) {
        existing.totalCredits += userCredits;
        existing.epochs.add(epoch.id);
      } else {
        userMap.set(c.userId, {
          userId: c.userId,
          displayName: c.displayName,
          avatar: c.avatar,
          color: c.color,
          totalCredits: userCredits,
          epochs: new Set([epoch.id]),
        });
      }
    }
  }

  const entries = [...userMap.values()];
  const totalCredits = entries.reduce((s, e) => s + e.totalCredits, 0);

  return {
    holdings: entries
      .sort((a, b) => b.totalCredits - a.totalCredits)
      .map((e) => ({
        userId: e.userId,
        displayName: e.displayName,
        avatar: e.avatar,
        color: e.color,
        totalCredits: String(e.totalCredits),
        ownershipPercent:
          Math.round((e.totalCredits / totalCredits) * 1000) / 10,
        epochsContributed: e.epochs.size,
      })),
    totalCreditsIssued: String(totalCredits),
    totalContributors: entries.length,
    epochsCompleted: pastEpochsRaw.length,
  };
}

export const MOCK_HOLDINGS: HoldingsOutput = computeHoldings();
