// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/governance/hooks/useEpochHistory`
 * Purpose: React Query hook for closed epoch history data.
 * Scope: Client-side data fetching for /gov/history page. Does not access database directly.
 * Invariants: Typed with contract output schema; mock data until API routes ship.
 * Side-effects: IO (mock for now, HTTP GET to /api/v1/ledger/epochs when ready)
 * Links: src/contracts/governance.epoch.v1.contract.ts
 * @public
 */

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type { z } from "zod";

import type { epochHistoryOperation } from "@/contracts/governance.epoch.v1.contract";
import { MOCK_EPOCH_HISTORY } from "@/features/governance/mock/epoch-mock-data";

type EpochHistoryData = z.infer<(typeof epochHistoryOperation)["output"]>;

export function useEpochHistory(): UseQueryResult<EpochHistoryData, Error> {
  return useQuery({
    queryKey: ["governance", "epoch", "history"],
    queryFn: async () => MOCK_EPOCH_HISTORY,
    staleTime: 60_000,
  });
}
