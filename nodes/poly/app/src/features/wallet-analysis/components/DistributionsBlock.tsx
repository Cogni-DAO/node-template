// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/DistributionsBlock`
 * Purpose: Order-flow deep-dive — 6 stacked histograms (DCA depth, trade size, entry price, DCA window, hour-of-day, event clustering) with a count↔USDC toggle and a pending-share caption. Renders directly from the contract `WalletAnalysisDistributions` shape — no client-side bucket math.
 * Scope: Presentational. CSS-only stacked bars (no chart library) following the project's existing TradesPerDayChart pattern.
 * Invariants:
 *   - MODE_HIGHLIGHTED — every chart paints the modal bucket green and the rest neutral grey, so the dominant behaviour reads at a glance. Win/lost/pending data stays on the wire (`PENDING_IS_FIRST_CLASS`) and surfaces in tooltips.
 *   - DISTRIBUTIONS_ARE_PURE_DERIVATIONS — the component never recomputes buckets; it renders what the server returned.
 * Side-effects: none
 * Links: docs/design/wallet-analysis-components.md (Checkpoint D), work/items/task.0431.poly-wallet-orderflow-distributions-d1.md
 * @public
 */

"use client";

import type {
  FlatHistogram,
  Histogram,
  WalletAnalysisDistributions,
} from "@cogni/poly-node-contracts";
import { type ReactElement, type ReactNode, useState } from "react";

import { cn } from "@/shared/util/cn";
import type { WalletDistributionsViewMode } from "../types/wallet-analysis";

export type DistributionsBlockProps = {
  data?: WalletAnalysisDistributions | undefined;
  isLoading?: boolean | undefined;
  isError?: boolean | undefined;
};

export type DistributionComparisonSeries = {
  label: string;
  data?: WalletAnalysisDistributions | undefined;
  isLoading?: boolean | undefined;
  isError?: boolean | undefined;
};

export function DistributionsBlock({
  data,
  isLoading,
  isError,
}: DistributionsBlockProps): ReactElement {
  const [viewMode, setViewMode] =
    useState<WalletDistributionsViewMode>("count");

  if (isLoading) {
    return (
      <Section title="Order-flow distributions">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {Array.from({ length: 6 }, (_, i) => `dist-skeleton-${i}`).map(
            (key) => (
              <div
                key={key}
                className="h-40 animate-pulse rounded bg-muted"
                aria-hidden
              />
            )
          )}
        </div>
      </Section>
    );
  }

  if (isError || !data) {
    return (
      <Section title="Order-flow distributions">
        <div className="text-muted-foreground text-sm">
          {isError
            ? "Could not load distributions — retrying on next refresh."
            : "No distributions available for this wallet yet."}
        </div>
      </Section>
    );
  }

  const pendingPct = (data.pendingShare.byCount * 100).toFixed(0);
  const pendingUsdcPct = (data.pendingShare.byUsdc * 100).toFixed(0);

  return (
    <Section
      title="Trade detail"
      caption={
        <>
          <span className="font-mono">{data.range.n}</span> trades on{" "}
          <span className="font-mono">
            {fmtRange(data.range.fromTs, data.range.toTs)}
          </span>
          {" · "}
          <span className="font-mono">{pendingPct}%</span> still waiting to
          resolve
          {viewMode === "usdc" ? (
            <>
              {" "}
              (<span className="font-mono">{pendingUsdcPct}%</span> of $)
            </>
          ) : null}
        </>
      }
      toolbar={<ViewModeToggle viewMode={viewMode} onChange={setViewMode} />}
    >
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <ChartCard title="Entries per outcome">
          <StackedBars histogram={data.dcaDepth} viewMode={viewMode} />
        </ChartCard>
        <ChartCard title="Trade size">
          <StackedBars histogram={data.tradeSize} viewMode={viewMode} />
        </ChartCard>
        <ChartCard title="Entry price">
          <StackedBars histogram={data.entryPrice} viewMode={viewMode} />
        </ChartCard>
        <ChartCard title="Time in position">
          <StackedBars histogram={data.dcaWindow} viewMode={viewMode} />
        </ChartCard>
        <ChartCard title="Hour of day (UTC)">
          <StackedBars
            histogram={data.hourOfDay}
            viewMode={viewMode}
            compact
            sparseLabels={3}
          />
        </ChartCard>
        <ChartCard title="Bets per market">
          <FlatBars histogram={data.eventClustering} viewMode={viewMode} />
        </ChartCard>
      </div>
    </Section>
  );
}

