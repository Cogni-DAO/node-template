// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/tools/present-pr`
 * Purpose: Display-only tool that renders a PR review card in the chat UI.
 * Scope: Display-only tool for PR review card rendering. Does NOT interact with GitHub or modify PR state.
 * Invariants:
 *   - TOOL_ID_NAMESPACED: ID is `core__present_pr`
 *   - EFFECT_TYPED: effect is `read_only` (pure, no side effects)
 *   - Display-only: exists to create a typed tool-call event for client rendering
 *   - NO LangChain imports
 * Side-effects: none
 * Links: work/items/task.0261.node-creation-chat-orchestration.md
 * @public
 */

import { z } from "zod";

import type { BoundTool, ToolContract, ToolImplementation } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const PresentPrInputSchema = z.object({
  url: z.string().url().describe("Pull request URL"),
  title: z.string().describe("PR title"),
  summary: z.string().describe("One-paragraph summary of changes"),
  filesChanged: z
    .number()
    .int()
    .nonnegative()
    .describe("Number of files changed"),
  additions: z.number().int().nonnegative().describe("Lines added"),
  deletions: z.number().int().nonnegative().describe("Lines removed"),
});
export type PresentPrInput = z.infer<typeof PresentPrInputSchema>;

export const PresentPrOutputSchema = z.object({
  status: z.literal("awaiting_review"),
});
export type PresentPrOutput = z.infer<typeof PresentPrOutputSchema>;

export type PresentPrRedacted = PresentPrOutput;

// ─────────────────────────────────────────────────────────────────────────────
// Contract
// ─────────────────────────────────────────────────────────────────────────────

export const PRESENT_PR_NAME = "core__present_pr" as const;

export const presentPrContract: ToolContract<
  typeof PRESENT_PR_NAME,
  PresentPrInput,
  PresentPrOutput,
  PresentPrRedacted
> = {
  name: PRESENT_PR_NAME,
  description:
    "Present a pull request for the user to review. Renders a card with diff stats, summary, and a link to the PR. The user reviews and sends their approval or feedback.",
  effect: "read_only",
  inputSchema: PresentPrInputSchema,
  outputSchema: PresentPrOutputSchema,

  redact: (output: PresentPrOutput): PresentPrRedacted => output,
  allowlist: ["status"] as const,
};

// ─────────────────────────────────────────────────────────────────────────────
// Implementation (display-only — returns static status)
// ─────────────────────────────────────────────────────────────────────────────

export const presentPrImplementation: ToolImplementation<
  PresentPrInput,
  PresentPrOutput
> = {
  execute: async (_input: PresentPrInput): Promise<PresentPrOutput> => {
    return { status: "awaiting_review" };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Bound Tool
// ─────────────────────────────────────────────────────────────────────────────

export const presentPrBoundTool: BoundTool<
  typeof PRESENT_PR_NAME,
  PresentPrInput,
  PresentPrOutput,
  PresentPrRedacted
> = {
  contract: presentPrContract,
  implementation: presentPrImplementation,
};
