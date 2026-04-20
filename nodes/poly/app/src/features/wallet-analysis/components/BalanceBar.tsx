// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/BalanceBar`
 * Purpose: Available / Locked / Positions stacked horizontal bar with one-row legend — extracted from `OperatorWalletCard` so the same visual is used everywhere a wallet's balance is rendered.
 * Scope: Presentational only.
 * Invariants: Total = available + locked + positions. Empty/zero state shows the totals row only (no bar).
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
        <div className="h-4 w-2/3 rounded bg-muted" />
        <div className="h-2 w-full rounded-full bg-muted" />
      </div>
    );
  }

  const b = balance ?? { available: 0, locked: 0, positions: 0, total: 0 };
  const total = b.total;

  if (total <= 0) {
    return (
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground text-xs uppercase tracking-wide">
          Total
        </span>
        <span className="font-semibold tabular-nums">$0.00</span>
      </div>
    );
  }

  const aPct = (b.available / total) * 100;
  const lPct = (b.locked / total) * 100;
  const pPct = (b.positions / total) * 100;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-sm">
        <div className="flex items-baseline gap-2">
          <span className="text-muted-foreground text-xs uppercase tracking-wide">
            Total
          </span>
          <span className="font-semibold text-base tabular-nums">
            {fmtUsd(total)}
          </span>
        </div>
        <div className="flex items-center gap-4 text-muted-foreground text-xs">
          <Legend
            dot="bg-success/70"
            label="Available"
            value={fmtUsd(b.available)}
          />
          <Legend dot="bg-warning/70" label="Locked" value={fmtUsd(b.locked)} />
          <Legend
            dot="bg-[hsl(var(--chart-1))]/70"
            label="Positions"
            value={fmtUsd(b.positions)}
          />
        </div>
      </div>

      <div className="flex h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="bg-success/70"
          style={{ width: `${aPct}%` }}
          title={`Available: ${fmtUsd(b.available)}`}
        />
        <div
          className="bg-warning/70"
          style={{ width: `${lPct}%` }}
          title={`Locked: ${fmtUsd(b.locked)}`}
        />
        <div
          className="bg-[hsl(var(--chart-1))]/70"
          style={{ width: `${pPct}%` }}
          title={`Positions: ${fmtUsd(b.positions)}`}
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
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block size-2 rounded-sm ${dot}`} />
      {label} <span className="text-foreground tabular-nums">{value}</span>
    </span>
  );
}
