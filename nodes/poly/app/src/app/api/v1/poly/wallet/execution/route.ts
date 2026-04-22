// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/wallet/execution`
 * Purpose: HTTP GET — operator wallet execution positions for the dashboard.
 * Scope: Thin wrapper over the shared execution service. Auth required.
 * Invariants:
 *   - Returns an empty payload with a warning when the operator wallet is unconfigured.
 *   - Position rows are sourced from Polymarket trades + positions, not the mirror-order ledger.
 * Side-effects: IO (Polymarket Data API + CLOB public via the shared service).
 * @public
 */

import {
  PolyWalletExecutionOutputSchema,
  polyWalletExecutionOperation,
} from "@cogni/node-contracts";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { fetchOperatorExtras } from "@/app/_lib/poly/operator-extras";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { getExecutionSlice } from "@/features/wallet-analysis/server/wallet-analysis-service";
import { serverEnv } from "@/shared/env/server-env";

export const dynamic = "force-dynamic";

export const GET = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.wallet.execution",
    auth: { mode: "required", getSessionUser },
  },
  async () => {
    const env = serverEnv();
    const address = env.POLY_PROTO_WALLET_ADDRESS?.toLowerCase();

    if (!address) {
      return NextResponse.json(
        polyWalletExecutionOperation.output.parse({
          address: "0x0000000000000000000000000000000000000000",
          capturedAt: new Date().toISOString(),
          balanceHistory: [],
          dailyTradeCounts: [],
          positions: [],
          warnings: [
            {
              code: "operator_unconfigured",
              message: "POLY_PROTO_WALLET_ADDRESS not set",
            },
          ],
        })
      );
    }

    return NextResponse.json(
      PolyWalletExecutionOutputSchema.parse(
        await getExecutionSlice(address, fetchOperatorExtras)
      )
    );
  }
);
