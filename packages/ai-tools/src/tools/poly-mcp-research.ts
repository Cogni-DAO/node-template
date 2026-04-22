// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/tools/poly-mcp`
 * Purpose: AI tool for Polymarket MCP server - market analysis with AI recommendations.
 * Scope: Calls Poly MCP HTTP APIs (not MCP protocol) for market research.
 * Invariants:
 *   - TOOL_ID_NAMESPACED: ID is `core__poly_mcp_research`
 *   - EFFECT_TYPED: effect is `read_only`
 *   - NO LangChain imports
 * Side-effects: IO (HTTP to Poly MCP container)
 * Links: docs/guides/poly-mcp-v0-plan.md
 * @public
 */

import { z } from "zod";

import type { BoundTool, ToolContract, ToolImplementation } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Config (injected at runtime)
// ─────────────────────────────────────────────────────────────────────────────

export interface PolyMcpConfig {
  readonly baseUrl: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const PolyMcpResearchInputSchema = z.object({
  action: z
    .enum(["analyze", "search", "trending", "details"])
    .describe(
      "Action: analyze market opportunity, search markets, get trending, or get market details"
    ),
  marketId: z
    .string()
    .optional()
    .describe("Market ID (required for analyze, details actions)"),
  searchQuery: z
    .string()
    .max(200)
    .optional()
    .describe("Search query (for search action)"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("Result limit (default 10)"),
});
export type PolyMcpResearchInput = z.infer<typeof PolyMcpResearchInputSchema>;

export const PolyMcpResearchOutputSchema = z.object({
  action: z.string(),
  result: z.unknown(),
});
export type PolyMcpResearchOutput = z.infer<typeof PolyMcpResearchOutputSchema>;

export type PolyMcpResearchRedacted = PolyMcpResearchOutput;

// ─────────────────────────────────────────────────────────────────────────────
// Contract
// ─────────────────────────────────────────────────────────────────────────────

export const POLY_MCP_RESEARCH_NAME = "core__poly_mcp_research" as const;

export const polyMcpResearchContract: ToolContract<
  typeof POLY_MCP_RESEARCH_NAME,
  PolyMcpResearchInput,
  PolyMcpResearchOutput,
  PolyMcpResearchRedacted
> = {
  name: POLY_MCP_RESEARCH_NAME,
  description:
    "Polymarket research via MCP server - analyze markets with AI recommendations, " +
    "search markets, get trending markets. Provides deeper analysis than basic market listing.",
  effect: "read_only",
  inputSchema: PolyMcpResearchInputSchema,
  outputSchema: PolyMcpResearchOutputSchema,
  redact: (output: PolyMcpResearchOutput): PolyMcpResearchRedacted => output,
  allowlist: ["action", "result"] as const,
};

// ─────────────────────────────────────────────────────────────────────────────
// Implementation factory
// ─────────────────────────────────────────────────────────────────────────────

export interface PolyMcpResearchDeps {
  polyMcpConfig: PolyMcpConfig;
}

export function createPolyMcpResearchImplementation(
  deps: PolyMcpResearchDeps
): ToolImplementation<PolyMcpResearchInput, PolyMcpResearchOutput> {
  return {
    execute: async (
      input: PolyMcpResearchInput
    ): Promise<PolyMcpResearchOutput> => {
      const { baseUrl } = deps.polyMcpConfig;
      let endpoint = "";
      let result: unknown;

      switch (input.action) {
        case "analyze":
          if (!input.marketId) throw new Error("marketId required for analyze");
          endpoint = `${baseUrl}/api/markets/${input.marketId}/analyze`;
          break;
        case "search":
          endpoint = `${baseUrl}/api/markets/search?q=${encodeURIComponent(input.searchQuery || "")}&limit=${input.limit || 10}`;
          break;
        case "trending":
          endpoint = `${baseUrl}/api/markets/trending?limit=${input.limit || 10}`;
          break;
        case "details":
          if (!input.marketId) throw new Error("marketId required for details");
          endpoint = `${baseUrl}/api/markets/${input.marketId}`;
          break;
        default:
          throw new Error(`Unknown action: ${input.action}`);
      }

      const response = await fetch(endpoint);
      if (!response.ok) {
        throw new Error(
          `Poly MCP API error: ${response.status} ${response.statusText}`
        );
      }
      result = await response.json();

      return { action: input.action, result };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stub implementation
// ─────────────────────────────────────────────────────────────────────────────

export const polyMcpResearchStubImplementation: ToolImplementation<
  PolyMcpResearchInput,
  PolyMcpResearchOutput
> = {
  execute: async (): Promise<PolyMcpResearchOutput> => ({
    action: "stub",
    result: { error: "Poly MCP not configured" },
  }),
};

// ─────────────────────────────────────────────────────────────────────────────
// Bound Tool
// ─────────────────────────────────────────────────────────────────────────────

export const polyMcpResearchBoundTool: BoundTool<
  typeof POLY_MCP_RESEARCH_NAME,
  PolyMcpResearchInput,
  PolyMcpResearchOutput,
  PolyMcpResearchRedacted
> = {
  contract: polyMcpResearchContract,
  implementation: polyMcpResearchStubImplementation,
};
