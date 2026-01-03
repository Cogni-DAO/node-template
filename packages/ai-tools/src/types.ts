// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/types`
 * Purpose: Core type definitions for tool contracts and implementations.
 * Scope: Defines ToolContract, ToolImplementation, BoundTool. Does NOT import @langchain.
 * Invariants:
 *   - Pure types only, no runtime logic
 *   - NO LangChain imports (LangChain wrapping lives in langgraph-graphs)
 *   - Tools are pure functions with Zod validation
 * Side-effects: none (types only)
 * Links: LANGGRAPH_AI.md, TOOL_USE_SPEC.md
 * @public
 */

/**
 * Tool execution result shape.
 * Per TOOLRUNNER_RESULT_SHAPE: exec() returns this discriminated union.
 */
export type ToolResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly errorCode: ToolErrorCode;
      readonly safeMessage: string;
    };

/**
 * Tool error codes.
 * Per TOOLRUNNER_RESULT_SHAPE: standardized error classification.
 */
export type ToolErrorCode =
  | "validation"
  | "execution"
  | "unavailable"
  | "redaction_failed";

/**
 * Tool contract definition.
 * Defines schema and interface for a tool without implementation.
 */
export interface ToolContract<
  TName extends string,
  TInput,
  TOutput,
  TRedacted,
> {
  /** Stable tool name (snake_case) */
  readonly name: TName;
  /** Human-readable description for LLM */
  readonly description: string;
  /** Validate input args, throws on invalid */
  readonly validateInput: (input: unknown) => TInput;
  /** Validate output, throws on invalid */
  readonly validateOutput: (output: unknown) => TOutput;
  /** Redact output to UI-safe fields */
  readonly redact: (output: TOutput) => TRedacted;
  /** Allowlisted fields that appear in redacted output */
  readonly allowlist: ReadonlyArray<keyof TOutput>;
}

/**
 * Tool implementation interface.
 * Adapters implement this; receives validated input, returns raw output.
 */
export interface ToolImplementation<TInput, TOutput> {
  /** Execute the tool with validated input */
  readonly execute: (input: TInput) => Promise<TOutput>;
}

/**
 * Bound tool: contract + implementation together.
 * Created by package, consumed by tool-runner.
 */
export interface BoundTool<TName extends string, TInput, TOutput, TRedacted> {
  readonly contract: ToolContract<TName, TInput, TOutput, TRedacted>;
  readonly implementation: ToolImplementation<TInput, TOutput>;
}
