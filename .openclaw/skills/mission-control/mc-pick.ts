#!/usr/bin/env npx tsx
// mc-pick.ts — Deterministic next-item selection. Outputs JSON.
// Usage: npx tsx mc-pick.ts <tier> [--work-dir /repo/current]
import type { WorkItemStatus } from "@cogni/work-items";
import { MarkdownWorkItemAdapter } from "@cogni/work-items/markdown";

const STATUS_WEIGHT: Record<string, number> = {
  needs_merge: 6,
  needs_closeout: 5,
  needs_implement: 4,
  needs_design: 3,
  needs_research: 2,
  needs_triage: 1,
};

const YELLOW_ALLOWED = new Set([
  "needs_merge",
  "needs_closeout",
  "needs_triage",
]);

const STATUS_TO_SKILL: Record<string, string> = {
  needs_merge: "/review-implementation",
  needs_closeout: "/closeout",
  needs_implement: "/implement",
  needs_design: "/design",
  needs_research: "/research",
  needs_triage: "/triage",
};

const tier = process.argv[2] ?? "GREEN";
const workDir =
  process.argv[3] === "--work-dir"
    ? (process.argv[4] ?? "/repo/current")
    : "/repo/current";

if (tier === "RED") {
  // biome-ignore lint/suspicious/noConsole: CLI tool — stdout is the output mechanism
  console.log("null");
  process.exit(0);
}

const adapter = new MarkdownWorkItemAdapter(workDir);

// Query all actionable statuses
const actionableStatuses = Object.keys(STATUS_WEIGHT) as WorkItemStatus[];
const { items } = await adapter.list({
  statuses: actionableStatuses,
});

// Filter by tier
const allowed =
  tier === "YELLOW" ? items.filter((i) => YELLOW_ALLOWED.has(i.status)) : items;

// Sort: highest status weight first, then priority ASC, then rank ASC
const sorted = allowed.sort((a, b) => {
  const wa = STATUS_WEIGHT[a.status] ?? 0;
  const wb = STATUS_WEIGHT[b.status] ?? 0;
  if (wb !== wa) return wb - wa;
  const pa = a.priority ?? 99;
  const pb = b.priority ?? 99;
  if (pa !== pb) return pa - pb;
  return (a.rank ?? 99) - (b.rank ?? 99);
});

const pick = sorted[0];
if (!pick) {
  // biome-ignore lint/suspicious/noConsole: CLI tool — stdout is the output mechanism
  console.log("null");
  process.exit(0);
}

// biome-ignore lint/suspicious/noConsole: CLI tool — stdout is the output mechanism
console.log(
  JSON.stringify({
    id: pick.id,
    status: pick.status,
    skill: STATUS_TO_SKILL[pick.status],
    priority: pick.priority ?? 99,
    rank: pick.rank ?? 99,
  })
);
