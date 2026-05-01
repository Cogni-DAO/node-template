// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/internal/work/notion/sync`
 * Purpose: Internal prototype endpoint that syncs Dolt-backed work items with a Notion data source.
 * Scope: Bearer-protected POST endpoint. Delegates sync orchestration to bootstrap job.
 * Invariants:
 * - INTERNAL_OPS_AUTH: Requires Bearer INTERNAL_OPS_TOKEN.
 * - DOLT_IS_SOURCE_OF_TRUTH: Endpoint patches Dolt from Notion edits, then projects canonical Dolt state back.
 * Side-effects: IO (HTTP response, Doltgres work item port, Notion API)
 * Links: docs/spec/work-items-port.md
 * @internal
 */

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { runWorkItemsNotionSyncJob } from "@/bootstrap/jobs/syncWorkItemsNotion.job";
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
  { routeId: "work.notion.sync.internal", auth: { mode: "none" } },
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

    const providedToken = extractBearerToken(
      request.headers.get("authorization")
    );
    if (!providedToken || !safeCompare(providedToken, configuredToken)) {
      ctx.log.warn("Invalid or missing INTERNAL_OPS_TOKEN");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const parsedLimit =
      body && typeof body === "object" && "limit" in body
        ? Number(body.limit)
        : undefined;
    const syncOptions =
      parsedLimit !== undefined &&
      Number.isFinite(parsedLimit) &&
      parsedLimit > 0
        ? { limit: parsedLimit }
        : {};
    const summary = await runWorkItemsNotionSyncJob(syncOptions);

    ctx.log.info(
      {
        scanned: summary.scanned,
        created: summary.created,
        updated: summary.updated,
        appliedPatches: summary.appliedPatches,
        conflicts: summary.conflicts,
        errors: summary.errors.length,
      },
      "work.notion.sync_success"
    );

    return NextResponse.json(summary);
  }
);
