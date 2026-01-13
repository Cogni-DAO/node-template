// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/ai/services/telemetry`
 * Purpose: Record AI invocation to DB and Langfuse generation observations.
 * Scope: Record generation metrics under existing trace, write to ai_invocation_summaries. Does NOT create traces (decorator does) or perform LLM calls.
 * Invariants:
 *   - Called on BOTH success AND error paths
 *   - PROMPTHASH_DUAL_RESOLUTION: resolvedPromptHash = canonicalPromptHash ?? fallbackPromptHash
 *   - GENERATION_UNDER_EXISTING_TRACE: recordGeneration attaches to trace created by ObservabilityGraphExecutorDecorator
 *   - Langfuse flush is fire-and-forget (never awaited on request path)
 *   - Never throws (telemetry should not block response)
 * Side-effects: IO (writes to DB via AiTelemetryPort, Langfuse via LangfusePort)
 * Notes: Trace created by decorator; this service only records generation observation.
 * Links: completion.ts, ports/ai-telemetry.port.ts, AI_SETUP_SPEC.md, observability-executor.decorator.ts
 * @public
 */

import type { Logger } from "pino";
import type { AiTelemetryPort, LangfusePort, LlmErrorKind } from "@/ports";
import { serverEnv } from "@/shared/env";

/**
 * Base context for all telemetry recording.
 */
interface TelemetryContextBase {
  readonly invocationId: string;
  readonly requestId: string;
  readonly traceId: string;
  readonly fallbackPromptHash: string;
  readonly model: string;
  readonly latencyMs: number;
}

/**
 * Context for success telemetry.
 */
export interface TelemetryContextSuccess extends TelemetryContextBase {
  readonly status: "success";
  readonly canonicalPromptHash: string | undefined;
  readonly resolvedProvider: string | undefined;
  readonly resolvedModel: string | undefined;
  readonly usage:
    | {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
      }
    | undefined;
  readonly providerCostUsd: number | undefined;
  readonly litellmCallId: string | undefined;
  // Graph fields (P1-ready)
  readonly graphRunId?: string;
  readonly graphName?: string;
  readonly graphVersion?: string;
}

/**
 * Context for error telemetry.
 */
export interface TelemetryContextError extends TelemetryContextBase {
  readonly status: "error";
  readonly errorCode: LlmErrorKind;
}

/**
 * Union type for telemetry context.
 */
export type TelemetryContext = TelemetryContextSuccess | TelemetryContextError;

/**
 * Record AI invocation telemetry to DB and Langfuse generation observation.
 *
 * Called on both success and error paths.
 * Never throws - telemetry should not block user response.
 *
 * Per GENERATION_UNDER_EXISTING_TRACE: recordGeneration attaches to trace
 * created by ObservabilityGraphExecutorDecorator. Does NOT create new trace.
 *
 * Invariants:
 * - PROMPTHASH_DUAL_RESOLUTION: resolvedPromptHash = canonicalPromptHash ?? fallbackPromptHash
 * - GENERATION_UNDER_EXISTING_TRACE: generation attaches to existing graph-execution trace
 * - Langfuse flush is fire-and-forget (never awaited on request path)
 * - Never throws (catches all errors internally)
 *
 * @param context - Telemetry context from LLM result
 * @param aiTelemetry - DB telemetry port
 * @param langfuse - Optional Langfuse port (env-gated)
 * @param log - Logger for error reporting
 * @returns traceId (for DB record correlation)
 */
export async function recordTelemetry(
  context: TelemetryContext,
  aiTelemetry: AiTelemetryPort,
  langfuse: LangfusePort | undefined,
  log: Logger
): Promise<string | undefined> {
  const {
    invocationId,
    requestId,
    traceId,
    fallbackPromptHash,
    model,
    latencyMs,
    status,
  } = context;

  // PROMPTHASH_DUAL_RESOLUTION: prefer canonical (from adapter) over fallback
  const resolvedPromptHash =
    status === "success"
      ? (context.canonicalPromptHash ?? fallbackPromptHash)
      : fallbackPromptHash;

  const resolvedModel =
    status === "success" ? (context.resolvedModel ?? model) : model;

  // Record Langfuse generation under existing trace (created by decorator)
  // Per GENERATION_UNDER_EXISTING_TRACE: no createTrace() - trace already exists
  if (langfuse) {
    try {
      if (status === "success") {
        langfuse.recordGeneration(traceId, {
          model: resolvedModel,
          status: "success",
          latencyMs,
          ...(context.usage?.promptTokens !== undefined
            ? { tokensIn: context.usage.promptTokens }
            : {}),
          ...(context.usage?.completionTokens !== undefined
            ? { tokensOut: context.usage.completionTokens }
            : {}),
          ...(context.providerCostUsd !== undefined
            ? { providerCostUsd: context.providerCostUsd }
            : {}),
        });
      } else {
        langfuse.recordGeneration(traceId, {
          model,
          status: "error",
          errorCode: context.errorCode,
          latencyMs,
        });
      }

      // Flush in background (never await on request path per spec)
      langfuse
        .flush()
        .catch((err) => log.warn({ err }, "Langfuse flush failed"));
    } catch (err) {
      // Langfuse failure shouldn't block request - DB telemetry still written
      log.warn({ err, traceId }, "Langfuse recordGeneration failed");
    }
  }

  // Record to DB
  // langfuseTraceId = traceId when Langfuse is enabled (trace created by decorator)
  const langfuseTraceId = langfuse ? traceId : undefined;

  try {
    if (status === "success") {
      await aiTelemetry.recordInvocation({
        invocationId,
        requestId,
        traceId,
        ...(langfuseTraceId ? { langfuseTraceId } : {}),
        provider: context.resolvedProvider ?? "unknown",
        model: resolvedModel,
        promptHash: resolvedPromptHash,
        routerPolicyVersion: serverEnv().ROUTER_POLICY_VERSION,
        status: "success",
        latencyMs,
        ...(context.usage?.promptTokens !== undefined
          ? { tokensIn: context.usage.promptTokens }
          : {}),
        ...(context.usage?.completionTokens !== undefined
          ? { tokensOut: context.usage.completionTokens }
          : {}),
        ...(context.usage?.totalTokens !== undefined
          ? { tokensTotal: context.usage.totalTokens }
          : {}),
        ...(context.providerCostUsd !== undefined
          ? { providerCostUsd: context.providerCostUsd }
          : {}),
        ...(context.litellmCallId
          ? { litellmCallId: context.litellmCallId }
          : {}),
      });
    } else {
      await aiTelemetry.recordInvocation({
        invocationId,
        requestId,
        traceId,
        ...(langfuseTraceId ? { langfuseTraceId } : {}),
        provider: "unknown", // Not available on error (no response)
        model,
        promptHash: fallbackPromptHash, // Real hash computed BEFORE LLM call
        routerPolicyVersion: serverEnv().ROUTER_POLICY_VERSION,
        status: "error",
        errorCode: context.errorCode,
        latencyMs,
      });
    }
  } catch (telemetryError) {
    // Telemetry should never block user response
    log.error(
      { err: telemetryError, invocationId },
      `Failed to record ${status} telemetry`
    );
  }

  return langfuseTraceId;
}
