// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker-service/workflows/collect-epoch`
 * Purpose: Temporal Workflow for epoch activity collection — cursor-based ingestion from source adapters.
 * Scope: Deterministic orchestration only. All I/O happens in Activities.
 * Invariants:
 *   - Per TEMPORAL_DETERMINISM: No I/O, network calls, or direct imports of adapters
 *   - Per WRITES_VIA_TEMPORAL: All writes execute in Temporal activities
 *   - Per CURSOR_STATE_PERSISTED: Cursors saved after each adapter collect() call
 *   - Per ACTIVITY_IDEMPOTENT: All activities idempotent via PK constraints or upsert
 * Side-effects: none (deterministic orchestration only)
 * Links: docs/spec/epoch-ledger.md, docs/spec/temporal-patterns.md
 * @internal
 */

import { proxyActivities } from "@temporalio/workflow";

import type { LedgerActivities } from "../activities/ledger.js";

// Proxy ledger activities with reasonable timeouts.
// collectFromSource may hit GitHub API pagination — allow up to 5 minutes.
const { ensureEpochForWindow, loadCursor, saveCursor, insertEvents } =
  proxyActivities<LedgerActivities>({
    startToCloseTimeout: "2 minutes",
    retry: {
      initialInterval: "2 seconds",
      maximumInterval: "1 minute",
      backoffCoefficient: 2,
      maximumAttempts: 5,
    },
  });

const { collectFromSource } = proxyActivities<LedgerActivities>({
  startToCloseTimeout: "5 minutes",
  retry: {
    initialInterval: "5 seconds",
    maximumInterval: "2 minutes",
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

/**
 * Input for CollectEpochWorkflow.
 * Passed from the Temporal Schedule action args (set by syncGovernanceSchedules).
 */
export interface CollectEpochWorkflowInput {
  /** ISO date string — epoch window start */
  readonly periodStart: string;
  /** ISO date string — epoch window end */
  readonly periodEnd: string;
  /** Stable opaque scope UUID */
  readonly scopeId: string;
  /** Human-friendly scope slug (used in deterministic workflow ID) */
  readonly scopeKey: string;
  /** Weight configuration snapshot for this epoch */
  readonly weightConfig: Record<string, number>;
  /** Source names to collect from (e.g., ["github"]) */
  readonly sources: string[];
  /** Source ref for cursor scoping (e.g., repo slug) */
  readonly sourceRef: string;
}

/**
 * CollectEpochWorkflow — orchestrates one epoch collection pass.
 *
 * 1. Ensure epoch exists for the time window (idempotent)
 * 2. For each source, for each stream: load cursor → collect → insert → save cursor
 *
 * Deterministic workflow ID: ledger-collect-{scopeKey}-{periodStart}-{periodEnd}
 * (set by the schedule action, not by this workflow)
 */
export async function CollectEpochWorkflow(
  input: CollectEpochWorkflowInput
): Promise<void> {
  const { periodStart, periodEnd, scopeId, weightConfig, sources, sourceRef } =
    input;

  // 1. Create or find epoch for this window
  const epoch = await ensureEpochForWindow({
    periodStart,
    periodEnd,
    scopeId,
    weightConfig,
  });

  // If epoch is already closed/finalized, skip collection
  if (epoch.status !== "open") {
    return;
  }

  // 2. For each source, collect all streams
  for (const source of sources) {
    // Each source adapter defines its own streams — we collect all of them.
    // The adapter internally handles stream routing.
    const streams = getStreamsForSource(source);

    for (const stream of streams) {
      // Load cursor for incremental sync
      const cursorValue = await loadCursor({ source, stream, sourceRef });

      // Collect events from source
      const result = await collectFromSource({
        source,
        streams: [stream],
        cursorValue,
        periodStart,
        periodEnd,
      });

      // Insert events (idempotent via PK)
      if (result.events.length > 0) {
        await insertEvents({ events: result.events });
      }

      // Save cursor (monotonic advancement)
      await saveCursor({
        source,
        stream,
        sourceRef,
        cursorValue: result.nextCursorValue,
      });
    }
  }
}

/**
 * Returns the stream IDs for a given source.
 * This is a deterministic mapping — safe in workflow code.
 */
function getStreamsForSource(source: string): string[] {
  switch (source) {
    case "github":
      return ["pull_requests", "reviews", "issues"];
    default:
      return [];
  }
}
