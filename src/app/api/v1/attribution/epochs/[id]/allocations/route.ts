// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/attribution/epochs/[id]/allocations/route`
 * Purpose: Read-only epoch allocations endpoint + deprecated PATCH (410 Gone).
 * Scope: Auth-protected GET endpoint for listing allocations. PATCH returns 410 — use subject-overrides instead. Does not perform override writes or finalization logic.
 * Invariants: NODE_SCOPED, VALIDATE_IO.
 * Side-effects: IO (HTTP response, database read)
 * Links: docs/spec/attribution-ledger.md, contracts/attribution.epoch-allocations.v1.contract
 * @public
 */

import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { toAllocationDto } from "@/app/api/v1/public/attribution/_lib/attribution-dto";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { epochAllocationsOperation } from "@/contracts/attribution.epoch-allocations.v1.contract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = wrapRouteHandlerWithLogging<{
  params: Promise<{ id: string }>;
}>(
  {
    routeId: "ledger.epoch-allocations",
    auth: { mode: "required", getSessionUser },
  },
  async (_ctx, _request, _sessionUser, context) => {
    if (!context) throw new Error("context required for dynamic routes");
    const { id } = await context.params;
    let epochId: bigint;
    try {
      epochId = BigInt(id);
    } catch {
      return NextResponse.json({ error: "Invalid epoch ID" }, { status: 400 });
    }

    const store = getContainer().attributionStore;
    const epoch = await store.getEpoch(epochId);
    if (!epoch) {
      return NextResponse.json({ error: "Epoch not found" }, { status: 404 });
    }

    const allocations = await store.getAllocationsForEpoch(epochId);

    return NextResponse.json(
      epochAllocationsOperation.output.parse({
        allocations: allocations.map(toAllocationDto),
        epochId: id,
      })
    );
  }
);

export const PATCH = wrapRouteHandlerWithLogging<{
  params: Promise<{ id: string }>;
}>(
  {
    routeId: "ledger.update-allocations",
    auth: { mode: "required", getSessionUser },
  },
  async (_ctx, _request, _sessionUser, _context) => {
    return NextResponse.json(
      {
        error:
          "Per-user allocation overrides are deprecated. Use PATCH /epochs/[id]/subject-overrides for review-phase editing.",
      },
      { status: 410 }
    );
  }
);
