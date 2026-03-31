// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@components/kit/graph/GraphInspector`
 * Purpose: Side panel that displays metadata for a selected graph node.
 * Scope: Presentational. Receives a GraphNode and renders its details in a Sheet.
 * Invariants: Uses shadcn Sheet via kit barrel.
 * Side-effects: none
 * Links: [types](./types.ts)
 * @public
 */

"use client";

import type { ReactElement } from "react";

import {
  Badge,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components";

import type { GraphNode } from "./types";

export interface GraphInspectorProps {
  /** The node to inspect, or null to close */
  node: GraphNode | null;
  /** Called when the sheet is closed */
  onClose: () => void;
}

const STATUS_INTENT: Record<string, "default" | "secondary" | "destructive"> = {
  running: "default",
  completed: "secondary",
  failed: "destructive",
  pending: "secondary",
};

export function GraphInspector({
  node,
  onClose,
}: GraphInspectorProps): ReactElement {
  return (
    <Sheet open={node !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-80 overflow-auto sm:w-96">
        {node && (
          <>
            <SheetHeader>
              <SheetTitle className="text-base">{node.label}</SheetTitle>
            </SheetHeader>
            <div className="mt-4 space-y-4">
              <div className="flex items-center gap-2">
                <Badge
                  intent={
                    STATUS_INTENT[node.status ?? "pending"] ?? "secondary"
                  }
                >
                  {node.status ?? "unknown"}
                </Badge>
                <span className="text-muted-foreground text-xs">
                  {node.type}
                </span>
              </div>

              {node.timestamp && (
                <div>
                  <p className="font-medium text-muted-foreground text-xs">
                    Timestamp
                  </p>
                  <p className="text-sm">
                    {new Date(node.timestamp).toLocaleString()}
                  </p>
                </div>
              )}

              {node.metadata && Object.keys(node.metadata).length > 0 && (
                <div>
                  <p className="mb-2 font-medium text-muted-foreground text-xs">
                    Details
                  </p>
                  <dl className="space-y-2">
                    {Object.entries(node.metadata).map(([key, value]) => (
                      <div key={key}>
                        <dt className="text-muted-foreground text-xs">{key}</dt>
                        <dd className="break-all text-sm">
                          {typeof value === "object"
                            ? JSON.stringify(value, null, 2)
                            : String(value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
