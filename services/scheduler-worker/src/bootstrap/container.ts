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

import { createValidatedAttributionStore } from "@cogni/attribution-ledger";
import {
  DrizzleAttributionAdapter,
  DrizzleExecutionGrantWorkerAdapter,
  DrizzleScheduleRunAdapter,
} from "@cogni/db-client";
import { createServiceDbClient } from "@cogni/db-client/service";

import {
  GitHubAppTokenProvider,
  GitHubSourceAdapter,
} from "../adapters/ingestion/index.js";
import { logWorkerEvent, WORKER_EVENT_NAMES } from "../observability/index.js";
import type { Logger } from "../observability/logger.js";

import type {
  AttributionStore,
  ExecutionGrantWorkerPort,
  ScheduleRunRepository,
  SourceAdapter,
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
 * Hardcoded identity from .cogni/repo-spec.yaml.
 * HACK: Temporary constants until task.0120 (@cogni/repo-spec package) replaces
 * this with proper parsed repo-spec reading.
 */
const REPO_SPEC_NODE_ID = "4ff8eac1-4eba-4ed0-931b-b1fe4f64713d";
const REPO_SPEC_SCOPE_ID = "a28a8b1e-1f9d-5cd5-9329-569e4819feda";
const REPO_SPEC_CHAIN_ID = 8453;

/**
 * Ledger container — deps for ledger activities.
 * Created separately because ledger env vars (NODE_ID, SCOPE_ID) are optional.
 */
export interface AttributionContainer {
  attributionStore: AttributionStore;
  sourceAdapters: ReadonlyMap<string, SourceAdapter>;
  nodeId: string;
  scopeId: string;
  chainId: number;
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

/**
 * Build ledger container. Requires NODE_ID and SCOPE_ID in env.
 * Returns null if ledger env vars are not configured.
 */
export function createAttributionContainer(
  config: Env,
  logger: Logger
): AttributionContainer | null {
  // HACK: Hardcoded from .cogni/repo-spec.yaml until task.0120
  // (@cogni/repo-spec package) replaces this with proper parsing.
  const nodeId = REPO_SPEC_NODE_ID;
  const scopeId = REPO_SPEC_SCOPE_ID;
  const chainId = REPO_SPEC_CHAIN_ID;

  logWorkerEvent(logger, WORKER_EVENT_NAMES.LIFECYCLE_STARTING, {
    phase: "ledger_container",
    nodeId,
    scopeId,
    chainId,
  });

  const db = createServiceDbClient(config.DATABASE_URL);
  const attributionLogger = logger.child?.({ component: "ledger" }) ?? logger;

  const attributionStore = createValidatedAttributionStore(
    new DrizzleAttributionAdapter(db, scopeId)
  );

  // Build source adapters
  const adapters = new Map<string, SourceAdapter>();

  if (
    config.GITHUB_REVIEW_APP_ID &&
    config.GITHUB_REVIEW_APP_PRIVATE_KEY_BASE64
  ) {
    const privateKey = Buffer.from(
      config.GITHUB_REVIEW_APP_PRIVATE_KEY_BASE64,
      "base64"
    ).toString("utf-8");

    const tokenProvider = new GitHubAppTokenProvider({
      appId: config.GITHUB_REVIEW_APP_ID,
      privateKey,
      installationId: config.GITHUB_REVIEW_INSTALLATION_ID,
    });

    const repos =
      config.GITHUB_REPOS?.split(",")
        .map((r) => r.trim())
        .filter(Boolean) ?? [];

    if (repos.length > 0) {
      adapters.set(
        "github",
        new GitHubSourceAdapter({ tokenProvider, repos }, attributionLogger)
      );
    } else {
      logger.warn(
        "GITHUB_REVIEW_APP_ID set but GITHUB_REPOS empty — GitHub adapter skipped"
      );
    }
  }

  return {
    attributionStore,
    sourceAdapters: adapters,
    nodeId,
    scopeId,
    chainId,
    logger: attributionLogger,
  };
}
