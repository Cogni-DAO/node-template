// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/tools/present-node-summary`
 * Purpose: Display-only tool that renders a node creation summary card in the chat UI.
 * Scope: AI calls this at the end of node creation to show the final status.
 *   Client renders NodeSummaryCard via makeAssistantToolUI.
 * Invariants:
 *   - TOOL_ID_NAMESPACED: ID is `core__present_node_summary`
 *   - EFFECT_TYPED: effect is `read_only` (pure, no side effects)
 *   - Display-only: exists to create a typed tool-call event for client rendering
 *   - NO LangChain imports
 * Side-effects: none
 * Links: work/items/task.0260.node-creation-chat-orchestration.md
 * @public
 */

import { z } from "zod";

import type { BoundTool, ToolContract, ToolImplementation } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const PresentNodeSummaryInputSchema = z.object({
  name: z.string().describe("Node slug"),
  displayName: z.string().describe("Human-readable node name"),
  mission: z.string().describe("One-sentence mission"),
  port: z.number().int().describe("Local dev port"),
  prUrl: z.string().url().describe("Pull request URL"),
  dnsRecord: z.string().optional().describe("DNS subdomain (e.g., resy.nodes.cognidao.org)"),
  daoAddress: z.string().optional().describe("DAO contract address"),
});
export type PresentNodeSummaryInput = z.infer<typeof PresentNodeSummaryInputSchema>;

export const PresentNodeSummaryOutputSchema = z.object({
  status: z.literal("complete"),
});
export type PresentNodeSummaryOutput = z.infer<typeof PresentNodeSummaryOutputSchema>;

export type PresentNodeSummaryRedacted = PresentNodeSummaryOutput;

// ─────────────────────────────────────────────────────────────────────────────
// Contract
// ─────────────────────────────────────────────────────────────────────────────

export const PRESENT_NODE_SUMMARY_NAME = "core__present_node_summary" as const;

export const presentNodeSummaryContract: ToolContract<
  typeof PRESENT_NODE_SUMMARY_NAME,
  PresentNodeSummaryInput,
  PresentNodeSummaryOutput,
  PresentNodeSummaryRedacted
> = {
  name: PRESENT_NODE_SUMMARY_NAME,
  description:
    "Present a summary of the completed node creation. Renders a card showing the node name, mission, dev port, PR link, DNS record, and DAO address.",
  effect: "read_only",
  inputSchema: PresentNodeSummaryInputSchema,
  outputSchema: PresentNodeSummaryOutputSchema,

  redact: (output: PresentNodeSummaryOutput): PresentNodeSummaryRedacted => output,
  allowlist: ["status"] as const,
};

// ─────────────────────────────────────────────────────────────────────────────
// Implementation (display-only — returns static status)
// ─────────────────────────────────────────────────────────────────────────────

export const presentNodeSummaryImplementation: ToolImplementation<
  PresentNodeSummaryInput,
  PresentNodeSummaryOutput
> = {
  execute: async (
    _input: PresentNodeSummaryInput
  ): Promise<PresentNodeSummaryOutput> => {
    return { status: "complete" };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Bound Tool
// ─────────────────────────────────────────────────────────────────────────────

export const presentNodeSummaryBoundTool: BoundTool<
  typeof PRESENT_NODE_SUMMARY_NAME,
  PresentNodeSummaryInput,
  PresentNodeSummaryOutput,
  PresentNodeSummaryRedacted
> = {
  contract: presentNodeSummaryContract,
  implementation: presentNodeSummaryImplementation,
};
