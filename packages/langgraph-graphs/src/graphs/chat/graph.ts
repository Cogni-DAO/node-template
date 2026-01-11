// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/chat/graph`
 * Purpose: Simple React agent graph factory for chat functionality.
 * Scope: Creates LangGraph React agent with injected LLM and tools. Does NOT execute graphs or read env.
 * Invariants:
 *   - Pure factory function — no side effects, no env reads
 *   - LLM and tools are injected, not instantiated
 *   - Uses shared InvokableGraph type (no per-graph interface duplication)
 * Side-effects: none
 * Links: LANGGRAPH_AI.md, AGENT_DEVELOPMENT_GUIDE.md
 * @public
 */

import { createReactAgent } from "@langchain/langgraph/prebuilt";

import {
  asInvokableGraph,
  type CreateReactAgentGraphOptions,
  type InvokableGraph,
  type MessageGraphInput,
  type MessageGraphOutput,
} from "../types";
import { CHAT_SYSTEM_PROMPT } from "./prompts";

/**
 * Graph name constant for routing.
 */
export const CHAT_GRAPH_NAME = "chat" as const;

/**
 * Chat graph type alias.
 * Uses shared InvokableGraph interface — no per-graph interface duplication.
 */
export type ChatGraph = InvokableGraph<MessageGraphInput, MessageGraphOutput>;

/**
 * Create a simple React agent graph for chat.
 *
 * This is the simplest possible LangGraph agent:
 * - Uses createReactAgent (prebuilt pattern)
 * - LLM handles tool calling decisions
 * - Agent loops until no more tool calls needed
 *
 * @param opts - Options with LLM and tools
 * @returns Compiled LangGraph ready for invoke()
 *
 * @example
 * ```typescript
 * const llm = new CompletionUnitLLM(completionFn, "gpt-4");
 * const tools = toLangChainTools({ contracts, exec: toolRunner.exec });
 * const graph = createChatGraph({ llm, tools });
 *
 * const result = await graph.invoke({
 *   messages: [new HumanMessage("What time is it?")]
 * });
 * ```
 */
export function createChatGraph(opts: CreateReactAgentGraphOptions): ChatGraph {
  const { llm, tools } = opts;

  // Use LangGraph's prebuilt React agent
  // This handles the standard ReAct loop:
  // 1. LLM generates response (possibly with tool calls)
  // 2. If tool calls, execute them and loop back
  // 3. If no tool calls, return final response
  const agent = createReactAgent({
    llm,
    tools: [...tools], // Spread readonly array to mutable for LangGraph
    messageModifier: CHAT_SYSTEM_PROMPT,
  });

  // Centralized cast with runtime assertion
  return asInvokableGraph<MessageGraphInput, MessageGraphOutput>(agent);
}
