// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/ai/tools/get-current-time`
 * Purpose: LLM tool definition wrapper for get_current_time.
 * Scope: Re-exports from @cogni/ai-tools, adds LLM-specific definition using @/ports types.
 * Invariants:
 *   - Pure tool logic lives in @cogni/ai-tools package
 *   - Only LLM definition (using @/ports) defined here
 * Side-effects: none
 * Notes: Per LANGGRAPH_AI.md - tool contracts in packages, LLM wrappers in features
 * Links: @cogni/ai-tools, tool-registry.ts, TOOL_USE_SPEC.md
 * @public
 */

import type { JsonSchemaObject, LlmToolDefinition } from "@/ports";

// Re-export pure tool from package
export {
  GET_CURRENT_TIME_NAME,
  type GetCurrentTimeInput,
  GetCurrentTimeInputSchema,
  type GetCurrentTimeOutput,
  GetCurrentTimeOutputSchema,
  type GetCurrentTimeRedacted,
  getCurrentTimeBoundTool,
  getCurrentTimeContract,
  getCurrentTimeImplementation,
} from "@cogni/ai-tools";

import { GET_CURRENT_TIME_NAME, getCurrentTimeContract } from "@cogni/ai-tools";

// ─────────────────────────────────────────────────────────────────────────────
// LLM Tool Definition (OpenAI-compatible format)
// Uses @/ports types, so defined here rather than in package
// ─────────────────────────────────────────────────────────────────────────────

/**
 * JSON Schema for tool parameters (OpenAI function-calling format)
 */
export const getCurrentTimeJsonSchema: JsonSchemaObject = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
};

/**
 * LLM tool definition for get_current_time
 */
export const getCurrentTimeLlmDefinition: LlmToolDefinition = {
  type: "function",
  function: {
    name: GET_CURRENT_TIME_NAME,
    description: getCurrentTimeContract.description,
    parameters: getCurrentTimeJsonSchema,
  },
};
