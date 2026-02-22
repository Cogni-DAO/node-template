// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker-service/main`
 * Purpose: Service entry point with graceful shutdown. Starts scheduler + optional ledger worker.
 * Scope: Entry point that calls env() and starts Temporal workers. Does not contain business logic.
 * Invariants:
 *   - Reads config from env (no hardcoded values)
 *   - Handles SIGTERM/SIGINT for graceful shutdown
 *   - Per READINESS_GATES_LOCALLY: ready=false stops work intake immediately
 *   - Both workers must start before ready=true
 * Side-effects: IO (Temporal connection, process signals)
 * Links: docs/spec/scheduler.md, docs/spec/services-architecture.md
 * @public
 */

import { createLedgerContainer } from "./bootstrap/container.js";
import { env } from "./bootstrap/env.js";
import { type HealthState, startHealthServer } from "./health.js";
import { startLedgerWorker } from "./ledger-worker.js";
import { flushLogger, makeLogger } from "./observability/logger.js";
import { startSchedulerWorker } from "./worker.js";

async function main(): Promise<void> {
  // Load and validate env
  const config = env();

  // Create logger (composition root owns logger creation)
  const logger = makeLogger();

  logger.info(
    { logLevel: config.LOG_LEVEL },
    "Starting Temporal scheduler worker"
  );

  // Health state for readiness probes
  const healthState: HealthState = { ready: false };
  startHealthServer(healthState, config.HEALTH_PORT);
  logger.info({ port: config.HEALTH_PORT }, "Health server started");

  // Shutdown handles for all workers
  const shutdownHandles: Array<{ shutdown: () => Promise<void> }> = [];

  // Start scheduler worker (always)
  const schedulerWorker = await startSchedulerWorker({ env: config, logger });
  shutdownHandles.push(schedulerWorker);

  // Start ledger worker (optional — requires NODE_ID + SCOPE_ID)
  const ledgerContainer = createLedgerContainer(config, logger);
  if (ledgerContainer) {
    const ledgerWorker = await startLedgerWorker({
      env: config,
      logger,
      container: ledgerContainer,
    });
    shutdownHandles.push(ledgerWorker);
    logger.info({}, "Ledger worker started alongside scheduler worker");
  }

  // Mark ready after all workers start
  healthState.ready = true;
  logger.info(
    {
      namespace: config.TEMPORAL_NAMESPACE,
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      ledgerEnabled: !!ledgerContainer,
    },
    "All workers started, ready for traffic"
  );

  // Graceful shutdown
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      logger.warn({ signal }, "Shutdown already in progress");
      return;
    }
    shuttingDown = true;
    healthState.ready = false; // Stop accepting new work
    logger.info({ signal }, "Received signal, shutting down");

    try {
      await Promise.all(shutdownHandles.map((h) => h.shutdown()));
      logger.info({}, "All workers stopped");
      flushLogger();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Error during shutdown");
      flushLogger();
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

const bootLogger = makeLogger({ phase: "boot" });

main().catch((err) => {
  bootLogger.fatal({ err }, "Fatal error during startup");
  flushLogger();
  process.exit(1);
});
