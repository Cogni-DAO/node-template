// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@components/kit/data-display/ActivityChart`
 * Purpose: Reusable stacked bar chart component for activity metrics with per-model breakdown.
 * Scope: Renders a single metric chart. Does not fetch data.
 * Invariants: Uses Recharts and shadcn/chart.
 * Side-effects: none
 * Links: [ActivityView](../../../app/(app)/activity/view.tsx)
 * @public
 */

"use client";

import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/vendor/shadcn/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/vendor/shadcn/chart";

export interface ActivityChartProps {
  title: string;
  description: string;
  /** Each data point has `date` plus one numeric key per model/series */
  data: Record<string, unknown>[];
  /** Keys in config correspond to data keys (model names or "value" for single-series) */
  config: ChartConfig;
  /** Bucket granularity: "5m" | "15m" | "1h" | "6h" | "1d" */
  effectiveStep?: string;
}

export function ActivityChart({
  title,
  description,
  data,
  config,
  effectiveStep,
}: ActivityChartProps) {
  const formatTick = (value: string) => {
    const date = new Date(value);
    if (effectiveStep && effectiveStep !== "1d") {
      return date.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    }
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  const formatTooltipLabel = (value: string) => {
    const date = new Date(value);
    if (effectiveStep && effectiveStep !== "1d") {
      return date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    }
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  // Derive series keys from config (each key maps to a Bar)
  const seriesKeys = Object.keys(config);

  return (
    <Card>
      <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
        <div className="grid flex-1 gap-1 text-center sm:text-left">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <ChartContainer config={config} className="aspect-auto h-64 w-full">
          <BarChart data={data} barCategoryGap="10%">
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={formatTick}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={formatTooltipLabel}
                  indicator="dot"
                />
              }
            />
            {seriesKeys.map((key, i) => (
              <Bar
                key={key}
                dataKey={key}
                stackId="a"
                fill={`var(--color-${key})`}
                radius={
                  i === seriesKeys.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]
                }
              />
            ))}
            <ChartLegend content={<ChartLegendContent />} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
