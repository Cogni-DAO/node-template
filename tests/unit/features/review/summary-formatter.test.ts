// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/features/review/summary-formatter`
 * Purpose: Unit tests for Check Run summary and PR comment markdown formatting.
 * Scope: Tests overall structure, per-gate sections, metrics tables, DAO vote link, and attribution footer. Does NOT test GitHub API.
 * Invariants: Pure function — no side-effects, no mocking needed.
 * Side-effects: none
 * Links: task.0149
 * @public
 */

import { describe, expect, it } from "vitest";

import {
  formatCheckRunSummary,
  formatPrComment,
} from "@/features/review/summary-formatter";
import type { ReviewResult } from "@/features/review/types";

const passResult: ReviewResult = {
  conclusion: "pass",
  gateResults: [
    {
      gateId: "review-limits",
      gateType: "review-limits",
      status: "pass",
      summary: "PR within size limits (3 files, 2 KB)",
    },
    {
      gateId: "code-quality",
      gateType: "ai-rule",
      status: "pass",
      summary: 'Rule "code-quality" passed',
      metrics: [
        {
          metric: "coherence",
          score: 0.92,
          observation: "Changes are coherent",
        },
        { metric: "clarity", score: 0.85, observation: "Code is clear" },
      ],
    },
  ],
};

const failResult: ReviewResult = {
  conclusion: "fail",
  gateResults: [
    {
      gateId: "code-quality",
      gateType: "ai-rule",
      status: "fail",
      summary: 'Rule "code-quality" failed threshold checks',
      metrics: [
        { metric: "coherence", score: 0.4, observation: "Scattered changes" },
      ],
    },
  ],
};

describe("formatCheckRunSummary", () => {
  it("includes overall conclusion", () => {
    const md = formatCheckRunSummary(passResult);
    expect(md).toContain("PASS");
    expect(md).toContain("Cogni PR Review");
  });

  it("includes per-gate sections", () => {
    const md = formatCheckRunSummary(passResult);
    expect(md).toContain("review-limits");
    expect(md).toContain("code-quality");
  });

  it("includes metrics table for ai-rule gates", () => {
    const md = formatCheckRunSummary(passResult);
    expect(md).toContain("| coherence |");
    expect(md).toContain("92%");
  });
});

describe("formatPrComment", () => {
  it("includes DAO vote link on failure when daoBaseUrl provided", () => {
    const md = formatPrComment(failResult, "https://dao.example.com");
    expect(md).toContain("Propose Vote to Merge");
    expect(md).toContain("https://dao.example.com");
  });

  it("omits DAO vote link on pass", () => {
    const md = formatPrComment(passResult, "https://dao.example.com");
    expect(md).not.toContain("Propose Vote to Merge");
  });

  it("omits DAO vote link when no base URL", () => {
    const md = formatPrComment(failResult);
    expect(md).not.toContain("Propose Vote to Merge");
  });

  it("includes Cogni attribution footer", () => {
    const md = formatPrComment(passResult);
    expect(md).toContain("Cogni");
    expect(md).toContain("automated review");
  });
});
