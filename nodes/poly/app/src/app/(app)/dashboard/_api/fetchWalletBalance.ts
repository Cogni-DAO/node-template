// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_api/fetchWalletBalance`
 * Purpose: Client-side fetch for the Operator Wallet balance card. Calls GET /api/v1/poly/wallet-balance.
 * Scope: Data fetching only. Graceful empty state on failure.
 * Side-effects: IO (HTTP fetch)
 * @public
 */

export interface OperatorWalletBalance {
  /** The wallet address queried. Flagged single-operator; see task.0315 P2. */
  wallet: string | null;
  /** USDC.e balance on Polygon in dollars. */
  usdcAvailable: number;
  /** Sum of currentValue across open positions (Data API). */
  positionsMtmValue: number;
  /** Sum of cashPnl across open positions. */
  positionsPnl: number;
  /** Total USDC notional locked in pending/open/partial mirror orders (our ledger). */
  lockedInOrders: number;
  /** Count of pending/open/partial rows in our mirror ledger. */
  openOrderCount: number;
  /** Whether the underlying data sources all returned cleanly. */
  ok: boolean;
  /** Non-null when the route degraded (RPC / Data API / DB failures). */
  error: string | null;
}

const EMPTY: OperatorWalletBalance = {
  wallet: null,
  usdcAvailable: 0,
  positionsMtmValue: 0,
  positionsPnl: 0,
  lockedInOrders: 0,
  openOrderCount: 0,
  ok: false,
  error: "unavailable",
};

export async function fetchWalletBalance(): Promise<OperatorWalletBalance> {
  try {
    const res = await fetch("/api/v1/poly/wallet-balance");
    if (res.ok) {
      return (await res.json()) as OperatorWalletBalance;
    }
    if (res.status === 404) return EMPTY;
    throw new Error(
      `Failed to fetch wallet balance: ${res.status} ${res.statusText}`
    );
  } catch (err) {
    if (err instanceof TypeError) return EMPTY;
    throw err;
  }
}
