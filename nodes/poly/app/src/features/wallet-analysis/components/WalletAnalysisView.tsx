// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/WalletAnalysisView`
 * Purpose: Organism that composes the wallet-analysis molecules into a layout for the chosen variant.
 * Scope: Pure component. Accepts `data` + `isLoading`; no fetching.
 * Invariants:
 *   - `variant="page"` renders the full layout (identity + stats + balance + chart + trades + markets + hypothesis).
 *   - `size="hero"` enlarges typography on the page variant; layout is identical.
 *   - Other variants (`drawer`, `compact`) ship in later checkpoints — fall back to `page` for now.
 * Side-effects: none
 * @public
 */

"use client";

import type { PolyWalletOverviewInterval } from "@cogni/poly-node-contracts";
import type { ReactElement, ReactNode } from "react";

import { Card, CardContent, CardHeader } from "@/components";
import type {
  WalletAnalysisData,
  WalletAnalysisSize,
  WalletAnalysisVariant,
} from "../types/wallet-analysis";
import { BalanceBar } from "./BalanceBar";
import { DistributionsBlock } from "./DistributionsBlock";
import { EdgeHypothesis } from "./EdgeHypothesis";
import { RecentTradesTable } from "./RecentTradesTable";
import { StatGrid } from "./StatGrid";
import { TimeWindowHeader } from "./TimeWindowHeader";
import { TopMarketsList } from "./TopMarketsList";
import { TradesPerDayChart } from "./TradesPerDayChart";
import { WalletIdentityHeader } from "./WalletIdentityHeader";
import { WalletProfitLossCard } from "./WalletProfitLossCard";

export type WalletAnalysisLoadingState = {
  snapshot?: boolean | undefined;
  trades?: boolean | undefined;
  balance?: boolean | undefined;
  pnl?: boolean | undefined;
  distributions?: boolean | undefined;
  benchmark?: boolean | undefined;
};

export type WalletAnalysisViewProps = {
  data: WalletAnalysisData;
  variant?: WalletAnalysisVariant | undefined;
  size?: WalletAnalysisSize | undefined;
  isLoading?: WalletAnalysisLoadingState | undefined;
  capturedAt?: string | undefined;
  rankBadge?: string | undefined;
  pnlInterval?: PolyWalletOverviewInterval | undefined;
  onPnlIntervalChange?:
    | ((interval: PolyWalletOverviewInterval) => void)
    | undefined;
  /** Inline actions rendered next to the wallet's Polymarket / Polygonscan links. */
  headerActions?: ReactNode | undefined;
};

export function WalletAnalysisView({
  data,
  variant = "page",
  size = "default",
  isLoading,
  capturedAt,
  rankBadge,
  pnlInterval,
  onPnlIntervalChange,
  headerActions,
}: WalletAnalysisViewProps): ReactElement {
  // variant fallback while drawer/compact land in later checkpoints
  if (variant !== "page") {
    return (
      <PageVariant
        data={data}
        size="default"
        isLoading={isLoading}
        capturedAt={capturedAt}
        pnlInterval={pnlInterval}
        onPnlIntervalChange={onPnlIntervalChange}
        headerActions={headerActions}
      />
    );
  }
  return (
    <PageVariant
      data={data}
      size={size}
      isLoading={isLoading}
      capturedAt={capturedAt}
      rankBadge={rankBadge}
      pnlInterval={pnlInterval}
      onPnlIntervalChange={onPnlIntervalChange}
      headerActions={headerActions}
    />
  );
}

