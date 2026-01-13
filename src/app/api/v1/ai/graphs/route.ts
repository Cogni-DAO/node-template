// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/ai/graphs`
 * Purpose: Provides HTTP endpoint for listing available graph agents.
 * Scope: Auth-protected GET endpoint that returns graph descriptors with catalog-defined default. Does not implement graph discovery logic.
 * Invariants:
 *   - DISCOVERY_PIPELINE: Route → listGraphsForApi() → aggregator → providers
 *   - UI_ONLY_TALKS_TO_PORT: Returns stable graphIds regardless of execution backend
 *   - GRAPH_ID_NAMESPACED: graphId format is "${providerId}:${graphName}"
 * Side-effects: IO (HTTP request/response)
 * Notes: Implements SEC-001 (auth-protected). Uses discovery pipeline via bootstrap helper.
 * Links: ai.graphs.v1.contract, AGENT_DISCOVERY.md
 * @public
 */

// P0: Default comes from package; P1: app-configurable via env
import { DEFAULT_LANGGRAPH_GRAPH_ID } from "@cogni/langgraph-graphs";
import { NextResponse } from "next/server";

import { getSessionUser } from "@/app/_lib/auth/session";
import { listGraphsForApi } from "@/bootstrap/graph-discovery";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { aiGraphsOperation } from "@/contracts/ai.graphs.v1.contract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = wrapRouteHandlerWithLogging(
  { routeId: "ai.graphs", auth: { mode: "required", getSessionUser } },
  async (ctx) => {
    const startMs = performance.now();
    try {
      // Per DISCOVERY_PIPELINE: Use bootstrap helper, not direct catalog import
      const graphs = listGraphsForApi();

      // P0: Default from package constant; P1: app-configurable via env
      const defaultGraphId = graphs.some(
        (g) => g.graphId === DEFAULT_LANGGRAPH_GRAPH_ID
      )
        ? DEFAULT_LANGGRAPH_GRAPH_ID
        : null;

      if (defaultGraphId === null && graphs.length > 0) {
        ctx.log.warn(
          { expected: DEFAULT_LANGGRAPH_GRAPH_ID, graphCount: graphs.length },
          "Catalog default graph not found in graph list"
        );
      }

      // Validate with contract before returning
      const payload = { graphs: [...graphs], defaultGraphId };
      const parseResult = aiGraphsOperation.output.safeParse(payload);

      if (!parseResult.success) {
        ctx.log.error(
          {
            errCode: "inv_graphs_contract_validation_failed",
            graphCount: graphs.length,
          },
          "Graph data failed contract validation"
        );
        return NextResponse.json(
          { error: "Server error: invalid data format" },
          { status: 500 }
        );
      }

      ctx.log.info(
        {
          graphCount: graphs.length,
          defaultGraphId,
          durationMs: performance.now() - startMs,
        },
        "ai.graphs_list_success"
      );

      return NextResponse.json(parseResult.data, { status: 200 });
    } catch (error) {
      ctx.log.error(
        {
          errCode: "ai.graphs_list_failed",
          errorType: error instanceof Error ? error.name : "unknown",
        },
        "Failed to list graphs"
      );
      return NextResponse.json(
        { error: "Failed to list graphs" },
        { status: 500 }
      );
    }
  }
);
