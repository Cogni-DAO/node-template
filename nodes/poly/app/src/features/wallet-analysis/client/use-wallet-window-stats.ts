// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/client/use-wallet-window-stats`
 * Purpose: React Query hook for POST /api/v1/poly/wallets/stats — returns accurate
 *          windowed numTrades / volumeUsdc / pnlUsdc for a single address + period.
 * Scope: Client-side data hook. No mutations.
 * Invariants:
 *   - One request per (addr, timePeriod) pair; server TTL is 60s.
 *   - Returns undefined while loading; callers render skeletons.
 * Side-effects: IO (HTTP fetch)
 * Links: work/items/task.0361.drawer-windowed-stats-strip.md
 * @public
 */

"use client";

import type {
  PolyWalletOverviewInterval,
  WalletWindowStats,
  WalletWindowTimePeriod,
} from "@cogni/node-contracts";
import { WalletWindowStatsBatchSchema } from "@cogni/node-contracts";
import { useQuery } from "@tanstack/react-query";

/** Map the PnL chart toggle intervals to the stats endpoint's timePeriod. */
export function toWindowTimePeriod(
  interval: PolyWalletOverviewInterval
): WalletWindowTimePeriod {
  if (interval === "1D") return "DAY";
  if (interval === "1W") return "WEEK";
  if (interval === "1M") return "MONTH";
  // 1Y, YTD, ALL → ALL (best approximation)
  return "ALL";
}

async function fetchWindowStats(
  addr: string,
  timePeriod: WalletWindowTimePeriod
): Promise<WalletWindowStats> {
  const res = await fetch("/api/v1/poly/wallets/stats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ timePeriod, addresses: [addr] }),
  });
  if (!res.ok) throw new Error(`wallets/stats fetch failed: ${res.status}`);
  const batch = WalletWindowStatsBatchSchema.parse(await res.json());
  const stats = batch.stats[addr.toLowerCase()];
  if (!stats) throw new Error(`no stats returned for ${addr}`);
  return stats;
}

export type UseWalletWindowStatsResult = {
  stats: WalletWindowStats | undefined;
  isLoading: boolean;
  isError: boolean;
};

/**
 * Fetch windowed stats for a single wallet address.
 *
 * @param addr       0x wallet address (lowercased internally)
 * @param interval   The PnL chart interval — mapped to WalletWindowTimePeriod internally
 * @param enabled    Pause fetches when the consumer is inactive
 */
export function useWalletWindowStats(
  addr: string | null,
  interval: PolyWalletOverviewInterval,
  enabled = true
): UseWalletWindowStatsResult {
  const lower = addr?.toLowerCase() ?? "";
  const timePeriod = toWindowTimePeriod(interval);
  const active = enabled && Boolean(lower);

  const query = useQuery({
    queryKey: ["wallet-window-stats", lower, timePeriod],
    queryFn: () => fetchWindowStats(lower, timePeriod),
    enabled: active,
    staleTime: 60_000,
  });

  return {
    stats: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
