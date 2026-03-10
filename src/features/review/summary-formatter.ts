// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/review/summary-formatter`
 * Purpose: Markdown rendering for Check Run output and PR comment body.
 * Scope: Pure formatting — receives review results, returns markdown strings. Does not perform I/O.
 * Invariants: Output is valid GitHub-flavored markdown.
 * Side-effects: none
 * Links: task.0149
 * @public
 */

import type { GateResult, ReviewResult } from "./types";

/**
 * Format the Check Run summary (markdown for the "output" field).
 */
export function formatCheckRunSummary(result: ReviewResult): string {
  const lines: string[] = [];

  lines.push(`## Cogni PR Review\n`);
  lines.push(
    `**Overall:** ${statusEmoji(result.conclusion)} ${result.conclusion.toUpperCase()}\n`
  );

  for (const gate of result.gateResults) {
    lines.push(formatGateSection(gate));
  }

  return lines.join("\n");
}

/**
 * Format a PR comment body with developer-friendly summary.
 */
export function formatPrComment(
  result: ReviewResult,
  daoBaseUrl?: string
): string {
  const lines: string[] = [];

  lines.push(`### Cogni PR Review ${statusEmoji(result.conclusion)}\n`);

  for (const gate of result.gateResults) {
    lines.push(formatGateSection(gate));
  }

  if (daoBaseUrl && result.conclusion === "fail") {
    lines.push(
      `\n---\n[Propose Vote to Merge](${daoBaseUrl}) — override via DAO governance`
    );
  }

  lines.push(
    `\n<sub>Reviewed by [Cogni](https://github.com/cogni-dao) — automated review</sub>`
  );

  return lines.join("\n");
}

function formatGateSection(gate: GateResult): string {
  const lines: string[] = [];
  const emoji = statusEmoji(gate.status);

  lines.push(`### ${emoji} ${gate.gateId} (${gate.gateType})\n`);
  lines.push(`${gate.summary}\n`);

  if (gate.metrics && gate.metrics.length > 0) {
    lines.push("| Metric | Score | Observation |");
    lines.push("|--------|-------|-------------|");
    for (const m of gate.metrics) {
      const scoreBar = `${(m.score * 100).toFixed(0)}%`;
      lines.push(
        `| ${m.metric} | ${scoreBar} | ${m.observation.slice(0, 120)} |`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

function statusEmoji(status: string): string {
  switch (status) {
    case "pass":
      return "\u2705";
    case "fail":
      return "\u274C";
    default:
      return "\u26A0\uFE0F";
  }
}
