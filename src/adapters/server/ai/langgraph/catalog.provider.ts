// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/ai/langgraph/catalog.provider`
 * Purpose: Discovery-only provider for LangGraph catalog.
 * Scope: Implements GraphProvider for listing graphs. Throws on runGraph(). Does NOT require execution infrastructure.
 * Invariants:
 *   - DISCOVERY_NO_EXECUTION_DEPS: No CompletionUnitAdapter or completion deps required
 *   - REGISTRY_SEPARATION: This provider is for discovery only, never execution
 *   - GRAPH_ID_NAMESPACED: graphId format is "langgraph:${graphName}"
 * Side-effects: none
 * Links: AGENT_DISCOVERY.md, GRAPH_EXECUTION.md, graph-provider.ts
 * @internal
 */

import { LANGGRAPH_CATALOG } from "@cogni/langgraph-graphs";

import type { GraphRunRequest, GraphRunResult } from "@/ports";

import type {
  GraphCapabilities,
  GraphDescriptor,
  GraphProvider,
} from "../graph-provider";

/**
 * LangGraph provider ID for namespacing.
 */
export const LANGGRAPH_CATALOG_PROVIDER_ID = "langgraph" as const;

/**
 * Discovery-only provider for LangGraph catalog.
 *
 * Per DISCOVERY_NO_EXECUTION_DEPS: this provider does not require
 * CompletionUnitAdapter or any execution infrastructure. It only
 * reads from the static LANGGRAPH_CATALOG.
 *
 * Per REGISTRY_SEPARATION: this provider should only be used in
 * the discovery registry, never in the execution registry.
 * Use LangGraphInProcProvider for execution.
 */
export class LangGraphCatalogProvider implements GraphProvider {
  readonly providerId = LANGGRAPH_CATALOG_PROVIDER_ID;
  private readonly graphDescriptors: readonly GraphDescriptor[];

  constructor() {
    // Build descriptors from catalog at construction time
    this.graphDescriptors = this.buildDescriptors();
  }

  /**
   * Build graph descriptors from catalog entries.
   */
  private buildDescriptors(): readonly GraphDescriptor[] {
    return Object.entries(LANGGRAPH_CATALOG).map(([graphName, entry]) => ({
      graphId: `${this.providerId}:${graphName}`,
      displayName: entry.displayName,
      description: entry.description,
      capabilities: this.inferCapabilities(),
    }));
  }

  /**
   * Infer capabilities for catalog graphs.
   * Conservative defaults per CAPABILITIES_CONSERVATIVE.
   */
  private inferCapabilities(): GraphCapabilities {
    return {
      supportsStreaming: true,
      supportsTools: true,
      supportsMemory: false, // P0: no thread persistence
    };
  }

  /**
   * List all graphs from catalog.
   */
  listGraphs(): readonly GraphDescriptor[] {
    return this.graphDescriptors;
  }

  /**
   * Check if this provider handles the given graphId.
   */
  canHandle(graphId: string): boolean {
    if (!graphId.startsWith(`${this.providerId}:`)) {
      return false;
    }
    const graphName = graphId.slice(this.providerId.length + 1);
    return graphName in LANGGRAPH_CATALOG;
  }

  /**
   * NOT IMPLEMENTED - Discovery-only provider.
   *
   * Per DISCOVERY_NO_EXECUTION_DEPS and REGISTRY_SEPARATION:
   * This provider is for discovery only. Use LangGraphInProcProvider
   * for execution.
   *
   * @throws Error always
   */
  runGraph(_req: GraphRunRequest): GraphRunResult {
    throw new Error(
      "LangGraphCatalogProvider is discovery-only. " +
        "Use LangGraphInProcProvider for execution."
    );
  }
}
