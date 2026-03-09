// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker-service/workflows/collect-epoch`
 * Purpose: Temporal Workflow for epoch ingestion, selection, allocation, and pool estimation.
 * Scope: Deterministic orchestration only. All I/O happens in Activities. Steps: compute window → transition epoch (close stale + create) → collect per source → materialize selection → compute allocations → ensure pool. Does not handle finalization (see FinalizeEpochWorkflow).
 * Invariants:
 *   - Per TEMPORAL_DETERMINISM: No I/O, network calls, or direct imports of adapters
 *   - Per WRITES_VIA_TEMPORAL: All writes execute in Temporal activities
 *   - Per CURSOR_STATE_PERSISTED: Cursors saved after each adapter collect() call
 *   - Per ACTIVITY_IDEMPOTENT: All activities idempotent via PK constraints or upsert
 *   - Per WEIGHT_PINNING: Epoch weightConfig is pinned at creation; subsequent runs use pinned value
 *   - Per EPOCH_CLOSE_ON_TRANSITION: Previous epoch closes at start of new window, not via timer/grace period
 * Side-effects: none (deterministic orchestration only)
 * Links: docs/spec/attribution-ledger.md, docs/spec/temporal-patterns.md
 * @internal
 */

import { computeEpochWindowV1 } from "@cogni/attribution-ledger/epoch-window";
import {
  ApplicationFailure,
  proxyActivities,
  workflowInfo,
} from "@temporalio/workflow";

import type { EnrichmentActivities } from "../activities/enrichment.js";
import type { LedgerActivities } from "../activities/ledger.js";

