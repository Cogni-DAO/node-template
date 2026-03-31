// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/graph-viz/components/adapters/langgraph.adapter`
 * Purpose: Maps LangGraph run data (RunCardData[]) to GraphSnapshot for visualization.
 * Scope: Pure data transformation. No I/O.
 * Invariants: NO_BACKEND_CHANGES — maps from existing fetchRuns() response shape.
 * Side-effects: none
 * @public
 */

import type { RunCardData } from "@/components/kit/data-display/RunCard";
import type {
  GraphEdge,
  GraphNode,
  GraphSnapshot,
} from "@/components/kit/graph/types";

/**
 * Convert a list of runs into a timeline GraphSnapshot.
 * Each run becomes a node; sequential runs are connected by edges.
 */
export function runsToTimelineSnapshot(runs: RunCardData[]): GraphSnapshot {
  const sorted = [...runs].sort((a, b) => {
    const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0;
    const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0;
    return aTime - bTime;
  });

  const nodes: GraphNode[] = sorted.map((run) => ({
    id: run.id,
    type: "run",
    label: formatGraphLabel(run),
    status: mapStatus(run.status),
    timestamp: run.startedAt ? new Date(run.startedAt).getTime() : undefined,
    metadata: {
      runId: run.runId,
      graphId: run.graphId ?? "unknown",
      runKind: run.runKind ?? "unknown",
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
    },
  }));

  const edges: GraphEdge[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (!prev || !curr) continue;
    edges.push({
      id: `edge-${prev.id}-${curr.id}`,
      source: prev.id,
      target: curr.id,
      animated: curr.status === "running",
    });
  }

  const last = sorted.at(-1);
  const maxTime = last?.startedAt
    ? new Date(last.startedAt).getTime()
    : Date.now();

  return { nodes, edges, timestamp: maxTime };
}

function formatGraphLabel(run: RunCardData): string {
  const graphName = run.graphId
    ? run.graphId.includes(":")
      ? (run.graphId.split(":").pop() ?? run.graphId)
      : run.graphId
    : "unknown";
  return `${graphName} (${run.status})`;
}

function mapStatus(status: RunCardData["status"]): GraphNode["status"] {
  switch (status) {
    case "running":
      return "running";
    case "success":
      return "completed";
    case "error":
      return "failed";
    case "pending":
    case "skipped":
    case "cancelled":
      return "pending";
  }
}
