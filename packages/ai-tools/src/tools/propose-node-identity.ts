// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/tools/propose-node-identity`
 * Purpose: Display-only tool that renders an identity proposal card in the chat UI.
 * Scope: AI calls this with proposed node identity fields. Server returns static status.
 *   Client renders IdentityProposalCard via makeAssistantToolUI. No server-side I/O.
 * Invariants:
 *   - TOOL_ID_NAMESPACED: ID is `core__propose_node_identity`
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

export const ProposeNodeIdentityInputSchema = z.object({
  name: z.string().min(1).max(32).describe("Node slug (lowercase, one word)"),
  icon: z.string().describe("Lucide icon name (e.g., 'Activity', 'UtensilsCrossed')"),
  hue: z.number().min(0).max(360).describe("Primary HSL hue for theme colors"),
  mission: z.string().min(1).max(200).describe("One-sentence mission statement"),
  tokenName: z.string().min(1).max(64).describe("DAO governance token name"),
  tokenSymbol: z.string().min(1).max(10).describe("DAO governance token symbol"),
});
export type ProposeNodeIdentityInput = z.infer<typeof ProposeNodeIdentityInputSchema>;

export const ProposeNodeIdentityOutputSchema = z.object({
  status: z.literal("awaiting_confirmation"),
});
export type ProposeNodeIdentityOutput = z.infer<typeof ProposeNodeIdentityOutputSchema>;

export type ProposeNodeIdentityRedacted = ProposeNodeIdentityOutput;

// ─────────────────────────────────────────────────────────────────────────────
// Contract
// ─────────────────────────────────────────────────────────────────────────────

export const PROPOSE_NODE_IDENTITY_NAME = "core__propose_node_identity" as const;

export const proposeNodeIdentityContract: ToolContract<
  typeof PROPOSE_NODE_IDENTITY_NAME,
  ProposeNodeIdentityInput,
  ProposeNodeIdentityOutput,
  ProposeNodeIdentityRedacted
> = {
  name: PROPOSE_NODE_IDENTITY_NAME,
  description:
    "Propose a node identity for the user to review. Renders an interactive card showing the proposed name, icon, theme, mission, and DAO token details. The user can edit fields and confirm. Token name and symbol can be changed later via governance; all other fields are immutable after formation.",
  effect: "read_only",
  inputSchema: ProposeNodeIdentityInputSchema,
  outputSchema: ProposeNodeIdentityOutputSchema,

  redact: (output: ProposeNodeIdentityOutput): ProposeNodeIdentityRedacted => output,
  allowlist: ["status"] as const,
};

// ─────────────────────────────────────────────────────────────────────────────
// Implementation (display-only — returns static status)
// ─────────────────────────────────────────────────────────────────────────────

export const proposeNodeIdentityImplementation: ToolImplementation<
  ProposeNodeIdentityInput,
  ProposeNodeIdentityOutput
> = {
  execute: async (
    _input: ProposeNodeIdentityInput
  ): Promise<ProposeNodeIdentityOutput> => {
    return { status: "awaiting_confirmation" };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Bound Tool
// ─────────────────────────────────────────────────────────────────────────────

export const proposeNodeIdentityBoundTool: BoundTool<
  typeof PROPOSE_NODE_IDENTITY_NAME,
  ProposeNodeIdentityInput,
  ProposeNodeIdentityOutput,
  ProposeNodeIdentityRedacted
> = {
  contract: proposeNodeIdentityContract,
  implementation: proposeNodeIdentityImplementation,
};
