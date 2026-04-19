// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/RecentTradesTable`
 * Purpose: Last-N trades table — when, side (BUY/SELL with arrow), size, price, market title.
 * Scope: Presentational only. `limit` truncates the displayed rows.
 * Invariants: Trades passed in newest-first order. Empty array shows a friendly empty state.
 * Side-effects: none
 * @public
 */

"use client";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { ReactElement } from "react";

import { cn } from "@/shared/util/cn";
import type { WalletTrade } from "../types/wallet-analysis";

export type RecentTradesTableProps = {
  trades?: readonly WalletTrade[] | undefined;
  limit?: number | undefined;
  isLoading?: boolean | undefined;
  capturedAt?: string | undefined;
};

export function RecentTradesTable({
  trades,
  limit = 5,
  isLoading,
  capturedAt,
}: RecentTradesTableProps): ReactElement {
  const slice = trades?.slice(0, limit) ?? [];

  return (
    <div className="flex flex-col gap-3">
      <h4 className="font-semibold text-sm uppercase tracking-widest">
        Last {limit} trades
        {capturedAt && (
          <>
            {" "}
            <span className="font-mono font-normal text-muted-foreground text-xs">
              captured {capturedAt} · via data-api.polymarket.com
            </span>
          </>
        )}
      </h4>

      {isLoading ? (
        <div className="h-32 animate-pulse rounded-lg border bg-muted" />
      ) : slice.length === 0 ? (
        <p className="rounded-lg border bg-muted/30 px-4 py-6 text-center text-muted-foreground text-sm">
          No trades found in the recent window.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr className="text-muted-foreground text-xs uppercase tracking-widest">
                <th className="px-3 py-2 text-left">When</th>
                <th className="px-3 py-2 text-left">Side</th>
                <th className="px-3 py-2 text-right">Size</th>
                <th className="px-3 py-2 text-right">Px</th>
                <th className="px-3 py-2 text-left">Market</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((t, i) => (
                <tr
                  key={`${t.ts}-${i}-${t.mkt}`}
                  className="border-border/50 border-t"
                >
                  <td className="px-3 py-2 font-mono text-muted-foreground text-xs tabular-nums">
                    {t.ts}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 font-mono font-semibold text-xs",
                        t.side === "BUY" ? "text-success" : "text-destructive"
                      )}
                    >
                      {t.side === "BUY" ? (
                        <ArrowUpRight className="size-3" />
                      ) : (
                        <ArrowDownRight className="size-3" />
                      )}
                      {t.side}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {t.size}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {t.px}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{t.mkt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
