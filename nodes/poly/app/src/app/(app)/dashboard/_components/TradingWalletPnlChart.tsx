// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

"use client";

import type { PolyWalletOverviewPnlPoint } from "@cogni/node-contracts";
import type { ReactElement } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components";

const CHART_CONFIG = {
  pnl: {
    label: "Profit/Loss",
    color: "hsl(var(--chart-1))",
  },
} satisfies ChartConfig;

export function TradingWalletPnlChart({
  history,
  isLoading,
  rangeLabel,
}: {
  history: readonly PolyWalletOverviewPnlPoint[];
  isLoading: boolean;
  rangeLabel: string;
}): ReactElement {
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-7 w-40 animate-pulse rounded bg-muted" />
        <div className="h-48 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  const latest = history.at(-1);
  const latestPnl = latest?.pnl ?? 0;
  const accentClass =
    latestPnl > 0
      ? "text-success"
      : latestPnl < 0
        ? "text-destructive"
        : "text-muted-foreground";

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className={`font-medium text-sm ${accentClass}`}>Profit/Loss</div>
        <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
          <div className="font-semibold text-4xl tabular-nums tracking-tight">
            {formatUsd(latestPnl)}
          </div>
          <div className="pb-1 text-muted-foreground text-sm">{rangeLabel}</div>
        </div>
      </div>

      {history.length < 2 ? (
        <div className="flex h-48 items-center justify-center rounded-xl border border-border/70 text-center text-muted-foreground text-sm">
          No Polymarket P/L history yet.
        </div>
      ) : (
        <ChartContainer config={CHART_CONFIG} className="h-48 w-full">
          <AreaChart
            data={history.map((point) => ({ ...point, ts: point.ts }))}
            margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
          >
            <defs>
              <linearGradient
                id="trading-wallet-pnl-fill"
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="5%"
                  stopColor="var(--color-pnl)"
                  stopOpacity={0.28}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-pnl)"
                  stopOpacity={0.04}
                />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="ts"
              tickLine={false}
              axisLine={false}
              minTickGap={28}
              tickMargin={8}
              tickFormatter={formatDateTick}
            />
            <YAxis hide domain={["dataMin", "dataMax"]} />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => formatDateLabel(String(value))}
                  formatter={(value) => formatUsd(Number(value))}
                  indicator="line"
                />
              }
            />
            <Area
              dataKey="pnl"
              type="linear"
              stroke="var(--color-pnl)"
              strokeWidth={3}
              fill="url(#trading-wallet-pnl-fill)"
              dot={false}
              activeDot={{ r: 4 }}
            />
          </AreaChart>
        </ChartContainer>
      )}
    </div>
  );
}

function formatUsd(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const abs = Math.abs(value);
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDateTick(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatDateLabel(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
