// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/health`
 * Purpose: HTTP endpoint providing health check status for liveness and readiness probes with runtime secret preflight.
 * Scope: Returns service health status; validates runtime secrets at adapter boundary. Does not include detailed system diagnostics.
 * Invariants: Always returns valid health schema; force-dynamic runtime; fails with RuntimeSecretError if secrets missing in production.
 * Side-effects: IO (HTTP response)
 * Notes: Preflights assertRuntimeSecrets() to fail-fast on misconfiguration before accepting traffic.
 * Links: `@contracts/meta.health.read.v1.contract`, src/shared/env/invariants.ts, monitoring systems
 * @public
 */

import { NextResponse } from "next/server";

import { metaHealthOperation } from "@/contracts/meta.health.read.v1.contract";
import { EnvValidationError, serverEnv } from "@/shared/env";
import {
  assertRuntimeSecrets,
  RuntimeSecretError,
} from "@/shared/env/invariants";

export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  try {
    const env = serverEnv();
    // Preflight: Validate runtime secrets before traffic (fail-fast on misconfiguration)
    assertRuntimeSecrets(env);

    const payload = {
      status: "healthy" as const,
      timestamp: new Date().toISOString(),
      version: "0",
    };

    const parsed = metaHealthOperation.output.parse(payload);
    return NextResponse.json(parsed);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      return new NextResponse(
        JSON.stringify({
          status: "error",
          reason: error.meta.code,
          details: error.meta,
        }),
        {
          status: 500,
          headers: { "content-type": "application/json" },
        }
      );
    }

    // Runtime secret validation failures (typed error from assertRuntimeSecrets)
    if (error instanceof RuntimeSecretError) {
      return new NextResponse(
        JSON.stringify({
          status: "error",
          reason: error.code,
          message: error.message,
        }),
        {
          status: 500,
          headers: { "content-type": "application/json" },
        }
      );
    }

    return new NextResponse(
      JSON.stringify({
        status: "error",
        reason: "INTERNAL_ERROR",
      }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      }
    );
  }
}
