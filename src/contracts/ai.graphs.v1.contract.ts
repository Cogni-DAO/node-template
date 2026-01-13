// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/ai.graphs.v1.contract`
 * Purpose: Defines operation contract for listing available graph agents.
 * Scope: Provides Zod schema and types for graphs list endpoint wire format. Does not implement business logic.
 * Invariants: Contract remains stable; breaking changes require new version. All consumers use z.infer types.
 * Side-effects: none
 * Notes: GraphIds are namespaced as ${providerId}:${graphName} and remain stable across execution backends.
 * Links: /api/v1/ai/graphs route, GraphPicker component, GRAPH_EXECUTION.md
 * @internal
 */

import { z } from "zod";

/**
 * Graph capabilities schema.
 * Used for UI display and feature gating.
 */
export const GraphCapabilitiesSchema = z.object({
  supportsStreaming: z.boolean(),
  supportsTools: z.boolean(),
  supportsMemory: z.boolean(),
});

/**
 * Graph descriptor schema.
 * Per GRAPH_ID_NAMESPACED: graphId format is "${providerId}:${graphName}" (e.g., "langgraph:poet").
 */
export const GraphDescriptorSchema = z.object({
  graphId: z.string(),
  displayName: z.string(),
  description: z.string(),
  capabilities: GraphCapabilitiesSchema,
});

/**
 * Graphs list response.
 * - graphs: Array of available graph descriptors
 * - defaultGraphId: Default graph to use when none specified (first graph in list)
 */
export const aiGraphsOperation = {
  id: "ai.graphs.v1",
  summary: "List available graph agents",
  description:
    "Returns list of available graph agents with capabilities. GraphIds are stable across execution backends (InProc/Server).",
  input: z.object({}), // No input, GET request
  output: z.object({
    graphs: z.array(GraphDescriptorSchema),
    defaultGraphId: z.string().nullable(),
  }),
} as const;

// Export inferred types - all consumers MUST use these, never manual interfaces
export type GraphCapabilities = z.infer<typeof GraphCapabilitiesSchema>;
export type GraphDescriptor = z.infer<typeof GraphDescriptorSchema>;
export type GraphsOutput = z.infer<typeof aiGraphsOperation.output>;
