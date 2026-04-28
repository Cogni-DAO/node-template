// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@components/kit/policy/TargetActiveToggle`
 * Purpose: Single-row enable/disable affordance for a copy-trade target. Renders the current `polyCopyTradeTargets.disabled_at`-derived state and calls `onToggle` with the next desired state.
 * Scope: Pure presentational client component. Owns no fetch — caller wires React Query.
 * Invariants: SAVE_REJECT_REVERTS — on `onToggle` Promise rejection, the visible state stays at the prior value (no optimistic flip). PURE_PROPS — no derived state held; the `active` prop is the source of truth.
 * Side-effects: none.
 * Notes: Pairs with `<PolicyControls readonly />` on the per-target view (Research wallet detail). Two affordances total: this toggle + the Edit-on-Money link, matching the user sketch (`docs/design/poly-policy-ui/desired-policy-ui.png`).
 * Links: work/items/task.0347.poly-wallet-preferences-sizing-config.md, nodes/poly/packages/db-schema/src/copy-trade.ts
 * @public
 */

"use client";

import { useState } from "react";

import { cn } from "@/shared/util/cn";

export interface TargetActiveToggleProps {
  active: boolean;
  onToggle: (next: boolean) => Promise<void>;
  disabled?: boolean;
  className?: string;
}

export function TargetActiveToggle({
  active,
  onToggle,
  disabled,
  className,
}: TargetActiveToggleProps): React.ReactElement {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (busy || disabled) return;
    setBusy(true);
    try {
      await onToggle(!active);
    } catch {
      // Caller surfaces the error; we just stop the spinner. State stays at
      // the prior `active` value because parent re-renders with the unchanged
      // server value (SAVE_REJECT_REVERTS).
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-md bg-muted/40 px-3 py-2",
        className
      )}
    >
      <span className="font-mono text-[11px] text-muted-foreground uppercase tracking-wide">
        Copy trade
      </span>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy || disabled}
        aria-pressed={active}
        className={cn(
          "font-mono text-[11px] uppercase tracking-wide transition-colors disabled:opacity-50",
          active
            ? "text-success-foreground hover:text-success"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        {busy ? "…" : active ? "✓ active" : "paused"}
      </button>
    </div>
  );
}