export function DistributionComparisonBlock({
  series,
}: {
  series: readonly DistributionComparisonSeries[];
}): ReactElement {
  const [viewMode, setViewMode] =
    useState<WalletDistributionsViewMode>("count");
  const readySeries = series.filter(
    (
      s
    ): s is DistributionComparisonSeries & {
      data: WalletAnalysisDistributions;
    } => Boolean(s.data)
  );
  const isLoading = readySeries.length === 0 && series.some((s) => s.isLoading);
  const isError = readySeries.length === 0 && series.some((s) => s.isError);

  if (isLoading) {
    return (
      <Section title="Trade detail comparison">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {Array.from({ length: 6 }, (_, i) => `comparison-skeleton-${i}`).map(
            (key) => (
              <div
                key={key}
                className="h-40 animate-pulse rounded bg-muted"
                aria-hidden
              />
            )
          )}
        </div>
      </Section>
    );
  }

  if (isError || readySeries.length === 0) {
    return (
      <Section title="Trade detail comparison">
        <div className="text-muted-foreground text-sm">
          {isError
            ? "Could not load distribution comparison — retrying on next refresh."
            : "No saved distributions available for comparison yet."}
        </div>
      </Section>
    );
  }

  return (
    <Section
      title="Trade detail comparison"
      caption={<ComparisonCaption series={readySeries} viewMode={viewMode} />}
      toolbar={<ViewModeToggle viewMode={viewMode} onChange={setViewMode} />}
    >
      <div className="flex flex-wrap gap-3">
        {readySeries.map((s, i) => (
          <span
            key={s.label}
            className="inline-flex items-center gap-1.5 text-muted-foreground text-xs"
          >
            <span
              className={cn("size-2 rounded-full", seriesColorClass(i))}
              aria-hidden
            />
            {s.label}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <ChartCard title="Entries per outcome">
          <ComparisonHistogramChart
            series={readySeries}
            viewMode={viewMode}
            pickHistogram={(d) => d.dcaDepth}
          />
        </ChartCard>
        <ChartCard title="Trade size">
          <ComparisonHistogramChart
            series={readySeries}
            viewMode={viewMode}
            pickHistogram={(d) => d.tradeSize}
          />
        </ChartCard>
        <ChartCard title="Entry price">
          <ComparisonHistogramChart
            series={readySeries}
            viewMode={viewMode}
            pickHistogram={(d) => d.entryPrice}
          />
        </ChartCard>
        <ChartCard title="Time in position">
          <ComparisonHistogramChart
            series={readySeries}
            viewMode={viewMode}
            pickHistogram={(d) => d.dcaWindow}
          />
        </ChartCard>
        <ChartCard title="Hour of day (UTC)">
          <ComparisonHistogramChart
            series={readySeries}
            viewMode={viewMode}
            pickHistogram={(d) => d.hourOfDay}
            compact
            sparseLabels={3}
          />
        </ChartCard>
        <ChartCard title="Bets per market">
          <ComparisonFlatChart
            series={readySeries}
            viewMode={viewMode}
            pickHistogram={(d) => d.eventClustering}
          />
        </ChartCard>
      </div>
    </Section>
  );
}

function Section({
  title,
  caption,
  toolbar,
  children,
}: {
  title: string;
  caption?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold text-sm uppercase tracking-widest">
            {title}
          </h3>
          {caption ? (
            <p className="text-muted-foreground text-xs">{caption}</p>
          ) : null}
        </div>
        {toolbar}
      </div>
      {children}
    </div>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="flex flex-col gap-3 rounded border bg-card p-3">
      <h4 className="font-medium text-foreground text-xs uppercase tracking-wider">
        {title}
      </h4>
      {children}
    </div>
  );
}

function ViewModeToggle({
  viewMode,
  onChange,
}: {
  viewMode: WalletDistributionsViewMode;
  onChange: (m: WalletDistributionsViewMode) => void;
}): ReactElement {
  return (
    <div className="inline-flex rounded border bg-muted p-0.5 text-xs">
      {(["count", "usdc"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={cn(
            "rounded px-2 py-1 font-medium uppercase tracking-wider transition-colors",
            viewMode === m
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {m === "count" ? "Count" : "USDC"}
        </button>
      ))}
    </div>
  );
}

const BAR_GREY = "bg-muted-foreground/30";
const BAR_HIGHLIGHT = "bg-emerald-500/80";
const SERIES_COLOR_CLASSES = [
  "bg-sky-500/85",
  "bg-emerald-500/85",
  "bg-amber-400/85",
  "bg-fuchsia-500/85",
] as const;

function seriesColorClass(index: number): string {
  return (
    SERIES_COLOR_CLASSES[index % SERIES_COLOR_CLASSES.length] ??
    SERIES_COLOR_CLASSES[0]
  );
}

function bucketTotal(
  bucket: Histogram["buckets"][number],
  viewMode: WalletDistributionsViewMode
): number {
  const v = viewMode === "count" ? bucket.values.count : bucket.values.usdc;
  return v.won + v.lost + v.pending;
}

function YAxis({
  max,
  height,
  viewMode,
}: {
  max: number;
  height: number;
  viewMode: WalletDistributionsViewMode;
}): ReactElement {
  return (
    <div
      className="flex w-8 shrink-0 flex-col justify-between font-mono text-muted-foreground text-xs tabular-nums"
      style={{ height: `${height}px` }}
    >
      <span className="leading-none">{fmtVal(max, viewMode)}</span>
      <span className="leading-none">0</span>
    </div>
  );
}

function ComparisonCaption({
  series,
  viewMode,
}: {
  series: readonly (DistributionComparisonSeries & {
    data: WalletAnalysisDistributions;
  })[];
  viewMode: WalletDistributionsViewMode;
}): ReactElement {
  return (
    <>
      {series.map((s, i) => (
        <span key={s.label}>
          {i > 0 ? " · " : null}
          <span className="font-mono">{s.label}</span>{" "}
          <span className="font-mono">
            {fmtVal(
              viewMode === "count" ? s.data.range.n : totalUsdc(s.data),
              viewMode
            )}
          </span>
        </span>
      ))}
    </>
  );
}

function totalUsdc(data: WalletAnalysisDistributions): number {
  return data.tradeSize.buckets.reduce(
    (sum, bucket) => sum + bucketTotal(bucket, "usdc"),
    0
  );
}

function groupedBucketValues(
  series: readonly (DistributionComparisonSeries & {
    data: WalletAnalysisDistributions;
  })[],
  pickHistogram: (d: WalletAnalysisDistributions) => Histogram,
  bucketIndex: number,
  viewMode: WalletDistributionsViewMode
): readonly {
  label: string;
  value: number;
  tooltip: string;
}[] {
  return series.map((s) => {
    const bucket = pickHistogram(s.data).buckets[bucketIndex];
    if (!bucket) {
      return { label: s.label, value: 0, tooltip: `${s.label}: no data` };
    }
    const counts =
      viewMode === "count" ? bucket.values.count : bucket.values.usdc;
    const value = counts.won + counts.lost + counts.pending;
    return {
      label: s.label,
      value,
      tooltip: `${s.label} · ${bucket.label}: won ${fmtVal(counts.won, viewMode)} · lost ${fmtVal(counts.lost, viewMode)} · pending ${fmtVal(counts.pending, viewMode)}`,
    };
  });
}

const GROUPED_BAR_SERIES_LIMIT = 4;

function ComparisonHistogramChart({
  series,
  viewMode,
  pickHistogram,
  compact,
  sparseLabels,
}: {
  series: readonly (DistributionComparisonSeries & {
    data: WalletAnalysisDistributions;
  })[];
  viewMode: WalletDistributionsViewMode;
  pickHistogram: (d: WalletAnalysisDistributions) => Histogram;
  compact?: boolean | undefined;
  sparseLabels?: number | undefined;
}): ReactElement {
  if (series.length > GROUPED_BAR_SERIES_LIMIT) {
    return (
      <HistogramHeatmap
        series={series}
        viewMode={viewMode}
        pickHistogram={pickHistogram}
        sparseLabels={sparseLabels}
      />
    );
  }
  return (
    <GroupedHistogramBars
      series={series}
      viewMode={viewMode}
      pickHistogram={pickHistogram}
      compact={compact}
      sparseLabels={sparseLabels}
    />
  );
}

function ComparisonFlatChart({
  series,
  viewMode,
  pickHistogram,
}: {
  series: readonly (DistributionComparisonSeries & {
    data: WalletAnalysisDistributions;
  })[];
  viewMode: WalletDistributionsViewMode;
  pickHistogram: (d: WalletAnalysisDistributions) => FlatHistogram;
}): ReactElement {
  if (series.length > GROUPED_BAR_SERIES_LIMIT) {
    return (
      <FlatHeatmap
        series={series}
        viewMode={viewMode}
        pickHistogram={pickHistogram}
      />
    );
  }
  return (
    <GroupedFlatBars
      series={series}
      viewMode={viewMode}
      pickHistogram={pickHistogram}
    />
  );
}

function GroupedHistogramBars({
  series,
  viewMode,
  pickHistogram,
  compact,
  sparseLabels,
}: {
  series: readonly (DistributionComparisonSeries & {
    data: WalletAnalysisDistributions;
  })[];
  viewMode: WalletDistributionsViewMode;
  pickHistogram: (d: WalletAnalysisDistributions) => Histogram;
  compact?: boolean | undefined;
  sparseLabels?: number | undefined;
}): ReactElement {
  const first = series[0];
  if (!first) return <div />;
  const reference = pickHistogram(first.data);
  const max = series.reduce(
    (seriesMax, s) =>
      Math.max(
        seriesMax,
        ...pickHistogram(s.data).buckets.map((bucket) =>
          bucketTotal(bucket, viewMode)
        )
      ),
    0
  );
  const scaleMax = Math.max(max, 1);
  const chartPx = compact ? 72 : 104;
  return (
    <div className="flex items-stretch gap-2">
      <YAxis max={max} height={chartPx} viewMode={viewMode} />
      <div className="flex flex-1 flex-col">
        <div
          className="relative flex items-end gap-1"
          style={{ height: `${chartPx}px` }}
        >
          <ChartGuides />
          {reference.buckets.map((bucket, bucketIndex) => (
            <BucketGroup
              key={`${bucket.label}-${bucketIndex}`}
              values={groupedBucketValues(
                series,
                pickHistogram,
                bucketIndex,
                viewMode
              )}
              scaleMax={scaleMax}
              chartPx={chartPx}
            />
          ))}
        </div>
        <BucketLabels buckets={reference.buckets} sparseLabels={sparseLabels} />
      </div>
    </div>
  );
}

function HistogramHeatmap({
  series,
  viewMode,
  pickHistogram,
  sparseLabels,
}: {
  series: readonly (DistributionComparisonSeries & {
    data: WalletAnalysisDistributions;
  })[];
  viewMode: WalletDistributionsViewMode;
  pickHistogram: (d: WalletAnalysisDistributions) => Histogram;
  sparseLabels?: number | undefined;
}): ReactElement {
  const first = series[0];
  if (!first) return <div />;
  const reference = pickHistogram(first.data);
  const max = series.reduce(
    (seriesMax, s) =>
      Math.max(
        seriesMax,
        ...pickHistogram(s.data).buckets.map((bucket) =>
          bucketTotal(bucket, viewMode)
        )
      ),
    0
  );
  return (
    <HeatmapShell labels={reference.buckets} sparseLabels={sparseLabels}>
      {series.map((s) => (
        <HeatmapRow
          key={s.label}
          label={s.label}
          cells={reference.buckets.map((bucket, bucketIndex) => {
            const seriesBucket = pickHistogram(s.data).buckets[bucketIndex];
            if (!seriesBucket) {
              return { label: bucket.label, value: 0, tooltip: "no data" };
            }
            const counts =
              viewMode === "count"
                ? seriesBucket.values.count
                : seriesBucket.values.usdc;
            const value = counts.won + counts.lost + counts.pending;
            return {
              label: bucket.label,
              value,
              tooltip: `${s.label} · ${bucket.label}: won ${fmtVal(counts.won, viewMode)} · lost ${fmtVal(counts.lost, viewMode)} · pending ${fmtVal(counts.pending, viewMode)}`,
            };
          })}
          max={max}
          viewMode={viewMode}
        />
      ))}
    </HeatmapShell>
  );
}

function FlatHeatmap({
  series,
  viewMode,
  pickHistogram,
}: {
  series: readonly (DistributionComparisonSeries & {
    data: WalletAnalysisDistributions;
  })[];
  viewMode: WalletDistributionsViewMode;
  pickHistogram: (d: WalletAnalysisDistributions) => FlatHistogram;
}): ReactElement {
  const first = series[0];
  if (!first) return <div />;
  const reference = pickHistogram(first.data);
  const max = series.reduce(
    (seriesMax, s) =>
      Math.max(
        seriesMax,
        ...pickHistogram(s.data).buckets.map((bucket) =>
          viewMode === "count" ? bucket.count : bucket.usdc
        )
      ),
    0
  );
  return (
    <HeatmapShell labels={reference.buckets}>
      {series.map((s) => (
        <HeatmapRow
          key={s.label}
          label={s.label}
          cells={reference.buckets.map((bucket, bucketIndex) => {
            const seriesBucket = pickHistogram(s.data).buckets[bucketIndex];
            const value = seriesBucket
              ? viewMode === "count"
                ? seriesBucket.count
                : seriesBucket.usdc
              : 0;
            return {
              label: bucket.label,
              value,
              tooltip: `${s.label} · ${bucket.label}: ${fmtVal(value, viewMode)}`,
            };
          })}
          max={max}
          viewMode={viewMode}
        />
      ))}
    </HeatmapShell>
  );
}

function HeatmapShell({
  labels,
  sparseLabels,
  children,
}: {
  labels: readonly { label: string }[];
  sparseLabels?: number | undefined;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex gap-2">
        <div className="w-24 shrink-0" />
        <div className="min-w-0 flex-1">
          <BucketLabels buckets={labels} sparseLabels={sparseLabels} />
        </div>
      </div>
      {children}
    </div>
  );
}

function HeatmapRow({
  label,
  cells,
  max,
  viewMode,
}: {
  label: string;
  cells: readonly { label: string; value: number; tooltip: string }[];
  max: number;
  viewMode: WalletDistributionsViewMode;
}): ReactElement {
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 shrink-0 truncate font-mono text-muted-foreground text-xs">
        {label}
      </div>
      <div className="flex min-w-0 flex-1 gap-1">
        {cells.map((cell, i) => (
          <div
            key={`${cell.label}-${i}`}
            className="h-5 flex-1 rounded-sm border border-background"
            style={{ backgroundColor: heatmapCellColor(cell.value, max) }}
            title={`${cell.tooltip} · ${fmtVal(cell.value, viewMode)}`}
          />
        ))}
      </div>
    </div>
  );
}

function heatmapCellColor(value: number, max: number): string {
  if (max <= 0 || value <= 0) return "rgba(148, 163, 184, 0.12)";
  const intensity = Math.max(0.18, Math.min(0.92, value / max));
  return `rgba(16, 185, 129, ${intensity})`;
}

function GroupedFlatBars({
  series,
  viewMode,
  pickHistogram,
}: {
  series: readonly (DistributionComparisonSeries & {
    data: WalletAnalysisDistributions;
  })[];
  viewMode: WalletDistributionsViewMode;
  pickHistogram: (d: WalletAnalysisDistributions) => FlatHistogram;
}): ReactElement {
  const first = series[0];
  if (!first) return <div />;
  const reference = pickHistogram(first.data);
  const max = series.reduce(
    (seriesMax, s) =>
      Math.max(
        seriesMax,
        ...pickHistogram(s.data).buckets.map((bucket) =>
          viewMode === "count" ? bucket.count : bucket.usdc
        )
      ),
    0
  );
  const scaleMax = Math.max(max, 1);
  const chartPx = 104;
  return (
    <div className="flex items-stretch gap-2">
      <YAxis max={max} height={chartPx} viewMode={viewMode} />
      <div className="flex flex-1 flex-col">
        <div
          className="relative flex items-end gap-1"
          style={{ height: `${chartPx}px` }}
        >
          <ChartGuides />
          {reference.buckets.map((bucket, bucketIndex) => {
            const values = series.map((s) => {
              const seriesBucket = pickHistogram(s.data).buckets[bucketIndex];
              const value = seriesBucket
                ? viewMode === "count"
                  ? seriesBucket.count
                  : seriesBucket.usdc
                : 0;
              return {
                label: s.label,
                value,
                tooltip: `${s.label} · ${bucket.label}: ${fmtVal(value, viewMode)}`,
              };
            });
            return (
              <BucketGroup
                key={`${bucket.label}-${bucketIndex}`}
                values={values}
                scaleMax={scaleMax}
                chartPx={chartPx}
              />
            );
          })}
        </div>
        <BucketLabels buckets={reference.buckets} />
      </div>
    </div>
  );
}

function ChartGuides(): ReactElement {
  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 border-muted-foreground/15 border-t"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 border-muted-foreground/30 border-t"
      />
    </>
  );
}

function BucketGroup({
  values,
  scaleMax,
  chartPx,
}: {
  values: readonly { label: string; value: number; tooltip: string }[];
  scaleMax: number;
  chartPx: number;
}): ReactElement {
  return (
    <div className="flex flex-1 items-end justify-center gap-0.5">
      {values.map((v, i) => {
        const heightPx =
          v.value === 0
            ? 2
            : Math.max(4, Math.round((v.value / scaleMax) * chartPx));
        return (
          <div
            key={`${v.label}-${i}`}
            className="flex min-w-1 flex-1 items-end justify-center"
            title={v.tooltip}
          >
            <div
              className={cn("w-full rounded-t-sm", seriesColorClass(i))}
              style={{ height: `${heightPx}px` }}
            />
          </div>
        );
      })}
    </div>
  );
}

function BucketLabels({
  buckets,
  sparseLabels,
}: {
  buckets: readonly { label: string }[];
  sparseLabels?: number | undefined;
}): ReactElement {
  return (
    <div className="mt-1 flex gap-1">
      {buckets.map((b, i) => {
        const showLabel = !sparseLabels || i % sparseLabels === 0;
        return (
          <span
            key={`${b.label}-label-${i}`}
            className={cn(
              "flex-1 text-center font-mono text-muted-foreground text-xs leading-none",
              showLabel ? "" : "invisible"
            )}
          >
            {b.label}
          </span>
        );
      })}
    </div>
  );
}

function StackedBars({
  histogram,
  viewMode,
  compact,
  sparseLabels,
}: {
  histogram: Histogram;
  viewMode: WalletDistributionsViewMode;
  compact?: boolean;
  /** Show only every Nth bucket label. Useful for hour-of-day where 24 ticks won't fit. */
  sparseLabels?: number;
}): ReactElement {
  const max = histogram.buckets.reduce(
    (m, b) => Math.max(m, bucketTotal(b, viewMode)),
    0
  );
  const scaleMax = Math.max(max, 1);
  const chartPx = compact ? 72 : 104;
  return (
    <div className="flex items-stretch gap-2">
      <YAxis max={max} height={chartPx} viewMode={viewMode} />
      <div className="flex flex-1 flex-col">
        <div
          className="relative flex items-end gap-1"
          style={{ height: `${chartPx}px` }}
        >
          <ChartGuides />
          {histogram.buckets.map((b, i) => {
            const counts =
              viewMode === "count" ? b.values.count : b.values.usdc;
            const total = counts.won + counts.lost + counts.pending;
            const heightPx =
              total === 0
                ? 2
                : Math.max(4, Math.round((total / scaleMax) * chartPx));
            const isMode = total > 0 && total === max;
            const tooltip = `${b.label}: won ${fmtVal(counts.won, viewMode)} · lost ${fmtVal(counts.lost, viewMode)} · pending ${fmtVal(counts.pending, viewMode)}`;
            return (
              <div
                key={`${b.label}-${i}`}
                className="flex flex-1 items-end justify-center"
                title={tooltip}
              >
                <div
                  className={cn(
                    "w-full rounded-t-sm",
                    isMode ? BAR_HIGHLIGHT : BAR_GREY
                  )}
                  style={{ height: `${heightPx}px` }}
                />
              </div>
            );
          })}
        </div>
        <BucketLabels buckets={histogram.buckets} sparseLabels={sparseLabels} />
      </div>
    </div>
  );
}

function FlatBars({
  histogram,
  viewMode,
}: {
  histogram: FlatHistogram;
  viewMode: WalletDistributionsViewMode;
}): ReactElement {
  const max = histogram.buckets.reduce(
    (m, b) => Math.max(m, viewMode === "count" ? b.count : b.usdc),
    0
  );
  const scaleMax = Math.max(max, 1);
  const chartPx = 104;
  return (
    <div className="flex items-stretch gap-2">
      <YAxis max={max} height={chartPx} viewMode={viewMode} />
      <div className="flex flex-1 flex-col">
        <div
          className="relative flex items-end gap-1"
          style={{ height: `${chartPx}px` }}
        >
          <ChartGuides />
          {histogram.buckets.map((b, i) => {
            const v = viewMode === "count" ? b.count : b.usdc;
            const heightPx =
              v === 0 ? 2 : Math.max(4, Math.round((v / scaleMax) * chartPx));
            const isMode = v > 0 && v === max;
            return (
              <div
                key={`${b.label}-${i}`}
                className="flex flex-1 items-end justify-center"
                title={`${b.label}: ${fmtVal(v, viewMode)}`}
              >
                <div
                  className={cn(
                    "w-full rounded-t-sm",
                    isMode ? BAR_HIGHLIGHT : BAR_GREY
                  )}
                  style={{ height: `${heightPx}px` }}
                />
              </div>
            );
          })}
        </div>
        <BucketLabels buckets={histogram.buckets} />
      </div>
    </div>
  );
}

function fmtVal(v: number, mode: WalletDistributionsViewMode): string {
  if (mode === "count") return String(Math.round(v));
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}

function fmtRange(fromTs: number, toTs: number): string {
  if (fromTs === 0 || toTs === 0) return "—";
  const from = new Date(fromTs * 1000).toISOString().slice(0, 10);
  const to = new Date(toTs * 1000).toISOString().slice(0, 10);
  if (from === to) return from;
  return `${from} → ${to}`;
}
