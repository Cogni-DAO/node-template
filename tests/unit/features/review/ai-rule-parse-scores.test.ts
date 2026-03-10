// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/features/review/ai-rule-parse-scores`
 * Purpose: Unit tests for LLM response score parsing in the AI rule gate.
 * Scope: Tests metric:score extraction, markdown formatting, edge cases, range validation. Does NOT test LLM calls.
 * Invariants: Pure function — no side-effects, no mocking needed.
 * Side-effects: none
 * Links: task.0149
 * @public
 */

import { describe, expect, it } from "vitest";

import { parseScoresFromResponse } from "@/features/review/gates/ai-rule";

describe("parseScoresFromResponse", () => {
  it("extracts simple metric: score patterns", () => {
    const text = "coherent-change: 0.85 — good alignment\nclarity: 0.7 nice";
    const result = parseScoresFromResponse(text, [
      "coherent-change",
      "clarity",
    ]);
    expect(result.get("coherent-change")?.score).toBe(0.85);
    expect(result.get("clarity")?.score).toBe(0.7);
  });

  it("handles bold markdown metric names", () => {
    const text = "**coherent-change**: 0.9 well done";
    const result = parseScoresFromResponse(text, ["coherent-change"]);
    expect(result.get("coherent-change")?.score).toBe(0.9);
  });

  it("extracts observation text after score", () => {
    const text = "quality: 0.8 — changes are well structured";
    const result = parseScoresFromResponse(text, ["quality"]);
    expect(result.get("quality")?.observation).toContain("well structured");
  });

  it("ignores scores outside 0-1 range", () => {
    const text = "quality: 1.5 too high";
    const result = parseScoresFromResponse(text, ["quality"]);
    expect(result.has("quality")).toBe(false);
  });

  it("handles integer score of 0", () => {
    const text = "quality: 0 terrible";
    const result = parseScoresFromResponse(text, ["quality"]);
    expect(result.get("quality")?.score).toBe(0);
  });

  it("handles integer score of 1", () => {
    const text = "quality: 1 perfect";
    const result = parseScoresFromResponse(text, ["quality"]);
    expect(result.get("quality")?.score).toBe(1);
  });

  it("returns empty map when no metrics found", () => {
    const text = "some random text with no scores";
    const result = parseScoresFromResponse(text, ["quality"]);
    expect(result.size).toBe(0);
  });

  it("handles metric names with special regex chars", () => {
    const text = "check.quality: 0.75 ok";
    const result = parseScoresFromResponse(text, ["check.quality"]);
    expect(result.get("check.quality")?.score).toBe(0.75);
  });
});
