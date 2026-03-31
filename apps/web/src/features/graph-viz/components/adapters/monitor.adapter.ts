// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/graph-viz/components/adapters/monitor.adapter`
 * Purpose: Maps monitor-core entities/signals/runs to GraphSnapshot for visualization.
 * Scope: Pure data transformation. No I/O. Types match monitor-core schemas (task.0227).
 * Invariants: NO_BACKEND_CHANGES — maps from future /brain/* API response shapes.
 * Side-effects: none
 * @public
 */

import type {
  GraphEdge,
  GraphNode,
  GraphSnapshot,
} from "@/components/kit/graph/types";

/** Matches monitor-core MonitoredEntity shape */
interface MonitorEntity {
  id: string;
  domain: string;
  source: string;
  title: string;
  category: string;
  active: boolean;
  updatedAt: string;
}

/** Matches monitor-core Signal shape */
interface MonitorSignal {
  id: string;
  entityId: string;
  runId: string;
  finding: string;
  confidencePct: number;
  actionLevel: string;
  timestamp: string;
}

/** Matches monitor-core AnalysisRun shape */
interface MonitorRun {
  id: string;
  domain: string;
  triggerType: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
}

export interface MonitorData {
  entities: MonitorEntity[];
  signals: MonitorSignal[];
  runs: MonitorRun[];
}

/**
 * Convert monitor pipeline data into a GraphSnapshot.
 * Entities, signals, and runs become nodes. Edges connect:
 *   run → signal, signal → entity
 */
export function monitorToSnapshot(data: MonitorData): GraphSnapshot {
  const nodes: GraphNode[] = [
    ...data.entities.map(
      (e): GraphNode => ({
        id: e.id,
        type: "entity",
        label: e.title,
        status: e.active ? "completed" : "pending",
        timestamp: new Date(e.updatedAt).getTime(),
        metadata: {
          domain: e.domain,
          source: e.source,
          category: e.category,
        },
      })
    ),
    ...data.runs.map(
      (r): GraphNode => ({
        id: r.id,
        type: "run",
        label: `${r.domain} ${r.triggerType}`,
        status:
          r.status === "running"
            ? "running"
            : r.status === "completed"
              ? "completed"
              : "failed",
        timestamp: new Date(r.startedAt).getTime(),
        metadata: {
          domain: r.domain,
          triggerType: r.triggerType,
          startedAt: r.startedAt,
          completedAt: r.completedAt,
        },
      })
    ),
    ...data.signals.map(
      (s): GraphNode => ({
        id: s.id,
        type: "signal",
        label: s.finding,
        status: "completed",
        timestamp: new Date(s.timestamp).getTime(),
        metadata: {
          confidence: `${s.confidencePct}%`,
          actionLevel: s.actionLevel,
          entityId: s.entityId,
          runId: s.runId,
        },
      })
    ),
  ];

  const edges: GraphEdge[] = [
    // run → signal edges
    ...data.signals.map(
      (s): GraphEdge => ({
        id: `edge-run-signal-${s.id}`,
        source: s.runId,
        target: s.id,
      })
    ),
    // signal → entity edges
    ...data.signals.map(
      (s): GraphEdge => ({
        id: `edge-signal-entity-${s.id}`,
        source: s.id,
        target: s.entityId,
      })
    ),
  ];

  const maxTime = Math.max(...nodes.map((n) => n.timestamp ?? 0), Date.now());

  return { nodes, edges, timestamp: maxTime };
}
