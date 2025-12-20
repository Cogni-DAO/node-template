// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/ai/services/telemetry`
 * Purpose: Record AI invocation to DB and Langfuse.
 * Scope: Create Langfuse trace, record generation metrics, write to ai_invocation_summaries. Does NOT perform billing or LLM calls.
 * Invariants:
 *   - Called on BOTH success AND error paths
 *   - PROMPTHASH_DUAL_RESOLUTION: resolvedPromptHash = canonicalPromptHash ?? fallbackPromptHash
 *   - Langfuse flush is fire-and-forget (never awaited on request path)
 *   - Never throws (telemetry should not block response)
 * Side-effects: IO (writes to DB via AiTelemetryPort, Langfuse via LangfusePort)
 * Notes: Per COMPLETION_REFACTOR_PLAN.md P2 extraction. P1-ready with graph fields.
 * Links: completion.ts, ports/ai-telemetry.port.ts, AI_SETUP_SPEC.md
 * @public
 */

import type { Logger } from "pino";
import type { AiTelemetryPort, LangfusePort, LlmErrorKind } from "@/ports";

/**
 * Context for recording AI invocation telemetry.
 */
export interface TelemetryContext {
  readonly invocationId: string;
  readonly requestId: string;
  readonly traceId: string;
  readonly fallbackPromptHash: string;
  readonly canonicalPromptHash: string | undefined;
  readonly model: string;
  readonly latencyMs: number;
  readonly status: "success" | "error";
  readonly errorCode?: LlmErrorKind;
  // Success fields
  readonly resolvedProvider?: string;
  readonly resolvedModel?: string;
  readonly usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  readonly providerCostUsd?: number;
  readonly litellmCallId?: string;
  // Graph fields (P1-ready)
  readonly graphRunId?: string;
  readonly graphName?: string;
  readonly graphVersion?: string;
}

/**
 * Record AI invocation telemetry to DB and Langfuse.
 *
 * Called on both success and error paths.
 * Never throws - telemetry should not block user response.
 *
 * @param context - Telemetry context from LLM result
 * @param aiTelemetry - DB telemetry port
 * @param langfuse - Optional Langfuse port (env-gated)
 * @param log - Logger for error reporting
 * @returns langfuseTraceId if created, undefined otherwise
 */
export async function recordTelemetry(
  _context: TelemetryContext,
  _aiTelemetry: AiTelemetryPort,
  _langfuse: LangfusePort | undefined,
  _log: Logger
): Promise<string | undefined> {
  throw new Error("Not implemented - P2 extraction pending");
}
