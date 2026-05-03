// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/unit/app/wallets-table-buildRows`
 * Purpose: Locks dashboard copy-traded wallet row enrichment precedence.
 * Scope: Pure unit test. No React, no network.
 * Invariants: Direct wallet-analysis summaries beat leaderboard fallbacks for copy-traded rows.
 * Side-effects: none
 * Links: nodes/poly/app/src/app/(app)/_components/wallets-table/buildWalletRows.ts
 * @public
 */

import type { WalletTopTraderItem } from "@cogni/poly-ai-tools";
import type { PolyCopyTradeTarget } from "@cogni/poly-node-contracts";
import { describe, expect, it } from "vitest";

import { buildCopyTradedWalletRows } from "@/app/(app)/_components/wallets-table/buildWalletRows";

const TARGET_WALLET = "0x204f72f35326db932158cba6adff0b9a1da95e14";

function target(): PolyCopyTradeTarget {
  return {
    target_id: "11111111-1111-4111-8111-111111111111",
    target_wallet: TARGET_WALLET,
    mode: "live",
    mirror_usdc: 5,
    mirror_filter_percentile: 75,
    mirror_max_usdc_per_trade: 5,
    sizing_policy_kind: "target_percentile_scaled",
    source: "db",
  };
}

function trader(overrides: Partial<WalletTopTraderItem>): WalletTopTraderItem {
  return {
    rank: 99,
    proxyWallet: TARGET_WALLET,
    userName: TARGET_WALLET,
    volumeUsdc: 0,
    pnlUsdc: 0,
    roiPct: null,
    numTrades: 0,
    numTradesCapped: false,
    verified: false,
    ...overrides,
  };
}

describe("buildCopyTradedWalletRows", () => {
  it("uses direct wallet-analysis stats before leaderboard or all-time fallback data", () => {
    const direct = trader({
      volumeUsdc: 123,
      pnlUsdc: 12,
      roiPct: 9.756,
      numTrades: 7,
    });
    const leaderboard = trader({
      volumeUsdc: 456,
      pnlUsdc: 45,
      numTrades: 50,
    });
    const fallback = trader({
      volumeUsdc: 789,
      pnlUsdc: 78,
      numTrades: 500,
    });

    const rows = buildCopyTradedWalletRows(
      [target()],
      new Map([[TARGET_WALLET, leaderboard]]),
      new Map([[TARGET_WALLET, fallback]]),
      new Map([[TARGET_WALLET, direct]])
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      proxyWallet: TARGET_WALLET,
      tracked: true,
      targetId: "11111111-1111-4111-8111-111111111111",
      statsSource: "wallet-analysis",
      volumeUsdc: 123,
      pnlUsdc: 12,
      numTrades: 7,
    });
  });
});
