// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@ports/ai-telemetry.port`
 * Purpose: Port interfaces for AI invocation telemetry and Langfuse integration.
 * Scope: Define AiTelemetryPort, LangfusePort interfaces. Does NOT contain implementations.
 * Invariants:
 *   - AiTelemetryPort always wired (DB writes even without Langfuse)
 *   - LangfusePort optional (only when LANGFUSE_SECRET_KEY set)
 * Side-effects: none (interfaces only)
 * Notes: Per AI_SETUP_SPEC.md P0 scope. LlmError types moved to llm.port.ts.
 * Links: AI_SETUP_SPEC.md, completion.ts, DrizzleAiTelemetryAdapter
 * @public
 */

import type { LlmErrorKind } from "./llm.port";

/**
 * Invocation status for telemetry recording.
 */
export type InvocationStatus = "success" | "error";

/**
 * Parameters for recording an AI invocation to the telemetry store.
 * Per AI_SETUP_SPEC.md ai_invocation_summaries schema.
 */
export interface RecordInvocationParams {
  errorCode?: LlmErrorKind; // Only when status='error'
  graphName?: string;

  // Optional graph context
  graphRunId?: string;
  graphVersion?: string;
  // Identity & Correlation
  invocationId: string; // UUID, idempotency key (UNIQUE)

  // Optional external IDs
  langfuseTraceId?: string; // Langfuse trace ID (same as traceId when enabled)
  latencyMs: number;
  litellmCallId?: string; // LiteLLM call ID for /spend/logs join
  model: string; // e.g., "gpt-4o", "claude-3-5-sonnet"

  // Reproducibility keys
  promptHash: string; // SHA-256 of canonical outbound payload

  // Resolved target
  provider: string; // e.g., "openai", "anthropic"
  providerCostUsd?: number;
  requestId: string; // Request correlation ID
  routerPolicyVersion: string; // Semver or git SHA of routing policy

  // Status
  status: InvocationStatus;

  // Usage metrics (nullable for error cases)
  tokensIn?: number;
  tokensOut?: number;
  tokensTotal?: number;
  traceId: string; // OTel trace ID
}

/**
 * Port for recording AI invocation telemetry.
 * Always wired (DrizzleAiTelemetryAdapter) - works even without Langfuse.
 */
export interface AiTelemetryPort {
  /**
   * Record an AI invocation summary.
   * Called on BOTH success AND error paths.
   * Uses invocationId as idempotency key (UNIQUE constraint).
   */
  recordInvocation(params: RecordInvocationParams): Promise<void>;
}

/**
 * Parameters for creating a trace with full I/O context.
 * Per LANGFUSE_NON_NULL_IO: input is set at creation; output on terminal.
 */
export interface CreateTraceWithIOParams {
  input: unknown;
  metadata: Record<string, unknown>;
  sessionId?: string;
  tags: string[];
  traceId: string;
  userId?: string;
}

/**
 * Span handle for tool instrumentation.
 * Per LANGFUSE_TOOL_SPANS_NOT_LOGS: spans visible in Langfuse, not logged.
 */
export interface LangfuseSpanHandle {
  end: (params: {
    output?: unknown;
    level?: "DEFAULT" | "WARNING" | "ERROR";
    metadata?: Record<string, unknown>;
  }) => void;
  spanId: string;
}

/**
 * Port for optional Langfuse SDK integration.
 * Only wired when LANGFUSE_SECRET_KEY is set.
 *
 * Per OBSERVABILITY.md#langfuse-integration:
 * - Creates trace with scrubbed input at start
 * - Updates trace with scrubbed output on terminal
 * - Tool spans for tool execution tracking
 */
export interface LangfusePort {
  /**
   * Create a Langfuse trace with the given trace ID.
   * Uses traceId from OTel for correlation.
   *
   * @param traceId - OTel trace ID to use as Langfuse trace ID
   * @param metadata - Additional trace metadata
   * @returns The trace ID on success
   * @throws Error if trace creation fails
   */
  createTrace(
    traceId: string,
    metadata: {
      requestId: string;
      model: string;
      promptHash: string;
    }
  ): Promise<string>;

  // =========================================================================
  // Extended methods for ObservabilityGraphExecutorDecorator + ToolRunner
  // Per OBSERVABILITY.md#langfuse-integration
  // =========================================================================

  /**
   * Create a Langfuse trace with full I/O context.
   * Per LANGFUSE_NON_NULL_IO: input is set at creation; output on terminal.
   *
   * @param params - Trace creation params with input and metadata
   * @returns The trace ID (same as input traceId)
   */
  createTraceWithIO(params: CreateTraceWithIOParams): string;

  /**
   * Flush pending traces.
   * Only call if trace was created; never await on request path.
   */
  flush(): Promise<void>;

  /**
   * Record generation metrics on the trace.
   * Per GENERATION_UNDER_EXISTING_TRACE: attaches to trace created by decorator.
   *
   * @param traceId - The trace to update
   * @param generation - Generation metrics and optional content
   */
  recordGeneration(
    traceId: string,
    generation: {
      model: string;
      tokensIn?: number;
      tokensOut?: number;
      latencyMs: number;
      providerCostUsd?: number;
      status: InvocationStatus;
      errorCode?: LlmErrorKind;
      /** Optional scrubbed input for generation visibility */
      input?: unknown;
      /** Optional scrubbed output for generation visibility */
      output?: unknown;
    }
  ): void;

  /**
   * Create a span for tool execution.
   * Per LANGFUSE_TOOL_SPANS_NOT_LOGS: tool spans visible in Langfuse, not logged.
   *
   * @param params - Span creation params
   * @returns Span handle with end() method
   */
  startSpan(params: {
    traceId: string;
    name: string;
    input?: unknown;
    metadata?: Record<string, unknown>;
  }): LangfuseSpanHandle;

  /**
   * Update trace output on terminal resolution.
   * Per LANGFUSE_TERMINAL_ONCE_GUARD: called exactly once per trace.
   *
   * @param traceId - The trace to update
   * @param output - Scrubbed output content
   */
  updateTraceOutput(traceId: string, output: unknown): void;
}
