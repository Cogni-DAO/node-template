// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/graph-discovery`
 * Purpose: Discovery-only factory for listing available graphs.
 * Scope: Creates aggregator with discovery-only providers. No execution deps. Used by routes for graph listing. Does not create execution providers or require CompletionStreamFn.
 * Invariants:
 *   - DISCOVERY_NO_EXECUTION_DEPS: Does not require CompletionStreamFn or tool runners
 *   - DISCOVERY_PIPELINE: Route → this helper → aggregator → providers
 *   - REGISTRY_SEPARATION: Discovery providers only, never execution providers
 * Side-effects: none
 * Links: AGENT_DISCOVERY.md, GRAPH_EXECUTION.md, graph-executor.factory.ts
 * @public
 */

import {
  AggregatingGraphExecutor,
  LangGraphCatalogProvider,
} from "@/adapters/server";
import type { GraphDescriptor } from "@/ports";

/**
 * Create discovery-only aggregator.
 *
 * Per DISCOVERY_NO_EXECUTION_DEPS: This factory creates an aggregator
 * with discovery-only providers. It does NOT require CompletionStreamFn
 * or any execution infrastructure.
 *
 * Per REGISTRY_SEPARATION: Uses LangGraphCatalogProvider (discovery-only),
 * not LangGraphInProcProvider (execution).
 *
 * @returns Aggregator that can list graphs (runGraph will throw)
 */
export function createGraphDiscoveryCatalog(): {
  listGraphs(): readonly GraphDescriptor[];
} {
  const providers = [new LangGraphCatalogProvider()];
  return new AggregatingGraphExecutor(providers);
}

/**
 * List all available graphs for API response.
 *
 * Per DISCOVERY_PIPELINE: Route calls this helper,
 * which uses aggregator to fan out to providers.
 *
 * @returns Array of graph descriptors sorted by displayName
 */
export function listGraphsForApi(): readonly GraphDescriptor[] {
  const catalog = createGraphDiscoveryCatalog();
  const graphs = catalog.listGraphs();

  // Sort by displayName for stable UI rendering
  return [...graphs].sort((a, b) => a.displayName.localeCompare(b.displayName));
}
