// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker-service/bootstrap/container`
 * Purpose: Composition root — wires concrete adapters to port interfaces.
 * Scope: All adapter construction lives here. Returns typed container against port interfaces.
 * Invariants:
 * - Only file that imports concrete adapter packages (@cogni/db-client)
 * - activities/ and workflows/ import ports only, never this module
 * Side-effects: Creates DB connection pool
 * Links: services/scheduler-worker/src/ports/index.ts
 * @internal
 */

import {
  DrizzleExecutionGrantWorkerAdapter,
  DrizzleScheduleRunAdapter,
} from "@cogni/db-client";
import { createServiceDbClient } from "@cogni/db-client/service";

import type { Logger } from "../observability/logger.js";

import type {
  ExecutionGrantWorkerPort,
  ScheduleRunRepository,
} from "../ports/index.js";
import type { Env } from "./env.js";

/**
 * Service container — all deps typed against port interfaces.
 * Passed to createActivities() and any future consumers.
 */
export interface ServiceContainer {
  grantAdapter: ExecutionGrantWorkerPort;
  runAdapter: ScheduleRunRepository;
  config: {
    appBaseUrl: string;
    schedulerApiToken: string;
  };
  logger: Logger;
}

/**
 * Build the service container from validated env and logger.
 * This is the only place that instantiates concrete adapters.
 */
export function createContainer(config: Env, logger: Logger): ServiceContainer {
  const db = createServiceDbClient(config.DATABASE_URL);

  return {
    grantAdapter: new DrizzleExecutionGrantWorkerAdapter(
      db,
      logger.child?.({ component: "grant-adapter" }) ?? logger
    ),
    runAdapter: new DrizzleScheduleRunAdapter(
      db,
      logger.child?.({ component: "run-adapter" }) ?? logger
    ),
    config: {
      appBaseUrl: config.APP_BASE_URL,
      schedulerApiToken: config.SCHEDULER_API_TOKEN,
    },
    logger,
  };
}
