// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/BalanceBar`
 * Purpose: Available / Locked / Positions stacked horizontal bar — the operator-wallet bar generalized.
 * Scope: Presentational only.
 * Invariants: Renders 0-state bar when balance is undefined or total is 0.
 * Side-effects: none
 * @public
 */

"use client";

import type { ReactElement } from "react";

import type { WalletBalance } from "../types/wallet-analysis";

export type BalanceBarProps = {
  balance?: WalletBalance | undefined;
  isLoading?: boolean | undefined;
};

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function BalanceBar({
  balance,
  isLoading,
}: BalanceBarProps): ReactElement {
  if (isLoading) {
    return (
      <div className="flex animate-pulse flex-col gap-2">
        <div className="h-4 w-1/3 rounded bg-muted" />
        <div className="h-2 w-full rounded bg-muted" />
      </div>
    );
  }

  const b = balance ?? { available: 0, locked: 0, positions: 0, total: 0 };
  const total = Math.max(b.total, 0.01);
  const aPct = (b.available / total) * 100;
  const lPct = (b.locked / total) * 100;
  const pPct = (b.positions / total) * 100;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-3 text-sm">
        <span className="text-muted-foreground text-xs uppercase tracking-widest">
          Total {fmtUsd(b.total)}
        </span>
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <Legend
            dot="bg-success"
            label="Available"
            value={fmtUsd(b.available)}
          />
          <Legend
            dot="bg-[hsl(var(--chart-1))]/70"
            label="Locked"
            value={fmtUsd(b.locked)}
          />
          <Legend
            dot="bg-[hsl(var(--chart-2))]/70"
            label="Positions"
            value={fmtUsd(b.positions)}
          />
        </div>
      </div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="bg-success" style={{ width: `${aPct}%` }} />
        <div
          className="bg-[hsl(var(--chart-1))]/70"
          style={{ width: `${lPct}%` }}
        />
        <div
          className="bg-[hsl(var(--chart-2))]/70"
          style={{ width: `${pPct}%` }}
        />
      </div>
    </div>
  );
}

function Legend({
  dot,
  label,
  value,
}: {
  dot: string;
  label: string;
  value: string;
}): ReactElement {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <span className={`size-1.5 rounded-full ${dot}`} />
      <span>{label}</span>
      <span className="font-mono text-foreground tabular-nums">{value}</span>
    </span>
  );
}
