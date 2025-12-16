// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@instrumentation`
 * Purpose: Next.js instrumentation hook for OpenTelemetry SDK initialization.
 * Scope: Initialize OTel SDK once per Node.js process; provide trace context for request correlation. Does NOT export SDK instance or run during build.
 * Invariants:
 *   - OTel init happens ONLY in this file (not container module-load)
 *   - Must await sdk.start() and hard-fail in non-dev if startup fails
 *   - Service name via OTEL_SERVICE_NAME env var (not constructor option)
 *   - No auto-instrumentation for P0 (explicit spans only)
 *   - P0 has NO OTel exporter (IDs + Langfuse only; no Tempo/Grafana traces yet)
 * Side-effects: IO (OTel SDK global state initialization)
 * Notes: Next.js calls register() once per Node.js process on startup.
 * Links: AI_SETUP_SPEC.md, bootstrap/otel.ts for span helpers
 * @public
 */

import { NodeSDK } from "@opentelemetry/sdk-node";

let sdk: NodeSDK | null = null;

/**
 * Next.js instrumentation hook - called once per Node.js process.
 * Initializes OpenTelemetry SDK for distributed tracing.
 *
 * Per AI_SETUP_SPEC.md:
 * - Service name via OTEL_SERVICE_NAME env var (SDK reads it automatically)
 * - No auto-instrumentation for P0 (explicit spans only)
 * - No exporter for P0 (IDs + Langfuse only; no Tempo/Grafana traces yet)
 * - Hard-fail in non-dev if startup fails
 */
export async function register(): Promise<void> {
  // Only initialize OTel in Node.js runtime (allowlist, not denylist)
  // biome-ignore lint/style/noProcessEnv: NEXT_RUNTIME is set by Next.js, no config file
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  // Skip if already initialized (shouldn't happen, but defensive)
  if (sdk !== null) {
    return;
  }

  // P0: No exporter configured - we only need trace IDs for correlation
  // Future P2: Add OTLP exporter for Tempo/Grafana
  sdk = new NodeSDK({
    // Service name read from OTEL_SERVICE_NAME env var (SDK default behavior)
    // No instrumentations for P0 (explicit spans only via withRootSpan)
    instrumentations: [],
  });

  try {
    await sdk.start();

    // Log successful initialization (console since Pino may not be ready)
    // biome-ignore lint/suspicious/noConsole: OTel init happens before logging is available
    console.log("[instrumentation] OTel SDK started successfully");
  } catch (error) {
    // biome-ignore lint/style/noProcessEnv: NODE_ENV is standard Next.js runtime env
    const isDev = process.env.NODE_ENV === "development";

    // biome-ignore lint/suspicious/noConsole: OTel init happens before logging is available
    console.error("[instrumentation] OTel SDK startup failed:", error);

    if (!isDev) {
      // Hard-fail in non-dev environments (per AI_SETUP_SPEC.md)
      throw error;
    }
    // In dev, continue without OTel (graceful degradation)
  }
}

/**
 * Get the initialized SDK instance.
 * Returns null if SDK not initialized (Edge runtime or initialization failed).
 * @internal - Use withRootSpan() from bootstrap/otel.ts instead
 */
export function getOtelSdk(): NodeSDK | null {
  return sdk;
}
