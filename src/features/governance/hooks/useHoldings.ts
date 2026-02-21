// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/governance/hooks/useHoldings`
 * Purpose: React Query hook for cumulative credit holdings data.
 * Scope: Client-side data fetching for /gov/holdings page. Does not access database directly.
 * Invariants: Typed with contract output schema; mock data until API routes ship.
 * Side-effects: IO (mock for now, HTTP GET to /api/v1/ledger/holdings when ready)
 * Links: src/contracts/governance.holdings.v1.contract.ts
 * @public
 */

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type { z } from "zod";

import type { holdingsOperation } from "@/contracts/governance.holdings.v1.contract";
import { MOCK_HOLDINGS } from "@/features/governance/mock/epoch-mock-data";

type HoldingsData = z.infer<(typeof holdingsOperation)["output"]>;

export function useHoldings(): UseQueryResult<HoldingsData, Error> {
  return useQuery({
    queryKey: ["governance", "holdings"],
    queryFn: async () => MOCK_HOLDINGS,
    staleTime: 60_000,
  });
}
