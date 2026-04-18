// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/copy-trade/targets`
 * Purpose: HTTP GET — list wallets the operator is monitoring / copy-trading. v0 returns the single env-derived target; P2 returns rows from `poly_copy_trade_targets`.
 * Scope: Thin validator — parses query params, reads env + kill-switch, maps to contract response. No DB writes; no business logic.
 * Invariants: Response shape is contract-defined; HARDCODED_USER noted inline.
 * Side-effects: IO (reads env + `poly_copy_trade_config` via OrderLedger.snapshotState for `enabled`).
 * Notes: Authenticated via session. Single-operator prototype — response is not user-scoped. Follow-up: multi-tenant per-user target lists (task.0315 P2).
 * Links: docs/spec/poly-copy-trade-phase1.md, work/items/task.0315.poly-copy-trade-prototype.md
 * @public
 */

import {
  type PolyCopyTradeTarget,
  polyCopyTradeTargetsOperation,
} from "@cogni/node-contracts";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { targetIdFromWallet } from "@/bootstrap/jobs/copy-trade-mirror.job";
import { serverEnv } from "@/shared/env/server-env";

export const dynamic = "force-dynamic";

export const GET = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.copy_trade.targets",
    auth: { mode: "required", getSessionUser },
  },
  // TODO(HARDCODED_USER): response ignores `sessionUser` — single-operator
  // prototype. Multi-tenant targets land in task.0315 P2; when they do,
  // resolve per-user targets via `poly_copy_trade_targets.owner_id = sessionUser.id`.
  async (_ctx, _request, _sessionUser) => {
    const env = serverEnv();
    const targets: PolyCopyTradeTarget[] = [];
    if (env.COPY_TRADE_TARGET_WALLET) {
      const target_wallet = env.COPY_TRADE_TARGET_WALLET as `0x${string}`;
      targets.push({
        target_id: targetIdFromWallet(target_wallet),
        target_wallet,
        mode: env.COPY_TRADE_MODE,
        mirror_usdc: env.COPY_TRADE_MIRROR_USDC,
        max_daily_usdc: env.COPY_TRADE_MAX_DAILY_USDC,
        max_fills_per_hour: env.COPY_TRADE_MAX_FILLS_PER_HOUR,
        enabled: true, // global kill-switch is represented separately (see /api/v1/poly/wallet/balance status; dashboard will surface)
        source: "env",
      });
    }
    return NextResponse.json(
      polyCopyTradeTargetsOperation.output.parse({ targets })
    );
  }
);
