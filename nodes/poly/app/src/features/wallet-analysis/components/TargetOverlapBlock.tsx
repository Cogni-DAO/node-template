// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/TargetOverlapBlock`
 * Purpose: Research chart for RN1/swisstony shared-vs-solo active markets.
 * Scope: Presentational component. Receives the saved-facts overlap API shape
 * and renders Trader Comparison-style horizontal metric bars.
 * Invariants:
 *   - SHARED_BUCKET_IS_CENTER: the chart reads like a Venn in one dimension:
 *     RN1 only → shared → swisstony only.
 *   - METRIC_TABS_SHARE_AXES: active USDC, fill volume, PnL, and market count
 *     reuse the same bucket structure so the user can compare dimensions.
 * Side-effects: none
 * @public
 */

"use client";

import type { PolyResearchTargetOverlapResponse } from "@cogni/poly-node-contracts";
import type { ReactElement } from "react";
import { useState } from "react";
import { cn } from "@/shared/util/cn";

type MetricKey = "value" | "volume" | "pnl" | "markets" | "positions";

type MetricDef = {
  key: MetricKey;
  label: string;
  unit: string;
  formatter: (value: number) => string;
};

const METRICS = [
  { key: "value", label: "Active USDC", unit: "USDC", formatter: formatUsd },
  { key: "volume", label: "Fill volume", unit: "USDC", formatter: formatUsd },
  { key: "pnl", label: "Active PnL", unit: "PnL", formatter: formatSignedUsd },
  { key: "markets", label: "Markets", unit: "markets", formatter: formatCount },
  {
    key: "positions",
    label: "Positions",
    unit: "positions",
    formatter: formatCount,
  },
] satisfies readonly MetricDef[];

const METRIC_BY_KEY = Object.fromEntries(
  METRICS.map((item) => [item.key, item])
) as Record<MetricKey, MetricDef>;

