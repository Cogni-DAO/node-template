// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/tools/request-dao-formation`
 * Purpose: Display-only tool that renders a DAO formation card with inline wallet signing.
 * Scope: Display-only tool for DAO formation card rendering. Does NOT perform wallet signing or modify formation logic.
 * Invariants:
 *   - TOOL_ID_NAMESPACED: ID is `core__request_dao_formation`
 *   - EFFECT_TYPED: effect is `read_only` (tool itself is pure; wallet signing is client-side)
 *   - Display-only: exists to create a typed tool-call event for client rendering
 *   - FORMATION_LOGIC_UNCHANGED: does NOT modify formation.reducer.ts or txBuilders.ts
 *   - NO LangChain imports
 * Side-effects: none (wallet signing happens client-side, not in this tool)
 * Links: work/items/task.0261.node-creation-chat-orchestration.md
 * @public
 */

import { z } from "zod";

import type { BoundTool, ToolContract, ToolImplementation } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const RequestDaoFormationInputSchema = z.object({
  tokenName: z
    .string()
    .min(1)
    .max(64)
    .describe("Governance token name (e.g., 'Resy Governance')"),
  tokenSymbol: z
    .string()
    .min(1)
    .max(10)
    .describe("Token symbol (e.g., 'RESY')"),
});
export type RequestDaoFormationInput = z.infer<
  typeof RequestDaoFormationInputSchema
>;

export const RequestDaoFormationOutputSchema = z.object({
  status: z.literal("awaiting_wallet_action"),
});
export type RequestDaoFormationOutput = z.infer<
  typeof RequestDaoFormationOutputSchema
>;

export type RequestDaoFormationRedacted = RequestDaoFormationOutput;

// ─────────────────────────────────────────────────────────────────────────────
// Contract
// ─────────────────────────────────────────────────────────────────────────────

export const REQUEST_DAO_FORMATION_NAME =
  "core__request_dao_formation" as const;

export const requestDaoFormationContract: ToolContract<
  typeof REQUEST_DAO_FORMATION_NAME,
  RequestDaoFormationInput,
  RequestDaoFormationOutput,
  RequestDaoFormationRedacted
> = {
  name: REQUEST_DAO_FORMATION_NAME,
  description:
    "Request DAO formation with inline wallet signing. Renders a formation card in the chat where the user connects their wallet and signs 2 transactions (create DAO + deploy CogniSignal). The user clicks Continue when done to send the repo-spec result back to the conversation.",
  effect: "read_only",
  inputSchema: RequestDaoFormationInputSchema,
  outputSchema: RequestDaoFormationOutputSchema,

  redact: (output: RequestDaoFormationOutput): RequestDaoFormationRedacted =>
    output,
  allowlist: ["status"] as const,
};

// ─────────────────────────────────────────────────────────────────────────────
// Implementation (display-only — returns static status)
// ─────────────────────────────────────────────────────────────────────────────

export const requestDaoFormationImplementation: ToolImplementation<
  RequestDaoFormationInput,
  RequestDaoFormationOutput
> = {
  execute: async (
    _input: RequestDaoFormationInput
  ): Promise<RequestDaoFormationOutput> => {
    return { status: "awaiting_wallet_action" };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Bound Tool
// ─────────────────────────────────────────────────────────────────────────────

export const requestDaoFormationBoundTool: BoundTool<
  typeof REQUEST_DAO_FORMATION_NAME,
  RequestDaoFormationInput,
  RequestDaoFormationOutput,
  RequestDaoFormationRedacted
> = {
  contract: requestDaoFormationContract,
  implementation: requestDaoFormationImplementation,
};
