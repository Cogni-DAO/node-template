// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/TradesPerDayChart`
 * Purpose: 14-day trades-per-day bar chart. Last bar is always "today" and rendered in primary color.
 * Scope: Presentational only. Uses CSS for bars; no chart library.
 * Invariants: Bars are normalized to the max count in the dataset; minimum visible bar height for non-zero days.
 * Side-effects: none
 * @public
 */

"use client";

import type { ReactElement } from "react";

import { cn } from "@/shared/util/cn";
import type { WalletDailyCount } from "../types/wallet-analysis";

export type TradesPerDayChartProps = {
  daily?: readonly WalletDailyCount[] | undefined;
  isLoading?: boolean | undefined;
};

export function TradesPerDayChart({
  daily,
  isLoading,
}: TradesPerDayChartProps): ReactElement {
  if (isLoading || !daily || daily.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <h4 className="font-semibold text-sm uppercase tracking-widest">
          Trades / day, last 14 days
        </h4>
        <div className="h-28 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  const maxN = Math.max(...daily.map((d) => d.n), 1);
  const today = daily.at(-1);

  return (
    <div className="flex flex-col gap-3">
      <h4 className="font-semibold text-sm uppercase tracking-widest">
        Trades / day, last 14 days
      </h4>
      <div className="flex h-28 items-end gap-1">
        {daily.map((d, i) => {
          const h = d.n === 0 ? 4 : Math.max(8, (d.n / maxN) * 100);
          const isToday = i === daily.length - 1;
          return (
            <div
              key={d.d}
              className="group relative flex flex-1 flex-col items-center gap-1"
            >
              <span className="text-muted-foreground text-xs tabular-nums opacity-0 group-hover:opacity-100">
                {d.n}
              </span>
              <div
                style={{ height: `${h}%` }}
                className={cn(
                  "w-full rounded-t-sm transition-colors",
                  isToday
                    ? "bg-primary"
                    : "bg-muted-foreground/40 group-hover:bg-primary/60"
                )}
              />
            </div>
          );
        })}
      </div>
      <div className="flex items-baseline justify-between text-muted-foreground text-xs">
        <span>2 weeks ago</span>
        <span className="font-mono">
          today · <span className="text-primary">{today?.n ?? 0} trades</span>
        </span>
      </div>
    </div>
  );
}
