// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_api/fetchWalletGrants`
 * Purpose: Client-side read/write helpers for the dashboard policy controls over
 *          `poly_wallet_grants`.
 * Scope: Data fetching only. Returns contract shapes and translates facade-side
 *        error envelopes into thrown Errors for React Query callers.
 * Side-effects: IO (HTTP fetch).
 * Links: nodes/poly/packages/node-contracts/src/poly.wallet.grants.v1.contract.ts
 * @public
 */

import type {
  PolyWalletGrantsErrorOutput,
  PolyWalletGrantsGetOutput,
  PolyWalletGrantsPutInput,
  PolyWalletGrantsPutOutput,
} from "@cogni/poly-node-contracts";

export const POLY_WALLET_GRANTS_QUERY_KEY = ["poly-wallet-grants"] as const;

export async function fetchWalletGrants(): Promise<PolyWalletGrantsGetOutput> {
  const res = await fetch("/api/v1/poly/wallet/grants", {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`grants read failed: ${res.status}`);
  return (await res.json()) as PolyWalletGrantsGetOutput;
}

export async function putWalletGrants(
  input: PolyWalletGrantsPutInput
): Promise<PolyWalletGrantsPutOutput> {
  const res = await fetch("/api/v1/poly/wallet/grants", {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    let body: PolyWalletGrantsErrorOutput | null = null;
    try {
      body = (await res.json()) as PolyWalletGrantsErrorOutput;
    } catch {
      // Body was not JSON. Surface as a generic save failure.
    }
    const err = new Error(
      body?.message ?? `grants write failed: ${res.status}`
    );
    if (body?.code) {
      Object.assign(err, { code: body.code });
    }
    throw err;
  }
  return (await res.json()) as PolyWalletGrantsPutOutput;
}
