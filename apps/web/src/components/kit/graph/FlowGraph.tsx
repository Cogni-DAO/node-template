// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@components/kit/graph/FlowGraph`
 * Purpose: Kit wrapper around @xyflow/react for rendering structured DAG/flow diagrams.
 * Scope: Presentational. Accepts GraphSnapshot data, renders interactive flow diagram. Does not fetch data.
 * Invariants: VENDOR_ISOLATION — @xyflow/react imported only here. SSR_SAFE — dynamic import with ssr:false.
 * Side-effects: none
 * Links: [types](./types.ts)
 * @public
 */

"use client";

import {
  Background,
  Controls,
  type Edge,
  type Node,
  type NodeMouseHandler,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useMemo } from "react";

import type { GraphNode, GraphSnapshot } from "./types";

export interface FlowGraphProps {
  /** Graph data to render */
  snapshot: GraphSnapshot;
  /** Called when a node is clicked */
  onNodeClick?: (node: GraphNode) => void;
  /** Container className for layout overrides */
  className?: string | undefined;
}

const STATUS_COLORS: Record<string, string> = {
  running: "hsl(var(--success))",
  completed: "hsl(var(--success))",
  failed: "hsl(var(--destructive))",
  pending: "hsl(var(--muted-foreground))",
};

function toFlowNodes(nodes: GraphNode[]): Node[] {
  return nodes.map((n, i) => ({
    id: n.id,
    position: { x: (i % 4) * 220, y: Math.floor(i / 4) * 120 },
    data: {
      label: n.label,
      status: n.status,
      type: n.type,
    },
    style: {
      background: "hsl(var(--card))",
      color: "hsl(var(--card-foreground))",
      border: `2px solid ${STATUS_COLORS[n.status ?? "pending"] ?? "hsl(var(--border))"}`,
      borderRadius: "8px",
      padding: "8px 16px",
      fontSize: "13px",
      fontWeight: 500,
    },
  }));
}

function toFlowEdges(edges: GraphSnapshot["edges"]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    animated: e.animated ?? false,
    style: { stroke: "hsl(var(--muted-foreground))" },
  }));
}

export function FlowGraph({
  snapshot,
  onNodeClick,
  className,
}: FlowGraphProps) {
  const nodes = useMemo(() => toFlowNodes(snapshot.nodes), [snapshot.nodes]);
  const edges = useMemo(() => toFlowEdges(snapshot.edges), [snapshot.edges]);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const graphNode = snapshot.nodes.find((n) => n.id === node.id);
      if (graphNode && onNodeClick) onNodeClick(graphNode);
    },
    [snapshot.nodes, onNodeClick]
  );

  return (
    <div className={className ?? "h-full w-full"}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={handleNodeClick}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
