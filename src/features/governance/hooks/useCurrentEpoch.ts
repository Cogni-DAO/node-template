// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/governance/hooks/useCurrentEpoch`
 * Purpose: React Query hook for current open epoch data.
 * Scope: Client-side data fetching for /gov/epoch page. Does not access database directly.
 * Invariants: Typed with contract output schema; mock data until API routes ship.
 * Side-effects: IO (mock for now, HTTP GET to /api/v1/ledger/epochs/current when ready)
 * Links: src/contracts/governance.epoch.v1.contract.ts
 * @public
 */

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type { z } from "zod";

import type { currentEpochOperation } from "@/contracts/governance.epoch.v1.contract";
import { MOCK_CURRENT_EPOCH } from "@/features/governance/mock/epoch-mock-data";

type CurrentEpochData = z.infer<(typeof currentEpochOperation)["output"]>;

export function useCurrentEpoch(): UseQueryResult<CurrentEpochData, Error> {
  return useQuery({
    queryKey: ["governance", "epoch", "current"],
    queryFn: async () => MOCK_CURRENT_EPOCH,
    staleTime: 60_000,
  });
}
