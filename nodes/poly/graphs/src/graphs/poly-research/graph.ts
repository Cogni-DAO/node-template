// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-graphs/graphs/poly-research/graph`
 * Purpose: Peer graph to poly-brain — patient wallet-research agent that returns a
 *          structured `PolyResearchReport` via LangGraph `responseFormat` (task.0368).
 * Scope: Pure factory. Does not load env, does not perform IO, does not import adapters.
 * Invariants: TYPE_TRANSPARENT_RETURN, PACKAGES_NO_ENV, GRAPH_PEER_NOT_NESTED.
 * Side-effects: none
 * Links: work/items/task.0368.poly-agent-wallet-research-v0.md
 * @public
 */

import type { CreateReactAgentGraphOptions } from "@cogni/langgraph-graphs/graphs";
import { MessagesAnnotation } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { PolyResearchReportSchema } from "./output-schema";
import { POLY_RESEARCH_SYSTEM_PROMPT } from "./prompts";

export const POLY_RESEARCH_GRAPH_NAME = "poly-research" as const;

/**
 * Create the poly-research ReAct agent graph.
 *
 * Structured output (`responseFormat`) is pinned to `PolyResearchReportSchema`
 * so the final message is always a parseable report, not free text.
 *
 * NOTE: Return type intentionally NOT annotated (TYPE_TRANSPARENT_RETURN).
 */
export function createPolyResearchGraph(opts: CreateReactAgentGraphOptions) {
  const { llm, tools } = opts;

  return createReactAgent({
    llm,
    tools: [...tools],
    messageModifier: POLY_RESEARCH_SYSTEM_PROMPT,
    stateSchema: MessagesAnnotation,
    responseFormat: {
      prompt:
        "Return the final `PolyResearchReport` object. No prose, no markdown — JSON only.",
      schema: PolyResearchReportSchema,
    },
  });
}
