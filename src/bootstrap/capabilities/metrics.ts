// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/capabilities/metrics`
 * Purpose: Factory for MetricsCapability - bridges ai-tools capability interface to MimirMetricsAdapter.
 * Scope: Creates MetricsCapability from server environment. Does not implement transport.
 * Invariants:
 *   - NO_SECRETS_IN_CONTEXT: Mimir credentials resolved from env, never passed to tools
 *   - GOVERNED_METRICS: Only template-based queries via MimirMetricsAdapter.queryTemplate
 * Side-effects: none (factory only)
 * Links: Called by bootstrap container; consumed by ai-tools metrics-query tool.
 * @internal
 */

import type { MetricsCapability } from "@cogni/ai-tools";

import { MimirMetricsAdapter } from "@/adapters/server";
import { FakeMetricsAdapter } from "@/adapters/test";
import type { ServerEnv } from "@/shared/env";

/**
 * Stub MetricsCapability that throws when not configured.
 * Used when MIMIR_URL is not set.
 */
export const stubMetricsCapability: MetricsCapability = {
  queryTemplate: async () => {
    throw new Error(
      "MetricsCapability not configured. " +
        "Set MIMIR_URL, MIMIR_USER, and MIMIR_TOKEN environment variables."
    );
  },
};

/**
 * Create MetricsCapability from server environment.
 * Uses existing Mimir configuration (MIMIR_URL, MIMIR_USER, MIMIR_TOKEN).
 *
 * Per test mode pattern: returns FakeMetricsAdapter-backed capability in test mode,
 * matching how metricsQuery port is handled in container.ts.
 *
 * @param env - Server environment with Mimir configuration
 * @returns MetricsCapability backed by appropriate adapter
 */
export function createMetricsCapability(env: ServerEnv): MetricsCapability {
  // Test mode: use FakeMetricsAdapter (matches metricsQuery port pattern)
  if (env.isTestMode) {
    const fakeAdapter = new FakeMetricsAdapter();
    return {
      queryTemplate: (params) => fakeAdapter.queryTemplate(params),
    };
  }

  // Production/dev: require Mimir configuration
  if (!env.MIMIR_URL || !env.MIMIR_USER || !env.MIMIR_TOKEN) {
    return stubMetricsCapability;
  }

  const adapter = new MimirMetricsAdapter({
    url: env.MIMIR_URL,
    username: env.MIMIR_USER,
    password: env.MIMIR_TOKEN,
    timeoutMs: env.ANALYTICS_QUERY_TIMEOUT_MS,
  });

  return {
    queryTemplate: (params) => adapter.queryTemplate(params),
  };
}