// Proxy ledger activities with reasonable timeouts.
// collectFromSource may hit GitHub API pagination — allow up to 5 minutes.
const {
  ensureEpochForWindow,
  findStaleOpenEpoch,
  transitionEpochForWindow,
  loadCursor,
  saveCursor,
  insertReceipts,
  materializeSelection,
  computeAllocations,
  ensurePoolComponents,
  resolveStreams,
} = proxyActivities<LedgerActivities>({
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

const { deriveWeightConfig, evaluateEpochDraft, buildLockedEvaluations } =
  proxyActivities<EnrichmentActivities>({
    startToCloseTimeout: "2 minutes",
    retry: {
      initialInterval: "2 seconds",
      maximumInterval: "1 minute",
      backoffCoefficient: 2,
      maximumAttempts: 5,
    },
  });

/** Schedule adapter wrapper (infra — extract .input immediately) */
interface ScheduleActionPayload {
  scheduleId?: string;
  temporalScheduleId?: string;
  graphId?: string;
  executionGrantId?: string;
  input: AttributionIngestRunV1;
}

/** Versioned domain envelope — sole contract for this workflow. */
export interface AttributionIngestRunV1 {
  readonly version: 1;
  readonly scopeId: string;
  readonly scopeKey: string;
  readonly epochLengthDays: number;
  /** Map of source → { attributionPipeline, sourceRefs } */
  readonly activitySources: Record<
    string,
    {
      attributionPipeline: string;
      sourceRefs: string[];
    }
  >;
  /** Pool budget config — base_issuance_credits as string (bigint serialized). Optional for backward compat. */
  readonly baseIssuanceCredits?: string;
  /** EVM approver addresses for epoch close. Optional for backward compat. */
  readonly approvers?: string[];
}

/**
 * CollectEpochWorkflow — orchestrates one epoch collection pass.
 *
 * 1. Compute epoch window from TemporalScheduledStartTime
 * 2. Derive weight config from pipeline profile
 * 3. Detect stale epoch from previous window → build evaluations → transition atomically
 * 4. For each source, resolve streams from adapter, then per sourceRef/stream: collect → insert → save cursor
 *
 * Epoch close happens at the START of the next window (not via timer/grace period).
 * When a new window begins, any stale open epoch is closed atomically with the new epoch's creation.
 *
 * Receives ScheduleActionPayload from the schedule adapter; extracts .input immediately.
 * Deterministic workflow ID: ledger-collect-{scopeKey}-{periodStart}-{periodEnd}
 * (set by the schedule action, not by this workflow)
 */
export async function CollectEpochWorkflow(
  raw: ScheduleActionPayload
): Promise<void> {
  const config = raw.input;

  // 1. Derive epoch window — pure helper from @cogni/attribution-ledger (safe in workflow code)
  const info = workflowInfo();
  const scheduledStartTime = (
    info.searchAttributes?.TemporalScheduledStartTime as Date[] | undefined
  )?.[0];
  if (!scheduledStartTime) {
    throw ApplicationFailure.nonRetryable(
      "TemporalScheduledStartTime missing — workflow must be triggered by a schedule"
    );
  }
  const { periodStartIso, periodEndIso } = computeEpochWindowV1({
    asOfIso: scheduledStartTime.toISOString(),
    epochLengthDays: config.epochLengthDays,
    timezone: "UTC",
    weekStart: "monday",
  });

  // 2. Extract attributionPipeline from activity sources (required — no fallback)
  const firstSource = Object.values(config.activitySources)[0];
  if (!firstSource?.attributionPipeline) {
    throw ApplicationFailure.nonRetryable(
      "attributionPipeline missing from activitySources — check repo-spec.yaml"
    );
  }
  const attributionPipeline = firstSource.attributionPipeline;

  // 3. Derive weight config from the pipeline profile (profile owns weights)
  const { weightConfig } = await deriveWeightConfig({ attributionPipeline });

  // 4. Detect stale open epoch from a previous window
  const { staleEpoch } = await findStaleOpenEpoch({
    periodStart: periodStartIso,
    periodEnd: periodEndIso,
  });

  // 5. Ensure epoch — either via transition (close stale + create) or simple find-or-create
  let epoch;
  if (staleEpoch) {
    // Build locked evaluations for the stale epoch before closing it
    const { evaluations, artifactsHash } = await buildLockedEvaluations({
      epochId: staleEpoch.epochId,
      attributionPipeline,
    });

    // Transition: close stale epoch + create new epoch in one DB transaction.
    // Hash computation happens inside the activity (crypto not safe in workflow code).
    epoch = await transitionEpochForWindow({
      periodStart: periodStartIso,
      periodEnd: periodEndIso,
      weightConfig,
      closeParams: {
        staleEpochId: staleEpoch.epochId,
        staleWeightConfig: staleEpoch.weightConfig,
        approvers: config.approvers ?? [],
        attributionPipeline,
        evaluations,
        artifactsHash,
      },
    });
  } else {
    // No stale epoch — simple find-or-create (existing path)
    epoch = await ensureEpochForWindow({
      periodStart: periodStartIso,
      periodEnd: periodEndIso,
      weightConfig,
    });
  }

  // If epoch already closed/finalized, skip collection
  if (epoch.status !== "open") return;

  // 6. Collect from each source, each sourceRef — streams resolved from adapter
  for (const [source, sourceConfig] of Object.entries(config.activitySources)) {
    const { streams } = await resolveStreams({ source });
    for (const sourceRef of sourceConfig.sourceRefs) {
      for (const stream of streams) {
        const cursorValue = await loadCursor({ source, stream, sourceRef });
        const result = await collectFromSource({
          source,
          streams: [stream],
          cursorValue,
          periodStart: periodStartIso,
          periodEnd: periodEndIso,
        });
        if (result.events.length > 0) {
          await insertReceipts({
            events: result.events,
            producerVersion: result.producerVersion,
          });
        }
        await saveCursor({
          source,
          stream,
          sourceRef,
          cursorValue: result.nextCursorValue,
        });
      }
    }
  }

  // 7. Materialize selection and resolve identities (SELECTION_AUTO_POPULATE)
  await materializeSelection({ epochId: epoch.epochId, attributionPipeline });

  // 8. Evaluate epoch with draft evaluations (profile-driven enricher dispatch)
  await evaluateEpochDraft({ epochId: epoch.epochId, attributionPipeline });

  // 9. Compute allocations
  await computeAllocations({
    epochId: epoch.epochId,
    attributionPipeline,
    weightConfig: epoch.weightConfig,
  });

  // 10. Ensure pool components (base_issuance from config, idempotent)
  if (config.baseIssuanceCredits) {
    await ensurePoolComponents({
      epochId: epoch.epochId,
      baseIssuanceCredits: config.baseIssuanceCredits,
    });
  }
}
