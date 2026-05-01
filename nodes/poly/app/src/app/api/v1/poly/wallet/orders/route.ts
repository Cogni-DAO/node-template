// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/wallet/orders`
 * Purpose: HTTP GET — list of open/resting CLOB orders for the calling
 *   user's Polymarket trading wallet. Counterpart to /wallet/overview which
 *   only returns aggregate counts; this returns the full per-order list so
 *   the account-activity UI can render a paginated table.
 * Scope: Read-only, session-authenticated, tenant-scoped.
 * Invariants:
 *   - TENANT_SCOPED: caller's billing account resolved from session.
 *   - PARTIAL_FAILURE_NEVER_THROWS: upstream CLOB errors degrade to empty
 *     orders list + warning entry; route stays 200 like /overview does.
 * Side-effects: IO (DB read, CLOB read).
 * Links: bug.5000, /wallet/overview/route.ts
 * @public
 */

import { toUserId } from "@cogni/ids";
import { noopMetrics } from "@cogni/poly-market-provider";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import {
  createPolyTradeExecutorFactory,
  type OpenOrderSummary,
} from "@/bootstrap/capabilities/poly-trade-executor";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import {
  getPolyTraderWalletAdapter,
  WalletAdapterUnconfiguredError,
} from "@/bootstrap/poly-trader-wallet";
import { serverEnv } from "@/shared/env/server-env";

export const dynamic = "force-dynamic";

export type WalletOrdersResponse = {
  configured: boolean;
  connected: boolean;
  address: string | null;
  capturedAt: string;
  orders: OpenOrderSummary[];
  warnings: { code: string; message: string }[];
};

export const GET = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.wallet.orders",
    auth: { mode: "required", getSessionUser },
  },
  async (ctx, _request, sessionUser) => {
    if (!sessionUser) throw new Error("sessionUser required");
    const capturedAt = new Date().toISOString();
    const warnings: { code: string; message: string }[] = [];

    const container = getContainer();
    const account = await container
      .accountsForUser(toUserId(sessionUser.id))
      .getOrCreateBillingAccountForUser({ userId: sessionUser.id });

    let adapter: ReturnType<typeof getPolyTraderWalletAdapter>;
    try {
      adapter = getPolyTraderWalletAdapter(ctx.log);
    } catch (err) {
      if (err instanceof WalletAdapterUnconfiguredError) {
        return NextResponse.json<WalletOrdersResponse>({
          configured: false,
          connected: false,
          address: null,
          capturedAt,
          orders: [],
          warnings: [],
        });
      }
      throw err;
    }

    const address = await adapter.getAddress(account.id);
    if (!address) {
      return NextResponse.json<WalletOrdersResponse>({
        configured: true,
        connected: false,
        address: null,
        capturedAt,
        orders: [],
        warnings: [],
      });
    }

    let orders: OpenOrderSummary[] = [];
    try {
      const env = serverEnv();
      const executorFactory = createPolyTradeExecutorFactory({
        walletPort: adapter,
        logger: ctx.log,
        metrics: noopMetrics,
        host: env.POLY_CLOB_HOST,
        polygonRpcUrl: env.POLYGON_RPC_URL,
      });
      const executor = await executorFactory.getPolyTradeExecutorFor(
        account.id
      );
      orders = await executor.listOpenOrders();
    } catch (err) {
      warnings.push({
        code: "open_orders_unavailable",
        message: err instanceof Error ? err.message : String(err),
      });
    }

    return NextResponse.json<WalletOrdersResponse>({
      configured: true,
      connected: true,
      address,
      capturedAt,
      orders,
      warnings,
    });
  }
);
