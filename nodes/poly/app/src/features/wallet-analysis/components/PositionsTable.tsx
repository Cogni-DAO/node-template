// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/PositionsTable`
 * Purpose: Reusable table for wallet positions with an interactive price trace and holding-time columns.
 * Scope: Presentational only. Callers pass already-computed position rows.
 * Invariants:
 *   - The chart is supplemental; P/L truth comes from the numeric columns.
 *   - Market links open the actual Polymarket event/market URL when upstream slugs are present.
 *   - Open, redeemable, and closed positions share one table shape so the caller can filter without swapping components.
 * Side-effects: none
 * @public
 */

"use client";

import type { ReactElement } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components";
import type { WalletPosition } from "../types/wallet-analysis";
import { PositionTimelineChart } from "./PositionTimelineChart";

export type PositionsTableProps = {
  positions?: readonly WalletPosition[] | undefined;
  isLoading?: boolean | undefined;
  emptyMessage?: string | undefined;
};

export function PositionsTable({
  positions,
  isLoading,
  emptyMessage = "No positions yet.",
}: PositionsTableProps): ReactElement {
  if (isLoading) {
    return (
      <div className="space-y-2">
        <div className="h-9 animate-pulse rounded bg-muted" />
        <div className="h-9 animate-pulse rounded bg-muted" />
        <div className="h-9 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (!positions || positions.length === 0) {
    return (
      <div className="rounded border border-border bg-muted/20 px-4 py-6 text-center text-muted-foreground text-sm">
        {emptyMessage}
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Market</TableHead>
          <TableHead className="w-72">Trace</TableHead>
          <TableHead className="text-right">Held</TableHead>
          <TableHead className="text-right">Current</TableHead>
          <TableHead className="text-right">P/L</TableHead>
          <TableHead className="text-right">P/L %</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {positions.map((position) => {
          const pnlClass =
            position.pnlUsd >= 0 ? "text-success" : "text-destructive";

          return (
            <TableRow key={position.positionId}>
              <TableCell>
                <div className="flex flex-col gap-0.5">
                  {position.marketUrl ? (
                    <a
                      href={position.marketUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-sm underline-offset-4 hover:underline"
                    >
                      {position.marketTitle}
                    </a>
                  ) : (
                    <span className="font-medium text-sm">
                      {position.marketTitle}
                    </span>
                  )}
                  <span className="font-mono text-muted-foreground text-xs uppercase tracking-wide">
                    {position.outcome} · {position.status}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <PositionTimelineChart
                  points={position.timeline}
                  events={position.events}
                  entryPrice={position.entryPrice}
                  status={position.status}
                  pnlUsd={position.pnlUsd}
                />
              </TableCell>
              <TableCell className="text-right text-muted-foreground text-sm tabular-nums">
                {formatHeldDuration(position.heldMinutes)}
              </TableCell>
              <TableCell className="text-right text-sm tabular-nums">
                {formatUsd(position.currentValue)}
              </TableCell>
              <TableCell
                className={`text-right text-sm tabular-nums ${pnlClass}`}
              >
                {formatSignedUsd(position.pnlUsd)}
              </TableCell>
              <TableCell
                className={`text-right text-sm tabular-nums ${pnlClass}`}
              >
                {formatSignedPct(position.pnlPct)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function formatSignedUsd(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatUsd(Math.abs(value))}`;
}

function formatSignedPct(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

function formatHeldDuration(heldMinutes: number): string {
  const totalMinutes = Math.max(0, Math.round(heldMinutes));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}
