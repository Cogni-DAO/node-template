// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/payments/resmic/summary`
 * Purpose: HTTP endpoint to fetch billing balance and recent credit ledger entries for Resmic UI.
 * Scope: Enforces SIWE session, validates query params, delegates to payments facade; does not access database directly.
 * Invariants: Billing account derived from session only; returns ledger ordered newest first.
 * Side-effects: IO (reads billing data via AccountService port).
 * Notes: Used by /credits page for balance and history display.
 * Links: docs/RESMIC_PAYMENTS.md
 * @public
 */

import { type NextRequest, NextResponse } from "next/server";

import { getResmicSummaryFacade } from "@/app/_facades/payments/resmic.server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { resmicSummaryOperation } from "@/contracts/payments.resmic.summary.v1.contract";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
      return NextResponse.json({ error: "Session required" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const parsedLimit = searchParams.get("limit");
    const limit = parsedLimit ? Number(parsedLimit) : undefined;

    const input = resmicSummaryOperation.input.parse({ limit });

    const summary = await getResmicSummaryFacade({
      sessionUser,
      limit: input.limit,
    });

    const serialized = {
      ...summary,
      ledger: summary.ledger.map((entry) => ({
        ...entry,
        createdAt: entry.createdAt.toISOString(),
      })),
    };

    return NextResponse.json(resmicSummaryOperation.output.parse(serialized));
  } catch (error) {
    if (error && typeof error === "object" && "issues" in error) {
      return NextResponse.json(
        {
          error: "Invalid query",
          details: (error as { issues: unknown }).issues,
        },
        { status: 400 }
      );
    }

    console.error("Resmic summary error", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
