// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/dev-lifecycle/server`
 * Purpose: LangGraph dev server entrypoint for dev-lifecycle graph.
 * Scope: Thin entrypoint. Does NOT import catalog (type transparency for LangGraph CLI).
 * Invariants:
 *   - LANGGRAPH_JSON_POINTS_TO_SERVER_ONLY: Referenced by langgraph.json
 *   - HELPERS_DO_NOT_IMPORT_CATALOG: Uses makeServerGraph with explicit toolIds
 * Side-effects: process.env (via makeServerGraph)
 * Links: development-lifecycle.md
 * @internal
 */

import { makeServerGraph } from "../../runtime/core/make-server-graph";
import { createDevLifecycleGraph, DEV_LIFECYCLE_GRAPH_NAME } from "./graph";
import { DEV_LIFECYCLE_TOOL_IDS } from "./tools";

export const devLifecycle = await makeServerGraph({
  name: DEV_LIFECYCLE_GRAPH_NAME,
  createGraph: createDevLifecycleGraph,
  toolIds: DEV_LIFECYCLE_TOOL_IDS,
});
