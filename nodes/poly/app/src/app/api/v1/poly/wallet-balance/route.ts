// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/wallet-balance/route`
 * Purpose: Dashboard endpoint for the Operator Wallet card — USDC.e balance (Polygon), open-position MTM + PnL (Data API), and USDC locked in our mirror ledger.
 * Scope: Validates session, reads env-hardcoded POLY_PROTO_WALLET_ADDRESS, reads USDC.e ERC20 balance via viem, reads positions via the Polymarket Data API, and sums locked notional from `poly_copy_trade_fills`. No writes. No secrets beyond public RPC + DB.
 * Invariants:
 *   - AUTH_REQUIRED: Internal dashboard endpoint; session user must be present.
 *   - READ_ONLY: Only SELECT + read RPC + public Data API.
 *   - GRACEFUL_DEGRADE: Partial failures return 200 with `ok:false` + `error` so the UI keeps rendering.
 *   - SINGLE_TENANT_PROTOTYPE: Reads a single env-pinned wallet. See task.0315 Phase 2 for multi-operator auth.
 * Side-effects: IO (RPC, HTTPS, DB)
 * Links: work/items/task.0315.poly-copy-trade-prototype.md
 * @public
 */

// TODO(task.0315 P2 / single-tenant auth):
// This route reads POLY_PROTO_WALLET_ADDRESS from env — it assumes one
// operator wallet shared across all UI sessions. When multi-tenant Privy
// auth lands, resolve the wallet from the session user instead.

import { PolymarketDataApiClient } from "@cogni/market-provider/adapters/polymarket";
import { inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { createPublicClient, erc20Abi, http } from "viem";
import { polygon } from "viem/chains";
import { resolveAppDb } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { getServerSessionUser } from "@/lib/auth/server";
import { polyCopyTradeFills } from "@/shared/db/schema";
import { serverEnv } from "@/shared/env";

/** USDC.e on Polygon — 6 decimals. */
const USDC_E_POLYGON = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;
const USDC_DECIMALS = 6;

/** Open mirror-order statuses used to compute `lockedInOrders`. */
const LOCKED_STATUSES = ["pending", "open", "partial"] as const;

export const dynamic = "force-dynamic";

export const GET = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.wallet-balance",
    auth: { mode: "required", getSessionUser: getServerSessionUser },
  },
  async () => {
    const env = serverEnv();
    const wallet = env.POLY_PROTO_WALLET_ADDRESS ?? null;

    if (!wallet) {
      return NextResponse.json(
        {
          wallet: null,
          usdcAvailable: 0,
          positionsMtmValue: 0,
          positionsPnl: 0,
          lockedInOrders: 0,
          openOrderCount: 0,
          ok: false,
          error: "POLY_PROTO_WALLET_ADDRESS not configured",
        },
        { status: 200 }
      );
    }

    const errors: string[] = [];

    // 1. USDC.e balance via Polygon RPC (viem public client).
    const rpcUrl = env.EVM_RPC_URL;
    let usdcAvailable = 0;
    try {
      const client = createPublicClient({
        chain: polygon,
        transport: http(rpcUrl),
      });
      const raw = await client.readContract({
        address: USDC_E_POLYGON,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [wallet as `0x${string}`],
      });
      usdcAvailable = Number(raw) / 10 ** USDC_DECIMALS;
    } catch (err) {
      errors.push(`rpc: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 2. Open-position MTM + PnL via Polymarket Data API.
    let positionsMtmValue = 0;
    let positionsPnl = 0;
    try {
      const dataApi = new PolymarketDataApiClient();
      const positions = await dataApi.listUserPositions(wallet);
      for (const p of positions) {
        positionsMtmValue += p.currentValue;
        positionsPnl += p.cashPnl;
      }
    } catch (err) {
      errors.push(
        `data-api: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // 3. Locked-in-orders from our mirror ledger (poly_copy_trade_fills).
    // Attributes JSONB carries `size_usdc` per the OrderIntent shape written
    // by features/copy-trade/clob-executor. Fall back to 0 if missing.
    let lockedInOrders = 0;
    let openOrderCount = 0;
    try {
      const db = resolveAppDb();
      const rows = await db
        .select({
          sizeUsdc: sql<number>`COALESCE((${polyCopyTradeFills.attributes}->>'size_usdc')::numeric, 0)`,
        })
        .from(polyCopyTradeFills)
        .where(inArray(polyCopyTradeFills.status, [...LOCKED_STATUSES]));
      for (const r of rows) {
        lockedInOrders += Number(r.sizeUsdc) || 0;
      }
      openOrderCount = rows.length;
    } catch (err) {
      errors.push(`db: ${err instanceof Error ? err.message : String(err)}`);
    }

    return NextResponse.json(
      {
        wallet,
        usdcAvailable,
        positionsMtmValue,
        positionsPnl,
        lockedInOrders,
        openOrderCount,
        ok: errors.length === 0,
        error: errors.length ? errors.join("; ") : null,
      },
      { status: 200 }
    );
  }
);
