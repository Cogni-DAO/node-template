// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker-service/workflows/graph-run`
 * Purpose: Unified Temporal Workflow for all graph execution (scheduled, API, webhook).
 * Scope: Deterministic orchestration only. All I/O happens in Activities.
 * Invariants:
 *   - Per TEMPORAL_DETERMINISM: No I/O, network calls, or LLM calls in workflow code
 *   - Per SINGLE_RUN_LEDGER: always creates graph_runs record (no dbScheduleId gate)
 *   - Per EXECUTION_VIA_SERVICE_API: executeGraphActivity calls internal API, not GraphExecutorPort
 *   - Per IDEMPOTENT_RUN_START: Workflow ID = graph-run:{billingAccountId}:{idempotencyKey}
 *   - CONVERGED_FINALIZE: all terminal paths go through updateGraphRunActivity
 * Side-effects: none (deterministic orchestration only)
 * Links: docs/spec/unified-graph-launch.md, docs/spec/temporal-patterns.md
 * @internal
 */

import { proxyActivities, uuid4, workflowInfo } from "@temporalio/workflow";

import type { Activities } from "../activities/index.js";
import { GRAPH_EXECUTION_ACTIVITY_OPTIONS } from "./activity-profiles.js";

const {
  validateGrantActivity,
  createGraphRunActivity,
  updateGraphRunActivity,
} = proxyActivities<Activities>({
  startToCloseTimeout: "1 minute",
  retry: {
    initialInterval: "1 second",
    maximumInterval: "30 seconds",
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

const { executeGraphActivity } = proxyActivities<Activities>(
  GRAPH_EXECUTION_ACTIVITY_OPTIONS
);

export interface GraphRunWorkflowInput {
  graphId: string;
  executionGrantId: string | null;
  runId?: string;
  input: Record<string, unknown>;
  runKind: "user_immediate" | "system_scheduled" | "system_webhook";
  triggerSource: string;
  triggerRef: string;
  requestedBy: string;
  dbScheduleId?: string | null;
  temporalScheduleId?: string;
  scheduledFor?: string;
}

export async function GraphRunWorkflow(
  input: GraphRunWorkflowInput
): Promise<void> {
  const {
    graphId,
    executionGrantId,
    runId: providedRunId,
    input: graphInput,
    runKind,
    triggerSource,
    triggerRef,
    requestedBy,
    dbScheduleId,
    temporalScheduleId,
    scheduledFor: inputScheduledFor,
  } = input;

  let scheduledFor = inputScheduledFor;
  if (runKind === "system_scheduled" && !scheduledFor) {
    const info = workflowInfo();
    const scheduledStartTime = info.searchAttributes
      ?.TemporalScheduledStartTime as Date[] | undefined;
    if (scheduledStartTime?.[0]) {
      scheduledFor = scheduledStartTime[0].toISOString();
    }
  }

  const runId = providedRunId ?? uuid4();

  if (executionGrantId) {
    try {
      await validateGrantActivity({ grantId: executionGrantId, graphId });
    } catch {
      await createGraphRunActivity({
        runId,
        graphId,
        runKind,
        triggerSource,
        triggerRef,
        requestedBy,
        dbScheduleId,
        scheduledFor,
      });
      await updateGraphRunActivity({
        runId,
        status: "skipped",
        errorMessage: "Grant validation failed",
      });
      return;
    }
  }

  await createGraphRunActivity({
    runId,
    graphId,
    runKind,
    triggerSource,
    triggerRef,
    requestedBy,
    dbScheduleId,
    scheduledFor,
  });

  await updateGraphRunActivity({ runId, status: "running" });

  try {
    const result = await executeGraphActivity({
      temporalScheduleId,
      graphId,
      executionGrantId,
      input: graphInput,
      scheduledFor: scheduledFor ?? new Date().toISOString(),
      runId,
    });

    if (result.ok) {
      await updateGraphRunActivity({
        runId,
        status: "success",
        traceId: result.traceId,
      });
    } else {
      await updateGraphRunActivity({
        runId,
        status: "error",
        traceId: result.traceId,
        errorMessage: result.errorCode ?? "Graph execution failed",
        errorCode: result.errorCode,
      });
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error during execution";
    await updateGraphRunActivity({
      runId,
      status: "error",
      errorMessage,
    });
    throw error;
  }
}
