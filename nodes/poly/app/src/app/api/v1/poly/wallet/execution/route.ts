// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/wallet/execution`
 * Purpose: HTTP GET — legacy single-operator execution endpoint. Post-Stage-4
 *          purge (task.0318 Phase B3): the env-pinned POLY_PROTO_WALLET_ADDRESS
 *          wallet is gone and there is no replacement behind this route — the
 *          per-tenant Money-page rework owns user execution data and will land
 *          on a new, per-user route keyed by the session's funder_address. We
 *          keep this endpoint serving the contract shape (zero-address, empty
 *          arrays, `operator_wallet_removed_use_money_page` warning) so the
 *          dashboard's OperatorWalletChartsRow + ExecutionActivityCard render
 *          their empty states without throwing, and typed callers downstream
 *          of the contract type-check without changes.
 * Scope: Auth-gated tombstone. No upstream IO. Constant response body.
 * Invariants:
 *   - OPERATOR_ROUTE_DORMANT: no per-user dispatch lives here yet. A future
 *     PR replaces this route (or its caller surfaces) with a per-tenant
 *     execution feed driven by `PolyTraderWalletPort.getBalances` + a
 *     per-tenant open-order reader. See `task.0354` for the hardening
 *     follow-ups that track the rewire.
 *   - CONTRACT_STABLE: response shape matches `polyWalletExecutionOperation.output`
 *     — callers downstream of the contract type-check without changes.
 * Side-effects: none.
 * Links: packages/node-contracts/src/poly.wallet.execution.v1.contract.ts,
 *        work/items/task.0354.poly-trading-hardening-followups.md
 * @public
 */

import { polyWalletExecutionOperation } from "@cogni/node-contracts";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";

export const dynamic = "force-dynamic";

export const GET = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.wallet.execution",
    auth: { mode: "required", getSessionUser },
  },
  async (_ctx, _request, _sessionUser) => {
    return NextResponse.json(
      polyWalletExecutionOperation.output.parse({
        address: "0x0000000000000000000000000000000000000000",
        capturedAt: new Date().toISOString(),
        balanceHistory: [],
        dailyTradeCounts: [],
        positions: [],
        warnings: [
          {
            code: "operator_wallet_removed_use_money_page",
            message:
              "The single-operator execution feed was purged in task.0318 Phase B3. A per-tenant replacement lands with the Money-page rework.",
          },
        ],
      })
    );
  }
);
