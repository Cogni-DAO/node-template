// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@shared/observability/logging/logger`
 * Purpose: Pino logger factory with environment-based configuration.
 * Scope: Create configured pino loggers. Does not handle request-scoped logging.
 * Invariants: Development uses pino-pretty, production uses stdout JSON, tests disabled.
 * Side-effects: none
 * Notes: Use makeLogger for app logger; use makeNoopLogger for tests. Cross-cutting observability concern.
 * Links: Initializes redaction paths via REDACT_PATHS; used by container and route handlers.
 * @public
 */

import type { Logger } from "pino";
import pino from "pino";

import { serverEnv } from "@/shared/env";
import { REDACT_PATHS } from "./redact";

export type { Logger } from "pino";

export function makeLogger(bindings?: Record<string, unknown>): Logger {
  // biome-ignore lint/style/noProcessEnv: Legitimate use for test tooling detection
  const isVitest = process.env.VITEST === "true";
  const env = serverEnv();

  // Silence logs in test tooling (VITEST or NODE_ENV=test) regardless of APP_ENV
  const isTestTooling = isVitest || env.NODE_ENV === "test";

  const config = {
    level: env.PINO_LOG_LEVEL,
    enabled: !isTestTooling,
    base: { app: "cogni-template", env: env.APP_ENV, ...bindings },
    messageKey: "msg",
    timestamp: pino.stdTimeFunctions.epochTime,
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  };

  // Dev: pretty transport, Prod: stdout JSON
  if (env.NODE_ENV === "development") {
    return pino({
      ...config,
      transport: { target: "pino-pretty", options: { singleLine: true } },
    });
  }

  return pino(config);
}

/**
 * For tests - pino with enabled:false (preserves type, silences output)
 */
export function makeNoopLogger(): Logger {
  return pino({ enabled: false });
}