export function TargetOverlapBlock({
  data,
  isLoading,
  isError,
}: {
  data?: PolyResearchTargetOverlapResponse | undefined;
  isLoading?: boolean | undefined;
  isError?: boolean | undefined;
}): ReactElement {
  const [metric, setMetric] = useState<MetricKey>("value");
  const metricDef = METRIC_BY_KEY[metric];

  if (isLoading) {
    return <div className="h-80 animate-pulse rounded bg-muted" aria-hidden />;
  }

  if (isError || !data) {
    return (
      <div className="text-muted-foreground text-sm">
        {isError
          ? "Target overlap failed to load."
          : "Target overlap is not available yet."}
      </div>
    );
  }

  const max = maxMagnitude(data, metric);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <div className="inline-flex rounded border bg-muted p-0.5 text-xs">
          {METRICS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setMetric(item.key)}
              className={cn(
                "rounded px-2.5 py-1 font-medium transition-colors",
                metric === item.key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="divide-y">
        {data.buckets.map((bucket) => (
          <TargetOverlapRow
            key={bucket.key}
            bucket={bucket}
            metric={metric}
            metricDef={metricDef}
            max={max}
          />
        ))}
      </div>
    </div>
  );
}

function TargetOverlapRow({
  bucket,
  metric,
  metricDef,
  max,
}: {
  bucket: PolyResearchTargetOverlapResponse["buckets"][number];
  metric: MetricKey;
  metricDef: MetricDef;
  max: number;
}): ReactElement {
  const values = valuesForBucket(bucket, metric);
  const leftPct =
    max > 0 ? Math.min(100, (values.leftMagnitude / max) * 100) : 0;
  const rightPct =
    max > 0 ? Math.min(100, (values.rightMagnitude / max) * 100) : 0;
  const aggregate = metricValue(bucket, metric);
  const headlineClassName =
    metric === "pnl"
      ? aggregate > 0
        ? "text-success"
        : aggregate < 0
          ? "text-destructive"
          : "text-muted-foreground"
      : undefined;

  return (
    <div className="grid gap-3 py-4 md:grid-cols-5 md:items-center">
      <div className="min-w-0 md:col-span-1">
        <div className="truncate font-medium text-sm">{bucket.label}</div>
        <div className="truncate text-muted-foreground text-xs">
          {detailForBucket(bucket, metric)}
        </div>
      </div>

      <div className="flex flex-col gap-2 md:col-span-3">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-muted-foreground">RN1</span>
          <span className={cn("font-mono", headlineClassName)}>
            {metricDef.formatter(aggregate)}
          </span>
          <span className="text-muted-foreground">swisstony</span>
        </div>
        <div className="flex h-8 w-full overflow-hidden rounded border bg-muted/30">
          <div className="flex flex-1 justify-end border-r">
            <div
              className="h-full bg-destructive/70 transition-all"
              style={{ width: `${leftPct}%` }}
            />
          </div>
          <div className="flex-1">
            <div
              className="h-full bg-success/70 transition-all"
              style={{ width: `${rightPct}%` }}
            />
          </div>
        </div>
      </div>

      <div className="min-w-0 text-muted-foreground text-xs md:col-span-1 md:text-right">
        <span className="font-mono">{metricDef.formatter(values.leftRaw)}</span>
        {" / "}
        <span className="font-mono">
          {metricDef.formatter(values.rightRaw)}
        </span>
        <span className="ml-1">{metricDef.unit}</span>
      </div>
    </div>
  );
}

function metricValue(
  bucket: PolyResearchTargetOverlapResponse["buckets"][number],
  metric: MetricKey
): number {
  switch (metric) {
    case "value":
      return bucket.currentValueUsdc;
    case "volume":
      return bucket.fillVolumeUsdc;
    case "pnl":
      return bucket.pnlUsdc;
    case "markets":
      return bucket.marketCount;
    case "positions":
      return bucket.positionCount;
    default:
      return assertNever(metric);
  }
}

function valuesForBucket(
  bucket: PolyResearchTargetOverlapResponse["buckets"][number],
  metric: MetricKey
): {
  leftRaw: number;
  rightRaw: number;
  leftMagnitude: number;
  rightMagnitude: number;
} {
  const rn1 = sideMetricValue(bucket.rn1, metric);
  const swisstony = sideMetricValue(bucket.swisstony, metric);
  return {
    leftRaw: rn1,
    rightRaw: swisstony,
    leftMagnitude: Math.abs(rn1),
    rightMagnitude: Math.abs(swisstony),
  };
}

function sideMetricValue(
  side: PolyResearchTargetOverlapResponse["buckets"][number]["rn1"],
  metric: MetricKey
): number {
  switch (metric) {
    case "value":
      return side.currentValueUsdc;
    case "volume":
      return side.fillVolumeUsdc;
    case "pnl":
      return side.pnlUsdc;
    case "markets":
      return side.marketCount;
    case "positions":
      return side.positionCount;
    default:
      return assertNever(metric);
  }
}

function maxMagnitude(
  data: PolyResearchTargetOverlapResponse,
  metric: MetricKey
): number {
  const values = data.buckets.flatMap((bucket) => {
    const sides = valuesForBucket(bucket, metric);
    return [sides.leftMagnitude, sides.rightMagnitude];
  });
  return Math.max(1, ...values);
}

function detailForBucket(
  bucket: PolyResearchTargetOverlapResponse["buckets"][number],
  metric: MetricKey
): string {
  if (metric === "markets") {
    return `${bucket.positionCount.toLocaleString()} positions`;
  }
  return `${bucket.marketCount.toLocaleString()} markets`;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled target overlap metric: ${value}`);
}

function formatUsd(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatSignedUsd(value: number): string {
  if (Math.abs(value) < 0.005) return "$0";
  const formatted = formatUsd(Math.abs(value));
  return value > 0 ? `+${formatted}` : `-${formatted}`;
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
