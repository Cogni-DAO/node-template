// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker-service/worker`
 * Purpose: Temporal Worker bootstrap and lifecycle management.
 * Scope: Creates Temporal Worker with activities and workflows. Does not contain business logic.
 * Invariants:
 *   - Per WORKER_NEVER_CONTROLS_SCHEDULES: Does NOT depend on ScheduleControlPort
 *   - Per TEMPORAL_DETERMINISM: Workflows are bundled separately from activities
 *   - All dependencies injected via ServiceContainer from bootstrap/container.ts
 *   - No concrete adapter imports — uses container for wiring
 * Side-effects: IO (connects to Temporal, starts worker)
 * Links: docs/spec/scheduler.md, docs/spec/temporal-patterns.md
 * @internal
 */

import { NativeConnection, Worker } from "@temporalio/worker";
import { createActivities } from "./activities/index.js";
import { createContainer } from "./bootstrap/container.js";
import type { Env } from "./bootstrap/env.js";
import type { Logger } from "./observability/logger.js";

/**
 * Configuration for starting the Temporal scheduler worker.
 */
export interface SchedulerWorkerConfig {
  /** Validated environment */
  env: Env;
  /** Logger instance */
  logger: Logger;
}

/**
 * Starts the Temporal scheduler worker with injected configuration.
 * Returns a cleanup function to stop the worker gracefully.
 */
export async function startSchedulerWorker(
  config: SchedulerWorkerConfig
): Promise<{ shutdown: () => Promise<void> }> {
  const { env, logger } = config;

  logger.info(
    {
      temporalAddress: env.TEMPORAL_ADDRESS,
      namespace: env.TEMPORAL_NAMESPACE,
      taskQueue: env.TEMPORAL_TASK_QUEUE,
    },
    "Connecting to Temporal"
  );

  // Create Temporal connection
  const connection = await NativeConnection.connect({
    address: env.TEMPORAL_ADDRESS,
  });

  // Build service container (all concrete adapter wiring)
  const container = createContainer(env, logger);

  // Create activities with injected deps (typed against ports)
  const activities = createActivities({
    grantAdapter: container.grantAdapter,
    runAdapter: container.runAdapter,
    config: container.config,
    logger:
      container.logger.child?.({ component: "activities" }) ?? container.logger,
  });

  // Create Temporal Worker
  // Note: workflowsPath points to the compiled workflow file
  const worker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: env.TEMPORAL_TASK_QUEUE,
    workflowsPath: new URL(
      "./workflows/scheduled-run.workflow.js",
      import.meta.url
    ).pathname,
    activities,
  });

  logger.info(
    { namespace: env.TEMPORAL_NAMESPACE, taskQueue: env.TEMPORAL_TASK_QUEUE },
    "Temporal Worker created"
  );

  // Start the worker (runs in background)
  const runPromise = worker.run();

  // Handle worker errors
  runPromise.catch((err) => {
    logger.error({ err }, "Worker run failed");
  });

  logger.info({}, "Scheduler worker started, polling for tasks");

  // Return shutdown function
  return {
    shutdown: async () => {
      logger.info({}, "Shutting down Temporal Worker");
      worker.shutdown();
      await runPromise;
      await connection.close();
      logger.info({}, "Temporal Worker shutdown complete");
    },
  };
}
