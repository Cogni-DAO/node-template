// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-core/tooling/types`
 * Purpose: Canonical semantic types for tool definitions, invocations, and execution.
 * Scope: Framework-agnostic types for tool definitions and execution. Does NOT import Zod — uses JSONSchema7 for wire formats.
 * Invariants:
 *   - TOOL_SEMANTICS_CANONICAL: These are the canonical types; wire formats are adapters
 *   - TOOL_EXEC_TYPES_IN_AI_CORE: ToolExecFn, ToolExecResult, EmitAiEvent defined here
 *   - EFFECT_TYPED: ToolEffect declares side-effect level for policy decisions
 *   - No Zod dependency — compiled from @cogni/ai-tools via toToolSpec()
 *   - ToolSpec uses JSONSchema7 for inputSchema (compiled from Zod)
 * Side-effects: none (types only)
 * Links: TOOL_USE_SPEC.md, GRAPH_EXECUTION.md
 * @public
 */

import type { JSONSchema7 } from "json-schema";

import type { AiEvent } from "../events/ai-events";

/**
 * Tool effect level for policy decisions.
 * Per EFFECT_TYPED invariant: every tool declares its side-effect level.
 */
export type ToolEffect = "read_only" | "state_change" | "external_side_effect";

/**
 * Redaction mode for tool output.
 * P0 supports only top_level_only — filter top-level keys by allowlist.
 */
export type RedactionMode = "top_level_only";

/**
 * Redaction configuration for tool output.
 */
export interface ToolRedactionConfig {
  /** Redaction strategy (P0: top_level_only) */
  readonly mode: RedactionMode;
  /** Fields that are safe to expose to UI/logs */
  readonly allowlist: readonly string[];
}

/**
 * Tool specification — canonical definition for wire formats.
 *
 * This is the compiled form of ToolContract (Zod → JSONSchema7).
 * Used by wire encoders (OpenAI, Anthropic) to emit tool definitions.
 *
 * Per TOOL_SEMANTICS_CANONICAL: inputSchema must conform to P0-supported
 * JSONSchema subset. Disallow oneOf/anyOf/allOf/not/if-then-else/patternProperties.
 */
export interface ToolSpec {
  /** Stable tool name (snake_case, namespaced: core:tool_name) */
  readonly name: string;
  /** Human-readable description for LLM */
  readonly description: string;
  /** JSONSchema7 for input validation (compiled from Zod) */
  readonly inputSchema: JSONSchema7;
  /** Side-effect level for policy decisions */
  readonly effect: ToolEffect;
  /** Redaction config for output */
  readonly redaction: ToolRedactionConfig;
  /**
   * Hash of the compiled schema for drift detection and promptHash computation.
   * Optional for P0. Compute in Node-only layer with stable stringify if needed.
   */
  readonly schemaHash?: string;
}

/**
 * Known error codes for tool execution failures.
 * Extensible union for future error types.
 */
export type ToolErrorCode =
  | "validation"
  | "execution"
  | "unavailable"
  | "redaction_failed"
  | "invalid_json"
  | "timeout"
  | "policy_denied";

/**
 * Tool invocation record — captures full lifecycle of a tool call.
 *
 * Used for:
 * - Telemetry/observability
 * - Passing tool results back to LLM
 * - Audit logging
 *
 * Per TOOL_SEMANTICS_CANONICAL: `raw` preserves provider-native payload
 * for observability only; must be redacted/omitted from UI/logs.
 */
export interface ToolInvocationRecord {
  /** Stable ID for this tool call (model-provided or UUID) */
  readonly toolCallId: string;
  /** Tool name that was invoked */
  readonly name: string;
  /** Parsed arguments passed to tool (flexible shape) */
  readonly args: unknown;
  /** Tool execution result (redacted for UI safety, flexible shape) */
  readonly result?: unknown;
  /** Error info if tool execution failed */
  readonly error?: {
    readonly code: ToolErrorCode;
    readonly message: string;
  };
  /** When tool execution started (epoch milliseconds for serialization) */
  readonly startedAtMs: number;
  /** When tool execution completed (epoch milliseconds) */
  readonly endedAtMs?: number;
  /**
   * Raw provider-native payload for observability.
   * Must be redacted/omitted from UI/logs. Never influences execution or billing.
   */
  readonly raw?: unknown;
}

// -----------------------------------------------------------------------------
// Tool Contract Runtime Types (minimal interface for tool-runner)
// -----------------------------------------------------------------------------

/**
 * Minimal schema interface for tool-runner.
 * Compatible with Zod schemas but doesn't require Zod import.
 */
export interface ParseableSchema {
  parse(input: unknown): unknown;
}

/**
 * Minimal tool contract interface for tool-runner.
 * ai-tools implements this with full Zod schemas; ai-core only sees this interface.
 * Policy/allowlist belongs in ToolPolicy, not here.
 */
export interface ToolContractRuntime {
  readonly name: string;
  readonly effect: ToolEffect;
  readonly inputSchema: ParseableSchema;
  readonly outputSchema: ParseableSchema;
  readonly redact: (output: unknown) => unknown;
}

/**
 * Minimal tool implementation interface for tool-runner.
 */
export interface ToolImplementationRuntime {
  readonly execute: (input: unknown) => Promise<unknown>;
}

/**
 * Bound tool: contract + implementation.
 * This is the runtime interface consumed by tool-runner.
 */
export interface BoundToolRuntime {
  readonly contract: ToolContractRuntime;
  readonly implementation: ToolImplementationRuntime;
}

/**
 * Tool result from implementation (pre-redaction).
 * Structurally identical to ToolExecResult but semantically distinct layer.
 */
export type ToolResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly errorCode: ToolErrorCode;
      readonly safeMessage: string;
    };

// -----------------------------------------------------------------------------
// Tool Execution Types (canonical location per TOOL_EXEC_TYPES_IN_AI_CORE)
// -----------------------------------------------------------------------------

/**
 * Callback for emitting AiEvents during tool execution.
 * Used by tool-runner to stream events to runtime.
 * Per TOOL_EXEC_TYPES_IN_AI_CORE: canonical definition in @cogni/ai-core.
 */
export type EmitAiEvent = (event: AiEvent) => void;

/**
 * Tool execution result shape.
 * Per TOOLRUNNER_RESULT_SHAPE: exec() returns this discriminated union.
 */
export type ToolExecResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly errorCode: ToolErrorCode;
      readonly safeMessage: string;
    };

/**
 * Tool execution function signature.
 * Used by graphs to invoke tools via toolRunner.
 *
 * @param toolName - Namespaced tool name (e.g., "core:get_current_time")
 * @param args - Tool arguments (validated by caller)
 * @param toolCallId - Optional model-provided tool call ID
 * @returns Tool result with redacted value on success, error info on failure
 */
export type ToolExecFn = (
  toolName: string,
  args: unknown,
  toolCallId?: string
) => Promise<ToolExecResult<Record<string, unknown>>>;
