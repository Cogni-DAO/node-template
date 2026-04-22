// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

"use client";

import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Card, CardContent } from "@/components";
import {
  BalanceOverTimeChart,
  TradesPerDayChart,
} from "@/features/wallet-analysis";
import { fetchExecution } from "../_api/fetchExecution";

export function OperatorWalletChartsRow(): ReactElement {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard-wallet-execution"],
    queryFn: fetchExecution,
    refetchInterval: 30_000,
    staleTime: 10_000,
    gcTime: 60_000,
    retry: 1,
  });

  const balanceHistory = (data?.balanceHistory ?? []).map((point) => ({
    ts: point.ts,
    total: point.total,
  }));
  const dailyCounts = (data?.dailyTradeCounts ?? []).map((point) => ({
    d: point.day.slice(5),
    n: point.n,
  }));

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardContent className="px-5 py-4">
          {isError ? (
            <div className="flex h-44 items-center justify-center text-center text-muted-foreground text-sm">
              Couldn&apos;t load balance history. Will retry shortly.
            </div>
          ) : (
            <BalanceOverTimeChart
              history={balanceHistory}
              isLoading={isLoading}
              rangeLabel="Last 14 days"
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="px-5 py-4">
          {isError ? (
            <div className="flex h-44 items-center justify-center text-center text-muted-foreground text-sm">
              Couldn&apos;t load trade volume. Will retry shortly.
            </div>
          ) : !isLoading && dailyCounts.length === 0 ? (
            <div className="flex h-44 items-center justify-center text-center text-muted-foreground text-sm">
              No trade history yet.
            </div>
          ) : (
            <TradesPerDayChart daily={dailyCounts} isLoading={isLoading} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
