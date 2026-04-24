// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/WindowedStatsStrip`
 * Purpose: 3-cell stat strip showing windowed numTrades / volume / PnL from
 *          POST /wallets/stats. Replaces the misleading snapshot-derived cells.
 * Scope: Presentational only. Renders skeleton cells when stats is undefined.
 * Invariants:
 *   - Always renders 3 cells; loading state shows animated skeletons.
 *   - numTradesCapped: true renders a "~" prefix on the trade count.
 * Side-effects: none
 * Links: work/items/task.0361.drawer-windowed-stats-strip.md
 * @public
 */

"use client";

import type { WalletWindowStats } from "@cogni/node-contracts";
import type { ReactElement, ReactNode } from "react";

import { cn } from "@/shared/util/cn";

export type WindowedStatsStripProps = {
  stats?: WalletWindowStats | undefined;
  isLoading?: boolean | undefined;
};

export function WindowedStatsStrip({
  stats,
  isLoading,
}: WindowedStatsStripProps): ReactElement {
  if (isLoading || !stats) {
    return (
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border bg-border">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton cells
            key={i}
            className="flex animate-pulse flex-col gap-1 bg-background p-4"
          >
            <span className="h-3 w-12 rounded bg-muted" />
            <span className="h-7 w-16 rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }

  const tradePrefix = stats.numTradesCapped ? "~" : "";
  const pnlTone: "success" | "warn" | "default" =
    stats.pnlUsdc > 0 ? "success" : stats.pnlUsdc < 0 ? "warn" : "default";

  return (
    <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border bg-border">
      <Cell
        label="Trades"
        value={`${tradePrefix}${stats.numTrades.toLocaleString()}`}
      />
      <Cell label="Volume" value={formatUsd(stats.volumeUsdc)} />
      <Cell label="PnL" value={formatUsdSigned(stats.pnlUsdc)} tone={pnlTone} />
    </div>
  );
}

function Cell({
  label,
  value,
  tone = "default",
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "success" | "warn" | undefined;
  hint?: string | undefined;
}): ReactElement {
  const toneCls =
    tone === "success"
      ? "text-success"
      : tone === "warn"
        ? "text-destructive"
        : "text-foreground";
  return (
    <div className="flex flex-col gap-1 bg-background p-4">
      <span className="text-muted-foreground text-xs uppercase tracking-widest">
        {label}
      </span>
      <span
        className={cn(
          "font-mono font-semibold text-2xl tabular-nums leading-none",
          toneCls
        )}
      >
        {value}
      </span>
      {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
    </div>
  );
}

function formatUsd(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `$${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `$${(a / 1_000).toFixed(1)}k`;
  return `$${Math.round(a)}`;
}

function formatUsdSigned(n: number): string {
  const sign = n < 0 ? "-" : "+";
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(1)}k`;
  return `${sign}$${Math.round(a)}`;
}
