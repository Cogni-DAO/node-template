// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/EdgeHypothesis`
 * Purpose: Render the analyst's edge hypothesis for a screened wallet.
 * Scope: Presentational only. Returns null when no hypothesis text is provided.
 * Invariants: Markdown rendering is intentionally minimal — single-block prose only for now.
 * Side-effects: none
 * @public
 */

"use client";

import { Sparkles } from "lucide-react";
import type { ReactElement } from "react";

export type EdgeHypothesisProps = {
  text?: string | undefined;
};

export function EdgeHypothesis({
  text,
}: EdgeHypothesisProps): ReactElement | null {
  if (!text) return null;
  return (
    <div className="flex gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="space-y-1 text-sm leading-relaxed">
        <p className="font-semibold">Edge hypothesis</p>
        <p className="text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}
