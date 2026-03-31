// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@components/kit/graph/types`
 * Purpose: Unified graph data model for all visualization adapters (LangGraph, Temporal, monitor-core, Dolt).
 * Scope: Type definitions only. No runtime code.
 * Invariants: Open `type` field — each adapter defines its own node types.
 * Side-effects: none
 * @public
 */

/** A node in the graph — represents a workflow step, agent, signal, entity, etc. */
export interface GraphNode {
  id: string;
  /** Open union — adapters define their own types (e.g. 'graph-node', 'entity', 'signal') */
  type: string;
  label: string;
  status?: "running" | "completed" | "failed" | "pending" | undefined;
  /** Unix ms — used for timeline playback ordering */
  timestamp?: number | undefined;
  /** Arbitrary metadata shown in the inspector panel on click */
  metadata?: Record<string, unknown> | undefined;
}

/** A directed edge between two nodes */
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string | undefined;
  /** Whether to animate the edge (e.g. for active/in-progress connections) */
  animated?: boolean | undefined;
}

/** A complete graph state at a point in time */
export interface GraphSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Unix ms — the timestamp this snapshot represents */
  timestamp: number;
}
