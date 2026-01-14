// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/ponderer/dev`
 * Purpose: Pre-compiled ponderer graph for LangGraph dev server.
 * Scope: Dev-only entrypoint. Reads env, instantiates LLM. NOT for production use.
 * Invariants:
 *   - Only used by langgraph.json for dev server
 *   - Uses LiteLLM via ChatOpenAI adapter
 *   - Empty tools array (tools not needed for dev server schema inspection)
 * Side-effects: process.env
 * Links: LANGGRAPH_SERVER.md
 * @internal
 */

import { ChatOpenAI } from "@langchain/openai";

import { createPondererGraph } from "./graph";

/**
 * Create LLM configured for LiteLLM proxy.
 * Uses OpenAI-compatible API via LiteLLM.
 *
 * P1: Move to langgraph-server package with proper config injection.
 */
function createDevLLM(): ChatOpenAI {
  // biome-ignore lint/style/noProcessEnv: Dev-only entrypoint, P1 will use config injection
  const baseURL = process.env.LITELLM_BASE_URL ?? "http://localhost:4000";
  // biome-ignore lint/style/noProcessEnv: Dev-only entrypoint, P1 will use config injection
  const apiKey = process.env.LITELLM_MASTER_KEY ?? "dev-key";

  return new ChatOpenAI({
    // MVP: Hardcoded. P1: Pass model via LangGraph configurable at runtime.
    model: "devstral",
    configuration: { baseURL },
    apiKey,
  });
}

/**
 * Pre-compiled ponderer graph for LangGraph dev server.
 * Exported as `ponderer` to match langgraph.json graph name.
 */
export const ponderer = createPondererGraph({
  llm: createDevLLM(),
  tools: [], // No tools for dev server MVP
});
