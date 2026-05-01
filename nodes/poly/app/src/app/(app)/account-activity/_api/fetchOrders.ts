// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/account-activity/_api/fetchOrders`
 * Purpose: Client fetcher for the calling user's open CLOB orders.
 * Scope: Data fetching only.
 * Side-effects: IO (HTTP fetch)
 * @public
 */

import type { WalletOrdersResponse } from "@/app/api/v1/poly/wallet/orders/route";

export async function fetchWalletOrders(): Promise<WalletOrdersResponse> {
  const response = await fetch("/api/v1/poly/wallet/orders", {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch wallet orders: ${response.status} ${response.statusText}`
    );
  }
  return (await response.json()) as WalletOrdersResponse;
}
