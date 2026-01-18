// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@scripts/run-scheduler-worker`
 * Purpose: Entry point for scheduler worker process.
 * Scope: Wiring only - resolves deps from bootstrap, calls startSchedulerWorker. Does not contain task logic.
 * Side-effects: IO (starts worker process, listens for jobs, handles signals)
 * Invariants:
 * - This script lives in src/ so it CAN import from src/
 * - packages/scheduler-worker has zero src/ imports
 * Links: docs/SCHEDULER_SPEC.md
 * @internal
 *
 * v0: Stub execution - worker runs but doesn't execute graphs.
 * Next PR will add HTTP call to POST /api/internal/graphs/{graphId}:run
 */

import { startSchedulerWorker } from "@cogni/scheduler-worker";

import { resolveSchedulingDeps } from "@/bootstrap/container";
import { serverEnv } from "@/shared/env";
import { makeLogger } from "@/shared/observability";

const logger = makeLogger({ component: "scheduler-worker" });

async function main() {
  const env = serverEnv();
  const schedulingDeps = resolveSchedulingDeps();

  const connectionString = env.DATABASE_URL;

  // Wire deps from ports to worker interface
  // v0: Simplified deps - no graph execution
  const workerDeps = {
    // Schedule operations
    getSchedule: async (id: string) => {
      const schedule = await schedulingDeps.scheduleManager.getSchedule(id);
      if (!schedule) return null;
      return {
        id: schedule.id,
        enabled: schedule.enabled,
        cron: schedule.cron,
        timezone: schedule.timezone,
        graphId: schedule.graphId,
        executionGrantId: schedule.executionGrantId,
      };
    },
    // Grant validation (GRANT_SCOPES_CONSTRAIN_GRAPHS)
    validateGrantForGraph: (grantId: string, graphId: string) =>
      schedulingDeps.executionGrantPort.validateGrantForGraph(grantId, graphId),
    findStaleSchedules: async () =>
      schedulingDeps.scheduleManager.findStaleSchedules(),
    updateNextRunAt: async (scheduleId: string, nextRunAt: Date) =>
      schedulingDeps.scheduleManager.updateNextRunAt(scheduleId, nextRunAt),
    updateLastRunAt: async (scheduleId: string, lastRunAt: Date) =>
      schedulingDeps.scheduleManager.updateLastRunAt(scheduleId, lastRunAt),

    // Run ledger operations
    createRun: async (params: {
      scheduleId: string;
      runId: string;
      scheduledFor: Date;
    }) => {
      await schedulingDeps.scheduleRunRepository.createRun(params);
    },
    markRunStarted: async (runId: string) => {
      await schedulingDeps.scheduleRunRepository.markRunStarted(runId);
    },
    markRunCompleted: async (
      runId: string,
      status: "success" | "error" | "skipped",
      errorMessage?: string
    ) => {
      await schedulingDeps.scheduleRunRepository.markRunCompleted(
        runId,
        status,
        errorMessage
      );
    },

    // Job queue operations
    enqueueJob: async (params: {
      taskId: string;
      payload: Record<string, unknown>;
      runAt: Date;
      jobKey: string;
      queueName?: string;
    }) => {
      await schedulingDeps.jobQueue.enqueueJob(params);
    },
  };

  // Start worker
  const worker = await startSchedulerWorker({
    connectionString,
    logger,
    deps: workerDeps,
  });

  // Handle shutdown signals
  const shutdown = async () => {
    logger.info({}, "Received shutdown signal");
    await worker.stop();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  logger.info({}, "Scheduler worker running (v0 stub - no graph execution)");

  // Keep process alive
  await new Promise(() => {});
}

main().catch((error) => {
  logger.error({ error }, "Scheduler worker failed");
  process.exit(1);
});
