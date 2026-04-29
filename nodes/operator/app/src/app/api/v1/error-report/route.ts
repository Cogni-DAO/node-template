// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/error-report`
 * Purpose: "Send to Cogni" intake endpoint — accepts a structured error
 *   report from the UI's error boundaries (or any future surface) and
 *   persists it to `error_reports` for downstream agent triage.
 * Scope: Auth-required POST (SIWE session OR agent Bearer key — both
 *   resolved by getSessionUser). Mints a server-side trackingId, inserts
 *   the row synchronously, emits a structured Pino line carrying the
 *   `digest` so the report shows up in Loki at the deployed SHA. Does
 *   NOT pull a Loki window in v0-of-v0 (task.0420 adds that via Temporal).
 * Invariants:
 *   - AUTH_REQUIRED: session OR agent API key. Truly-anonymous browser
 *     users (signed-out, hitting `(public)/error.tsx`) cannot submit in
 *     v0-of-v0. Widening to anon is deferred — it conflicts with the
 *     edge-auth shield on candidate-a anyway. Tracked in spike.0424.
 *   - BOUNDED_INTAKE: per-IP token-bucket rate limit + Zod byte caps,
 *     belt-and-suspenders alongside auth.
 *   - DIGEST_IS_CORRELATION_KEY: the structured log line includes
 *     `event: "error_report.intake"` and `digest`/`trackingId`/`build_sha`
 *     as fields so an agent can later join Loki ↔ DB ↔ deployed build.
 *   - SERVER_STAMPS_BUILD_SHA: build_sha comes from server env, not the
 *     client.
 *   - SERVER_STAMPS_USER_ID: user id comes from the resolved session,
 *     never from the client payload.
 * Side-effects: IO (DB insert, Pino log line, rate-limiter state).
 * Links: work/items/task.0426.send-to-cogni-error-intake-v0.md, contracts/error-report.v1.contract
 * @public
 */

import { randomUUID } from "node:crypto";
import { errorReports } from "@cogni/db-schema";
import { errorReportOperation } from "@cogni/node-contracts";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { resolveServiceDb } from "@/bootstrap/container";
import {
  extractClientIp,
  publicApiLimiter,
  wrapRouteHandlerWithLogging,
} from "@/bootstrap/http";
import { serverEnv } from "@/shared/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NODE_NAME = "operator";

export const POST = wrapRouteHandlerWithLogging(
  {
    routeId: "errors.send-to-cogni",
    auth: { mode: "required", getSessionUser },
  },
  async (ctx, request, sessionUser) => {
    // BOUNDED_INTAKE — per-IP token bucket. Belt-and-suspenders alongside
    // auth: even with a valid session/key, an attacker controlling one
    // identity can't flood the table.
    const clientIp = extractClientIp(request);
    if (!publicApiLimiter.consume(clientIp)) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = errorReportOperation.input.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.format() },
        { status: 400 }
      );
    }
    const input = parsed.data;

    const trackingId = randomUUID();
    const env = serverEnv();
    const buildSha = env.APP_BUILD_SHA ?? null;

    const db = resolveServiceDb();
    await db.insert(errorReports).values({
      id: trackingId,
      node: NODE_NAME,
      buildSha,
      userId: sessionUser.id,
      digest: input.digest ?? null,
      route: input.route,
      errorName: input.errorName,
      errorMessage: input.errorMessage,
      errorStack: input.errorStack ?? null,
      componentStack: input.componentStack ?? null,
      userNote: input.userNote ?? null,
      userAgent: input.userAgent ?? null,
      clientTs: input.clientTs ? new Date(input.clientTs) : null,
      lokiWindow: null,
      lokiStatus: "pending",
    });

    // DIGEST_IS_CORRELATION_KEY — this is the line an agent later finds in
    // Loki to join the persisted report back to the failing request log.
    ctx.log.info(
      {
        event: "error_report.intake",
        trackingId,
        digest: input.digest ?? null,
        route: input.route,
        errorName: input.errorName,
        userId: sessionUser.id,
        node: NODE_NAME,
        build_sha: buildSha,
      },
      "error_report.intake"
    );

    return NextResponse.json(
      errorReportOperation.output.parse({
        trackingId,
        status: "received",
      }),
      { status: 202 }
    );
  }
);
