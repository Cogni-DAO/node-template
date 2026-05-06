// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/IntervalToggle`
 * Purpose: Time-window pill control reused across research blocks.
 * Scope: Presentational. Caller owns state.
 * Side-effects: none
 * @public
 */

"use client";

import type { PolyWalletOverviewInterval } from "@cogni/poly-node-contracts";
import type { ReactElement } from "react";
import { cn } from "@/shared/util/cn";

export const TARGET_OVERLAP_INTERVALS = [
  "1D",
  "1W",
  "1M",
  "ALL",
] satisfies readonly PolyWalletOverviewInterval[];

export function IntervalToggle({
  interval,
  intervals,
  onChange,
}: {
  interval: PolyWalletOverviewInterval;
  intervals: readonly PolyWalletOverviewInterval[];
  onChange: (interval: PolyWalletOverviewInterval) => void;
}): ReactElement {
  return (
    <div className="inline-flex rounded border bg-muted p-0.5 text-xs">
      {intervals.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            "rounded px-2 py-1 font-medium uppercase tracking-wider transition-colors",
            interval === option
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
