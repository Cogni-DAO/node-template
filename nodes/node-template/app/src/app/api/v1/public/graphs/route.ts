// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/public/graphs`
 * Purpose: Public endpoint listing available graph executors — no auth required.
 * Scope: Static catalog of graph_name values accepted by POST /api/v1/chat/completions.
 *   Agents use this to discover which graph_name to pass when executing named workflows.
 * Invariants: Public (no auth); static response; graph_name values match langgraph catalog.
 * Side-effects: none
 * Links: packages/langgraph-graphs (graph definitions)
 * @public
 */

import { NextResponse } from "next/server";
import { wrapPublicRoute } from "@/bootstrap/http";

export const runtime = "nodejs";

const GRAPHS = [
  {
    graph_name: "poet",
    description: "Poem and haiku generation. Good demo target — low latency.",
  },
  {
    graph_name: "brain",
    description: "General reasoning with tool access.",
  },
  {
    graph_name: "research",
    description: "Web research and summarization.",
  },
  {
    graph_name: "ponderer",
    description: "Long-form thinking and analysis.",
  },
  {
    graph_name: "pr-review",
    description: "Code review for pull requests.",
  },
  {
    graph_name: "browser",
    description: "Browser automation.",
  },
];

export const GET = wrapPublicRoute(
  {
    routeId: "public.graphs",
    cacheTtlSeconds: 300,
    staleWhileRevalidateSeconds: 600,
  },
  async (_ctx, _request) => {
    return NextResponse.json({
      graphs: GRAPHS,
      hint: "Pass graph_name in POST /api/v1/chat/completions body. See GET /api/v1/public/models for available model strings.",
    });
  }
);
