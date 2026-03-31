// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/graph-viz/components/RunFlowView`
 * Purpose: Composes FlowGraph + GraphInspector to display a single run's DAG.
 * Scope: Feature composition. Manages selected-node state. Does not fetch data.
 * Invariants: KIT_IS_ONLY_API — imports from kit barrel only.
 * Side-effects: none
 * Links: [FlowGraph](../../../components/kit/graph/FlowGraph.tsx), [GraphInspector](../../../components/kit/graph/GraphInspector.tsx)
 * @public
 */

"use client";

import { useState } from "react";

import { FlowGraph } from "@/components/kit/graph/FlowGraph";
import { GraphInspector } from "@/components/kit/graph/GraphInspector";
import type { GraphNode, GraphSnapshot } from "@/components/kit/graph/types";

export interface RunFlowViewProps {
  snapshot: GraphSnapshot;
  className?: string | undefined;
}

export function RunFlowView({ snapshot, className }: RunFlowViewProps) {
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  return (
    <>
      <FlowGraph
        snapshot={snapshot}
        onNodeClick={setSelectedNode}
        className={className}
      />
      <GraphInspector
        node={selectedNode}
        onClose={() => setSelectedNode(null)}
      />
    </>
  );
}
