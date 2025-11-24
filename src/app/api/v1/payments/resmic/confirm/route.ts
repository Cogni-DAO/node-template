// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/payments/resmic/confirm`
 * Purpose: HTTP endpoint to confirm Resmic payments and credit billing accounts.
 * Scope: Validates request/response with contract, enforces SIWE session, delegates to facade; does not perform database access directly.
 * Invariants: Billing account derived from session only; idempotent on clientPaymentId.
 * Side-effects: IO (writes credit ledger entries and updates billing balance via AccountService port).
 * Notes: Resmic is a frontend-only payment widget; no on-chain verification occurs here.
 * Links: docs/RESMIC_PAYMENTS.md
 * @public
 */

import { type NextRequest, NextResponse } from "next/server";

import { confirmResmicPaymentFacade } from "@/app/_facades/payments/resmic.server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { resmicConfirmOperation } from "@/contracts/payments.resmic.confirm.v1.contract";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
      return NextResponse.json({ error: "Session required" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const input = resmicConfirmOperation.input.parse(body);

    const result = await confirmResmicPaymentFacade({
      sessionUser,
      ...input,
    });

    return NextResponse.json(resmicConfirmOperation.output.parse(result));
  } catch (error) {
    if (error && typeof error === "object" && "issues" in error) {
      return NextResponse.json(
        {
          error: "Invalid input format",
          details: (error as { issues: unknown }).issues,
        },
        { status: 400 }
      );
    }

    console.error("Resmic confirm error", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
