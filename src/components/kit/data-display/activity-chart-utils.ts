// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@components/kit/data-display/activity-chart-utils`
 * Purpose: Transform grouped activity series into the flat data shape consumed by ActivityChart.
 * Scope: Pure data transforms, no IO, no React.
 * Invariants: Output keys are sanitized for CSS variable compatibility (used as --color-<key>).
 * Side-effects: none
 * Links: [ActivityChart](./ActivityChart.tsx)
 * @internal
 */

import type { ChartConfig } from "@/components/vendor/shadcn/chart";

/** Palette for per-group bar colors (up to 5 groups + Others). */
const GROUP_COLORS = [
  "hsl(24, 95%, 53%)", // orange
  "hsl(221, 83%, 53%)", // blue
  "hsl(142, 71%, 45%)", // green
  "hsl(262, 83%, 58%)", // purple
  "hsl(0, 84%, 60%)", // red
  "hsl(0, 0%, 60%)", // gray (Others)
] as const;

type GroupedSeriesEntry = {
  group: string;
  buckets: Array<{
    bucketStart: string;
    spend: number;
    tokens: number;
    requests: number;
  }>;
};

/** Sanitize a group name into a valid CSS/recharts data key. */
function toDataKey(group: string): string {
  return group.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
}

type Metric = "spend" | "tokens" | "requests";

/**
 * Flatten groupedSeries into a single array of records keyed by sanitized group names,
 * plus a ChartConfig mapping each key to its label and color.
 */
export function buildGroupedChartData(
  groupedSeries: readonly GroupedSeriesEntry[],
  metric: Metric
): { data: Record<string, unknown>[]; config: ChartConfig } {
  // All groups share the same bucket timestamps — use the first group as reference
  const bucketCount = groupedSeries[0]?.buckets.length ?? 0;

  const config: ChartConfig = {};
  const dataKeys: { key: string; group: GroupedSeriesEntry }[] = [];

  for (let i = 0; i < groupedSeries.length; i++) {
    const entry = groupedSeries[i];
    const key = toDataKey(entry.group);
    config[key] = {
      label: entry.group,
      color: GROUP_COLORS[Math.min(i, GROUP_COLORS.length - 1)],
    };
    dataKeys.push({ key, group: entry });
  }

  const data: Record<string, unknown>[] = [];
  for (let b = 0; b < bucketCount; b++) {
    const point: Record<string, unknown> = {
      date: groupedSeries[0].buckets[b].bucketStart,
    };
    for (const { key, group } of dataKeys) {
      point[key] = group.buckets[b][metric];
    }
    data.push(point);
  }

  return { data, config };
}

/**
 * Build simple single-series chart data from aggregate chartSeries.
 * Used when no groupBy is active.
 */
export function buildAggregateChartData(
  chartSeries: ReadonlyArray<{
    bucketStart: string;
    spend: string;
    tokens: number;
    requests: number;
  }>,
  metric: Metric,
  label: string,
  color: string
): { data: Record<string, unknown>[]; config: ChartConfig } {
  const config: ChartConfig = {
    value: { label, color },
  };

  const data = chartSeries.map((d) => ({
    date: d.bucketStart,
    value: metric === "spend" ? Number.parseFloat(d.spend) : d[metric],
  }));

  return { data, config };
}
