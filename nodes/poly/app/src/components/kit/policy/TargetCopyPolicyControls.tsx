// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@components/kit/policy/TargetCopyPolicyControls`
 * Purpose: Compact per-target copy sizing editor for the Money page. Each
 *   active target owns its max mirror bet; snapshot-backed targets also expose
 *   the percentile floor used by relative sizing.
 * Scope: Presentational client component. No fetch; caller persists changes.
 * Invariants: PER_TARGET_POLICY - rows represent `poly_copy_trade_targets`,
 *   not the tenant-wide wallet grant. Slider range mirrors the API contract.
 * Side-effects: component-local draft state.
 * Links: nodes/poly/packages/node-contracts/src/poly.copy-trade.targets.v1.contract.ts
 * @public
 */

"use client";

import { useEffect, useState } from "react";

import { Button, formatShortWallet } from "@/components";
import { cn } from "@/shared/util/cn";

export interface TargetCopyPolicyValues {
  target_id: string;
  target_wallet: string;
  mirror_filter_percentile: number;
  mirror_max_usdc_per_trade: number;
  sizing_policy_kind: "min_bet" | "target_percentile_scaled";
}

export interface TargetCopyPolicyControlsProps {
  targets: readonly TargetCopyPolicyValues[];
  onSave: (
    targetId: string,
    next: {
      mirror_filter_percentile: number;
      mirror_max_usdc_per_trade: number;
    }
  ) => Promise<void>;
  className?: string;
}

function fmtUsdc(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function policySummary(params: {
  percentile: number;
  maxBet: number;
  percentileSizing: boolean;
}): string {
  const max = `$${fmtUsdc(params.maxBet || 0)}`;
  if (!params.percentileSizing) return `min bet <= ${max}`;
  return `p${params.percentile}=min / p100=${max}`;
}

export function TargetCopyPolicyControls({
  targets,
  onSave,
  className,
}: TargetCopyPolicyControlsProps): React.ReactElement | null {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-muted-foreground text-xs uppercase tracking-wide">
          Copy sizing
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {targets.length === 0 ? (
          <div className="rounded-md bg-muted/40 px-3 py-2 text-muted-foreground text-sm">
            No active copy targets
          </div>
        ) : (
          targets.map((target) => (
            <TargetPolicyRow
              key={target.target_id}
              target={target}
              onSave={onSave}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TargetPolicyRow({
  target,
  onSave,
}: {
  target: TargetCopyPolicyValues;
  onSave: TargetCopyPolicyControlsProps["onSave"];
}): React.ReactElement {
  const [percentile, setPercentile] = useState(target.mirror_filter_percentile);
  const [maxBet, setMaxBet] = useState(
    target.mirror_max_usdc_per_trade.toFixed(2)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedMaxBet = Number.parseFloat(maxBet);
  const maxBetChanged =
    maxBet.trim() !== target.mirror_max_usdc_per_trade.toFixed(2);
  const changed =
    percentile !== target.mirror_filter_percentile || maxBetChanged;
  const percentileSizing =
    target.sizing_policy_kind === "target_percentile_scaled";

  useEffect(() => {
    setPercentile(target.mirror_filter_percentile);
    setMaxBet(target.mirror_max_usdc_per_trade.toFixed(2));
    setError(null);
  }, [target.mirror_filter_percentile, target.mirror_max_usdc_per_trade]);

  async function handleSave() {
    if (!Number.isFinite(parsedMaxBet) || parsedMaxBet <= 0) {
      setError("Max bet must be greater than 0");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(target.target_id, {
        mirror_filter_percentile: percentile,
        mirror_max_usdc_per_trade: parsedMaxBet,
      });
    } catch {
      setError("Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-md bg-muted/40 px-3 py-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0 font-medium text-sm">
          {formatShortWallet(target.target_wallet)}
        </div>
        <div className="font-semibold text-sm tabular-nums">
          {policySummary({
            percentile,
            maxBet: parsedMaxBet,
            percentileSizing,
          })}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
        {percentileSizing ? (
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs uppercase tracking-wide">
              Filter
            </span>
            <input
              type="range"
              min={50}
              max={99}
              step={1}
              value={percentile}
              disabled={saving}
              onChange={(e) => setPercentile(Number(e.target.value))}
              className="h-9 w-full accent-primary"
            />
          </label>
        ) : (
          <div className="flex h-full flex-col justify-end gap-1">
            <span className="text-muted-foreground text-xs uppercase tracking-wide">
              Filter
            </span>
            <div className="flex h-9 items-center rounded-md bg-background px-2 text-muted-foreground text-sm">
              Snapshot unavailable
            </div>
          </div>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs uppercase tracking-wide">
            {percentileSizing ? "p100 max" : "Max bet"}
          </span>
          <span className="flex h-9 items-center gap-1 rounded-md border border-input bg-background px-2">
            <span className="text-muted-foreground text-sm">$</span>
            <input
              inputMode="decimal"
              value={maxBet}
              disabled={saving}
              onChange={(e) => setMaxBet(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-sm tabular-nums outline-none disabled:opacity-50"
            />
          </span>
        </label>
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={saving || !changed}
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
      {error ? (
        <div className="mt-2 text-destructive text-xs">{error}</div>
      ) : null}
    </div>
  );
}
