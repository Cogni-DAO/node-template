// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/readyz`
 * Purpose: HTTP endpoint providing readiness check with full validation (env, secrets, EVM RPC config).
 * Scope: Returns service readiness status; validates env, runtime secrets, and EVM RPC URL. MVP: env+secrets+RPC config only. Does not check DB connectivity yet.
 * Invariants: Always returns valid readyz schema; force-dynamic runtime; returns 503 if env/secrets/RPC config invalid.
 * Side-effects: IO (HTTP response)
 * Notes: Used by Docker HEALTHCHECK, deployment validation, K8s readiness probes.
 *        HTTP status is primary truth: 200 = ready, 503 = not ready.
 * Links: `@contracts/meta.readyz.read.v1.contract`, src/shared/env/invariants.ts, src/app/(infra)/livez/route.ts
 * @public
 */

import { NextResponse } from "next/server";

import { getContainer } from "@/bootstrap/container";
import { metaReadyzOperation } from "@/contracts/meta.readyz.read.v1.contract";
import { EnvValidationError, serverEnv } from "@/shared/env";
import {
  assertEvmRpcConfig,
  assertEvmRpcConnectivity,
  assertRuntimeSecrets,
  RuntimeSecretError,
} from "@/shared/env/invariants";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const env = serverEnv();
    const container = getContainer();

    // MVP readiness: Validate env + runtime secrets + EVM RPC config + connectivity
    assertRuntimeSecrets(env);
    assertEvmRpcConfig(env);

    // Test RPC connectivity (3s budget, triggers lazy ViemEvmOnchainClient init)
    // This catches missing/invalid EVM_RPC_URL immediately after deploy
    await assertEvmRpcConnectivity(container.evmOnchainClient, env);

    const payload = {
      status: "healthy" as const,
      timestamp: new Date().toISOString(),
      version: "0",
    };

    const parsed = metaReadyzOperation.output.parse(payload);
    return NextResponse.json(parsed);
  } catch (error) {
    // HTTP status is primary truth for K8s: 503 = not ready
    if (error instanceof EnvValidationError) {
      return new NextResponse(
        JSON.stringify({
          status: "error",
          reason: error.meta.code,
          details: error.meta,
        }),
        {
          status: 503, // Service Unavailable - not ready
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
          status: 503, // Service Unavailable - not ready
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
        status: 503, // Service Unavailable - not ready
        headers: { "content-type": "application/json" },
      }
    );
  }
}
