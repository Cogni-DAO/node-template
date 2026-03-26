// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/crew-orchestrator/graph`
 * Purpose: Crew orchestrator graph — deploys MCP server + AI agent crews to Akash.
 * Scope: Creates a React agent graph with crew deployment tools. Does NOT execute tools directly.
 * Invariants:
 *   - PURE_FACTORY: No side effects, no env reads
 *   - SINGLE_INVOKABLE_INTERFACE: Returns InvokableGraph<MessageGraphInput, MessageGraphOutput>
 *   - TOOL_CALLING_AGENT: Uses createReactAgent pattern with deployment tools
 * Side-effects: none
 * Links: docs/spec/akash-deploy-service.md
 */

import type { AkashDeployPort } from "@cogni/akash-client";
import type { LanguageModelLike } from "@langchain/core/language_models/base";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { CREW_ORCHESTRATOR_SYSTEM_PROMPT } from "./prompts.js";
import {
  type CrewOrchestratorToolDeps,
  createCrewOrchestratorTools,
} from "./tools.js";

export const CREW_ORCHESTRATOR_GRAPH_NAME = "crew-orchestrator" as const;

export interface CreateCrewOrchestratorOptions {
  llm: LanguageModelLike;
  deployer: AkashDeployPort;
}

/**
 * Create the crew orchestrator graph.
 *
 * This is a React agent (tool-calling loop) that can:
 * - Parse natural language crew descriptions
 * - Resolve MCP servers from the registry
 * - Generate deployment plans with cost estimates
 * - Deploy crews to the Akash network
 * - Monitor deployment status
 *
 * Usage:
 * ```ts
 * const graph = createCrewOrchestratorGraph({ llm: myLlm, deployer: myDeployer });
 * const result = await graph.invoke({
 *   messages: [{ role: "user", content: "Deploy a research crew with GitHub and filesystem MCP" }]
 * });
 * ```
 */
export function createCrewOrchestratorGraph(
  options: CreateCrewOrchestratorOptions
) {
  const { llm, deployer } = options;

  const deps: CrewOrchestratorToolDeps = { deployer };
  const tools = createCrewOrchestratorTools(deps);

  return createReactAgent({
    llm,
    tools,
    prompt: CREW_ORCHESTRATOR_SYSTEM_PROMPT,
  });
}