function PageVariant({
  data,
  size,
  isLoading,
  capturedAt,
  rankBadge,
  pnlInterval,
  onPnlIntervalChange,
  headerActions,
}: {
  data: WalletAnalysisData;
  size: WalletAnalysisSize;
  isLoading?: WalletAnalysisLoadingState | undefined;
  capturedAt?: string | undefined;
  rankBadge?: string | undefined;
  pnlInterval?: PolyWalletOverviewInterval | undefined;
  onPnlIntervalChange?:
    | ((interval: PolyWalletOverviewInterval) => void)
    | undefined;
  headerActions?: ReactNode | undefined;
}): ReactElement {
  const isHero = size === "hero";
  return (
    <Card
      className={
        isHero
          ? "relative overflow-hidden border-primary/30"
          : "relative overflow-hidden"
      }
    >
      {rankBadge && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-4 right-6 select-none font-black text-8xl text-primary/5 leading-none tracking-tighter"
        >
          {rankBadge}
        </span>
      )}

      <CardHeader className="gap-3">
        <WalletIdentityHeader
          address={data.address}
          identity={data.identity}
          size={size}
          resolvedCount={data.snapshot?.n}
          actions={headerActions}
        />
      </CardHeader>

      <CardContent className="flex flex-col gap-6 pt-0">
        <StatGrid snapshot={data.snapshot} isLoading={isLoading?.snapshot} />

        {(data.balance || isLoading?.balance) && (
          <BalanceBar balance={data.balance} isLoading={isLoading?.balance} />
        )}

        {pnlInterval && onPnlIntervalChange ? (
          <TimeWindowHeader
            interval={pnlInterval}
            onIntervalChange={onPnlIntervalChange}
            pnlHistory={data.pnl?.history}
            isLoading={isLoading?.pnl}
          />
        ) : null}

        {(data.pnl || isLoading?.pnl || pnlInterval) && (
          <WalletProfitLossCard
            history={data.pnl?.history}
            interval={pnlInterval ?? data.pnl?.interval ?? "ALL"}
            isLoading={isLoading?.pnl}
          />
        )}

        {(data.benchmark || isLoading?.benchmark) && (
          <CopyTargetBenchmarkBlock
            benchmark={data.benchmark}
            isLoading={isLoading?.benchmark}
          />
        )}

        <div className="grid gap-8 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <TradesPerDayChart
              daily={data.trades?.dailyCounts}
              isLoading={isLoading?.trades}
            />
          </div>
          <div className="lg:col-span-2">
            <TopMarketsList
              markets={data.trades?.topMarkets}
              isLoading={isLoading?.trades}
              // TODO(task.0333): replace with Dolt-stored AI analyst summary.
              // Lorem Cognison until the wallet-analyst graph can author this.
              caption="Lorem Cognison — a Dolt-stored AI analysis will describe this wallet's playbook here: why they win, which markets they favour, which patterns repeat."
            />
          </div>
        </div>

        <RecentTradesTable
          trades={data.trades?.last}
          limit={5}
          isLoading={isLoading?.trades}
          capturedAt={capturedAt}
        />

        {(data.distributions || isLoading?.distributions) && (
          <DistributionsBlock
            data={data.distributions}
            isLoading={isLoading?.distributions}
          />
        )}

        <EdgeHypothesis text={data.snapshot?.hypothesisMd} />
      </CardContent>
    </Card>
  );
}

function CopyTargetBenchmarkBlock({
  benchmark,
  isLoading,
}: {
  benchmark: WalletAnalysisData["benchmark"] | undefined;
  isLoading?: boolean | undefined;
}): ReactNode {
  if (isLoading && !benchmark) {
    return (
      <div className="rounded-lg border bg-muted/20 p-4">
        <div className="h-4 w-40 animate-pulse rounded bg-muted" />
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="h-16 animate-pulse rounded bg-muted" />
          <div className="h-16 animate-pulse rounded bg-muted" />
          <div className="h-16 animate-pulse rounded bg-muted" />
        </div>
      </div>
    );
  }
  if (!benchmark?.isObserved) return null;

  const capture =
    benchmark.summary.copyCaptureRatio !== null
      ? `${Math.round(benchmark.summary.copyCaptureRatio * 100)}%`
      : "—";
  return (
    <section className="rounded-lg border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-sm">Copy Benchmark</h3>
          <p className="text-muted-foreground text-xs">
            {benchmark.label ?? "Observed wallet"} · {benchmark.window} ·{" "}
            {benchmark.coverage.status ?? "pending"}
          </p>
        </div>
        <p className="text-muted-foreground text-xs">
          Last observed {formatCoverageTime(benchmark.coverage.lastSuccessAt)}
        </p>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <MetricTile
          label="Target size"
          value={formatUsd(benchmark.summary.targetSizeUsdc)}
        />
        <MetricTile
          label="Cogni size"
          value={formatUsd(benchmark.summary.cogniSizeUsdc)}
        />
        <MetricTile label="Capture" value={capture} />
      </div>

      {benchmark.markets.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-md border">
          <div className="grid grid-cols-5 bg-muted/40 px-3 py-2 font-medium text-muted-foreground text-xs">
            <span className="col-span-2">Market</span>
            <span>Target VWAP</span>
            <span>Cogni VWAP</span>
            <span>Status</span>
          </div>
          {benchmark.markets.slice(0, 5).map((market) => (
            <div
              key={`${market.conditionId}:${market.tokenId}`}
              className="grid grid-cols-5 border-t px-3 py-2 text-xs"
            >
              <span className="col-span-2 truncate">
                {market.conditionId.slice(0, 10)}…/{market.tokenId.slice(0, 6)}
              </span>
              <span>{formatPrice(market.targetVwap)}</span>
              <span>{formatPrice(market.cogniVwap)}</span>
              <span>{market.status}</span>
            </div>
          ))}
        </div>
      )}

      {benchmark.activeGaps.length > 0 && (
        <p className="mt-3 text-muted-foreground text-xs">
          {benchmark.activeGaps.length} active target gaps above dust.
        </p>
      )}
    </section>
  );
}

function MetricTile({
  label,
  value,
}: {
  label: string;
  value: string;
}): ReactElement {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 font-semibold text-lg">{value}</p>
    </div>
  );
}

function formatUsd(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatPrice(value: number | null): string {
  return value === null ? "—" : value.toFixed(3);
}

function formatCoverageTime(value: string | null): string {
  if (!value) return "pending";
  return new Date(value).toISOString().slice(5, 16).replace("T", " ");
}
