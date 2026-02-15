// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/internal/ops/governance/schedules/sync`
 * Purpose: Internal operations endpoint that triggers governance schedule synchronization.
 * Scope: Auth-protected POST endpoint for deploy automation. Delegates to bootstrap job; does not implement sync logic.
 * Invariants:
 *   - INTERNAL_OPS_AUTH: Requires Bearer INTERNAL_OPS_TOKEN
 *   - DISABLED_IS_NOOP: Returns 204 when GOVERNANCE_SCHEDULES_ENABLED is false
 *   - JOB_DELEGATION_ONLY: Uses runGovernanceSchedulesSyncJob() for all orchestration
 * Side-effects: IO (HTTP request/response, DB advisory lock, Temporal RPC via job)
 * Links: docs/spec/governance-scheduling.md, governance-schedules-sync.internal.v1.contract
 * @internal
 */

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { runGovernanceSchedulesSyncJob } from "@/bootstrap/jobs/syncGovernanceSchedules.job";
import { GovernanceSchedulesSyncSummarySchema } from "@/contracts/governance-schedules-sync.internal.v1.contract";
import { serverEnv } from "@/shared/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_AUTH_HEADER_LENGTH = 512;
const MAX_TOKEN_LENGTH = 256;

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  if (authHeader.length > MAX_AUTH_HEADER_LENGTH) return null;

  const trimmed = authHeader.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;

  const token = trimmed.slice(7).trim();
  if (token.length > MAX_TOKEN_LENGTH) return null;

  return token;
}

export const POST = wrapRouteHandlerWithLogging(
  { routeId: "governance.schedules.sync.internal", auth: { mode: "none" } },
  async (ctx, request) => {
    const env = serverEnv();

    const configuredToken = env.INTERNAL_OPS_TOKEN;
    if (!configuredToken) {
      ctx.log.error("INTERNAL_OPS_TOKEN not configured");
      return NextResponse.json(
        { error: "Service not configured" },
        { status: 500 }
      );
    }

    const authHeader = request.headers.get("authorization");
    const providedToken = extractBearerToken(authHeader);
    if (!providedToken || !safeCompare(providedToken, configuredToken)) {
      ctx.log.warn("Invalid or missing INTERNAL_OPS_TOKEN");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!env.GOVERNANCE_SCHEDULES_ENABLED) {
      return new NextResponse(null, { status: 204 });
    }

    const summary = await runGovernanceSchedulesSyncJob();
    return NextResponse.json(
      GovernanceSchedulesSyncSummarySchema.parse(summary),
      { status: 200 }
    );
  }
);
