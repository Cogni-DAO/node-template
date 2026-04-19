// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/TopMarketsList`
 * Purpose: Numbered list of the wallet's top traded markets.
 * Scope: Presentational only.
 * Invariants: Renders nothing if `markets` is empty.
 * Side-effects: none
 * @public
 */

"use client";

import type { ReactElement } from "react";

export type TopMarketsListProps = {
  markets?: readonly string[] | undefined;
  caption?: string | undefined;
  isLoading?: boolean | undefined;
};

export function TopMarketsList({
  markets,
  caption,
  isLoading,
}: TopMarketsListProps): ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <h4 className="font-semibold text-sm uppercase tracking-widest">
        Top markets
      </h4>
      {isLoading ? (
        <div className="h-32 animate-pulse rounded bg-muted" />
      ) : !markets || markets.length === 0 ? (
        <p className="text-muted-foreground text-xs italic">
          No top markets identified yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {markets.map((m, i) => (
            <li
              key={m}
              className="flex items-center gap-3 rounded border border-border/60 px-3 py-2 text-sm"
            >
              <span className="font-mono text-muted-foreground text-xs tabular-nums">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span>{m}</span>
            </li>
          ))}
        </ul>
      )}
      {caption && (
        <p className="text-muted-foreground text-xs leading-relaxed">
          {caption}
        </p>
      )}
    </div>
  );
}
