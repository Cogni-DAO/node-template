// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/ai/services/metrics`
 * Purpose: Prometheus metrics recording for LLM calls.
 * Scope: Record duration histogram, token counter, cost counter, error counter. Does NOT perform billing or telemetry.
 * Invariants:
 *   - Records ai_llm_call_duration_ms histogram
 *   - Increments ai_llm_tokens_total counter
 *   - Increments ai_llm_cost_usd_total counter
 *   - Increments ai_llm_errors_total on error path
 * Side-effects: IO (writes to Prometheus registry)
 * Notes: Per COMPLETION_REFACTOR_PLAN.md P1 extraction
 * Links: completion.ts, shared/observability/server/metrics.ts
 * @public
 */

/**
 * Context for recording LLM metrics.
 */
export interface MetricsContext {
  readonly model: string;
  readonly durationMs: number;
  readonly tokensUsed?: number;
  readonly providerCostUsd?: number;
  readonly isError: boolean;
  readonly errorCode?: string;
}

/**
 * Record Prometheus metrics for an LLM call.
 *
 * @param context - Metrics context from LLM result
 */
export async function recordMetrics(_context: MetricsContext): Promise<void> {
  throw new Error("Not implemented - P1 extraction pending");
}
