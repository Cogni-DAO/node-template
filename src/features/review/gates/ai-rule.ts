// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/review/gates/ai-rule`
 * Purpose: AI-powered gate that evaluates PRs against declarative rules via the graph executor.
 * Scope: Builds LLM message from evidence + rule, invokes graph, parses scores. Does not own the graph executor lifecycle.
 * Invariants: Uses GraphExecutorPort for LLM routing + billing. System tenant billing.
 * Side-effects: IO (LLM call via graph executor)
 * Links: task.0149, packages/repo-spec/src/schema.ts (Rule)
 * @public
 */

import { randomUUID } from "node:crypto";
import { LANGGRAPH_GRAPH_IDS } from "@cogni/langgraph-graphs";
import { buildReviewUserMessage } from "@cogni/langgraph-graphs/graphs";
import type { Rule } from "@cogni/repo-spec";

import type { GraphExecutorPort, LlmCaller } from "@/ports";

import { evaluateCriteria } from "../criteria-evaluator";
import type { EvidenceBundle, GateResult } from "../types";

/** Parsed evaluation: metric name → prompt text. */
function extractEvaluations(
  rule: Rule
): Array<{ metric: string; prompt: string }> {
  return rule.evaluations.map((entry) => {
    const entries = Object.entries(entry);
    const [metric, prompt] = entries[0] as [string, string];
    return { metric, prompt };
  });
}

/** Parse LLM response text to extract metric scores. */
export function parseScoresFromResponse(
  responseText: string,
  metricNames: readonly string[]
): Map<string, { score: number; observation: string }> {
  const results = new Map<string, { score: number; observation: string }>();

  for (const metric of metricNames) {
    // Look for patterns like "metric-name: 0.85" or "**metric-name**: 0.85"
    // Also handle "metric_name" variations
    const escapedMetric = metric.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const scorePattern = new RegExp(
      `(?:\\*\\*)?${escapedMetric}(?:\\*\\*)?[:\\s]+([0-9](?:\\.[0-9]+)?)`,
      "i"
    );
    const match = responseText.match(scorePattern);

    if (match?.[1]) {
      const score = Number.parseFloat(match[1]);
      if (score >= 0 && score <= 1) {
        // Extract observation: text after the score on the same line or next line
        const afterScore = responseText.slice(
          (match.index ?? 0) + match[0].length
        );
        const observationMatch = afterScore.match(
          /[:\s-]*([^\n]+(?:\n(?![*#0-9])[^\n]*)?)/
        );
        const observation = observationMatch?.[1]?.trim() || "";
        results.set(metric, { score, observation });
      }
    }
  }

  return results;
}

/**
 * Evaluate a PR against an AI rule via the graph executor.
 */
export async function evaluateAiRule(params: {
  readonly rule: Rule;
  readonly evidence: EvidenceBundle;
  readonly executor: GraphExecutorPort;
  readonly caller: LlmCaller;
  readonly model: string;
}): Promise<GateResult> {
  const { rule, evidence, executor, caller, model } = params;
  const evaluations = extractEvaluations(rule);
  const metricNames = evaluations.map((e) => e.metric);

  // Build the user message with evidence + evaluation criteria
  const diffSummary = evidence.patches
    .map((p) => `### ${p.filename}\n${p.patch}`)
    .join("\n\n");

  const userMessage = buildReviewUserMessage({
    prTitle: evidence.prTitle,
    prBody: evidence.prBody,
    diffSummary,
    evaluations,
  });

  // Invoke the pr-review graph via GraphExecutorPort
  const runId = randomUUID();
  const result = executor.runGraph({
    runId,
    ingressRequestId: runId,
    graphId: LANGGRAPH_GRAPH_IDS["pr-review"],
    messages: [{ role: "user", content: userMessage }],
    model,
    caller,
  });

  // Drain stream and get final result
  for await (const _event of result.stream) {
    // Drain to completion — billing side-effects happen during iteration
  }

  const final = await result.final;

  if (!final.ok) {
    return {
      gateId: rule.id,
      gateType: "ai-rule",
      status: "neutral",
      summary: `AI evaluation failed: ${final.error ?? "unknown error"}`,
    };
  }

  // Parse scores from LLM response
  const responseText = final.content ?? "";
  const parsed = parseScoresFromResponse(responseText, metricNames);

  // Build scores map for criteria evaluation
  const scores = new Map<string, number>();
  const metrics: Array<{
    metric: string;
    score: number;
    observation: string;
  }> = [];

  for (const name of metricNames) {
    const result = parsed.get(name);
    if (result) {
      scores.set(name, result.score);
      metrics.push({
        metric: name,
        score: result.score,
        observation: result.observation,
      });
    }
  }

  // Apply success criteria thresholds deterministically
  const status = evaluateCriteria(scores, rule.success_criteria);

  return {
    gateId: rule.id,
    gateType: "ai-rule",
    status,
    summary:
      status === "pass"
        ? `Rule "${rule.id}" passed`
        : status === "fail"
          ? `Rule "${rule.id}" failed threshold checks`
          : `Rule "${rule.id}" neutral (missing metrics or evaluation issue)`,
    metrics,
  };
}
