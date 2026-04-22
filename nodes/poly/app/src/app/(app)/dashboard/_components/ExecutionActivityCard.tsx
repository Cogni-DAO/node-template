// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_components/ExecutionActivityCard`
 * Purpose: Unified Polymarket execution surface for the dashboard — real
 * operator-wallet positions as the primary view, with recent mirror-order
 * history one tab away for HFT inspection.
 * Scope: Client component. Read-only. Positions are sourced from the operator
 * wallet execution route; history is sourced from the copy-trade order ledger.
 * Invariants:
 *   - LEGACY_ACTIVE_ORDERS_REMOVED: the old Active Orders card no longer stands alone on the dashboard.
 *   - HISTORY_ALWAYS_AVAILABLE: recent mirror orders remain accessible behind the History tab with the same status filters and copy payload affordance.
 *   - POSITION_VIEW_IS_DATA_BACKED: position rows reflect Data API trades and positions plus CLOB public price history.
 *   - NO_FAKE_BALANCE_CURVE: the card does not render a fabricated balance chart.
 * Side-effects: IO (React Query), clipboard (user-triggered).
 * Links: [fetchExecution](../_api/fetchExecution.ts), [fetchOrders](../_api/fetchOrders.ts)
 * @public
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ToggleGroup,
  ToggleGroupItem,
} from "@/components";
import {
  PositionsTable,
  type WalletPosition,
} from "@/features/wallet-analysis";
import { cn } from "@/shared/util/cn";
import { fetchExecution } from "../_api/fetchExecution";
import { fetchOrders, type OrdersStatusFilter } from "../_api/fetchOrders";
import { formatPrice, formatUsdc, timeAgo } from "./wallet-format";

type ExecutionView = "positions" | "history";

const HISTORY_FILTERS: readonly { value: OrdersStatusFilter; label: string }[] =
  [
    { value: "open", label: "Open" },
    { value: "filled", label: "Filled" },
    { value: "closed", label: "Closed" },
    { value: "all", label: "All" },
  ] as const;

const HISTORY_STATUS_BUCKETS: Record<
  OrdersStatusFilter,
  | readonly (
      | "pending"
      | "open"
      | "partial"
      | "filled"
      | "canceled"
      | "error"
    )[]
  | "all"
> = {
  all: "all",
  open: ["pending", "open", "partial"],
  filled: ["filled"],
  closed: ["canceled", "error"],
};

const STATUS_DOT: Record<string, string> = {
  pending: "bg-muted-foreground animate-pulse",
  open: "bg-success",
  partial: "bg-warning",
  filled: "bg-success",
  canceled: "bg-muted-foreground",
  error: "bg-destructive",
};

type ExecutionOrder = Awaited<ReturnType<typeof fetchOrders>>["orders"][number];

function buildAgentPayload(row: ExecutionOrder): string {
  return JSON.stringify(
    {
      action: "inspect-copy-trade-order",
      hint: "Review this order and verify status against recent positions or trades when sync data looks stale.",
      order: row,
      ground_truth: {
        target_wallet_positions: row.target_wallet
          ? `https://data-api.polymarket.com/positions?user=${row.target_wallet}`
          : null,
        target_wallet_trades: row.target_wallet
          ? `https://data-api.polymarket.com/trades?user=${row.target_wallet}&limit=10`
          : null,
        polygon_tx: row.market_tx_hash
          ? `https://polygonscan.com/tx/${row.market_tx_hash}`
          : null,
      },
    },
    null,
    2
  );
}

function RowCopyButton({ row }: { row: ExecutionOrder }): ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy order JSON"
      title="Copy order JSON"
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(buildAgentPayload(row)).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {copied ? (
        <Check className="size-3.5 text-success" />
      ) : (
        <Copy className="size-3.5" />
      )}
    </button>
  );
}

const STALE_THRESHOLD_MS = 60_000;

function StalenessDot({
  synced_at,
  staleness_ms,
}: {
  synced_at: string | null;
  staleness_ms: number | null;
}): ReactElement | null {
  if (synced_at !== null && (staleness_ms ?? 0) <= STALE_THRESHOLD_MS) {
    return null;
  }

  const isNeverSynced = synced_at === null;
  const tooltip = isNeverSynced
    ? "Never synced"
    : `Last synced ${timeAgo(synced_at)} ago`;

  return (
    <span
      title={tooltip}
      className={cn(
        "inline-block size-1.5 rounded-full",
        isNeverSynced ? "bg-muted-foreground" : "bg-warning"
      )}
    />
  );
}

export function ExecutionActivityCard(): ReactElement {
  const [view, setView] = useState<ExecutionView>("positions");
  const [historyFilter, setHistoryFilter] = useState<OrdersStatusFilter>("all");

  const {
    data: executionData,
    isLoading: isExecutionLoading,
    isError: isExecutionError,
  } = useQuery({
    queryKey: ["dashboard-wallet-execution"],
    queryFn: fetchExecution,
    refetchInterval: 30_000,
    staleTime: 10_000,
    gcTime: 60_000,
    retry: 1,
  });

  const {
    data: ordersData,
    isLoading: isOrdersLoading,
    isError: isOrdersError,
  } = useQuery({
    queryKey: ["dashboard-execution-orders"],
    queryFn: () => fetchOrders({ status: "all", limit: 120 }),
    refetchInterval: 10_000,
    staleTime: 5_000,
    gcTime: 60_000,
    retry: 1,
  });

  const orders = ordersData?.orders ?? [];
  const positions = useMemo<WalletPosition[]>(
    () =>
      (executionData?.positions ?? []).map((position) => ({
        ...position,
        ...(position.marketSlug !== null
          ? { marketSlug: position.marketSlug }
          : {}),
        ...(position.eventSlug !== null
          ? { eventSlug: position.eventSlug }
          : {}),
        ...(position.marketUrl !== null
          ? { marketUrl: position.marketUrl }
          : {}),
        ...(position.closedAt !== null ? { closedAt: position.closedAt } : {}),
      })),
    [executionData?.positions]
  );
  const historyRows = useMemo(
    () => filterHistoryOrders(orders, historyFilter).slice(0, 60),
    [orders, historyFilter]
  );

  return (
    <Card>
      <CardHeader className="px-5 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
              Execution
            </CardTitle>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup
              type="single"
              value={view}
              onValueChange={(value) => {
                if (value) setView(value as ExecutionView);
              }}
              className="rounded-lg border"
            >
              <ToggleGroupItem value="positions" className="px-3 text-xs">
                Positions
              </ToggleGroupItem>
              <ToggleGroupItem value="history" className="px-3 text-xs">
                History
              </ToggleGroupItem>
            </ToggleGroup>

            {view === "history" ? (
              <ToggleGroup
                type="single"
                value={historyFilter}
                onValueChange={(value) => {
                  if (value) setHistoryFilter(value as OrdersStatusFilter);
                }}
                className="rounded-lg border"
              >
                {HISTORY_FILTERS.map((filter) => (
                  <ToggleGroupItem
                    key={filter.value}
                    value={filter.value}
                    className="px-3 text-xs"
                  >
                    {filter.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            ) : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {view === "positions" ? (
          <PositionsPanel
            positions={positions}
            warnings={executionData?.warnings ?? []}
            isLoading={isExecutionLoading}
            isError={isExecutionError}
          />
        ) : (
          <HistoryPanel
            rows={historyRows}
            isLoading={isOrdersLoading}
            isError={isOrdersError}
            filter={historyFilter}
          />
        )}
      </CardContent>
    </Card>
  );
}

function PositionsPanel({
  positions,
  warnings,
  isLoading,
  isError,
}: {
  positions: readonly WalletPosition[];
  warnings: readonly { code: string; message: string }[];
  isLoading: boolean;
  isError: boolean;
}): ReactElement {
  if (isError) {
    return (
      <p className="px-5 py-6 text-center text-muted-foreground text-sm">
        Failed to load execution data. Try again shortly.
      </p>
    );
  }

  return (
    <div className="space-y-3 px-5 pb-4">
      <div className="space-y-2">
        <h3 className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
          Positions
        </h3>
        {warnings.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            Some upstream data is temporarily unavailable, so a few rows may
            render with a shorter trace.
          </p>
        ) : null}
        <PositionsTable
          positions={positions}
          isLoading={isLoading}
          emptyMessage="No positions yet."
        />
      </div>
    </div>
  );
}

function HistoryPanel({
  rows,
  isLoading,
  isError,
  filter,
}: {
  rows: readonly ExecutionOrder[];
  isLoading: boolean;
  isError: boolean;
  filter: OrdersStatusFilter;
}): ReactElement {
  if (isLoading) {
    return (
      <div className="animate-pulse space-y-px px-5 pb-4">
        <div className="h-9 rounded bg-muted" />
        <div className="h-9 rounded bg-muted" />
        <div className="h-9 rounded bg-muted" />
      </div>
    );
  }

  if (isError) {
    return (
      <p className="px-5 py-6 text-center text-muted-foreground text-sm">
        Failed to load order history. Try again shortly.
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="px-5 py-6 text-center text-muted-foreground text-sm">
        No {filter === "all" ? "" : `${filter} `}orders yet.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-32">Status</TableHead>
          <TableHead>Market</TableHead>
          <TableHead className="w-16 text-center">Side</TableHead>
          <TableHead className="text-right">Size</TableHead>
          <TableHead className="text-right">Filled</TableHead>
          <TableHead className="text-right">Price</TableHead>
          <TableHead className="text-right">Placed</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const href = row.market_tx_hash
            ? `https://polygonscan.com/tx/${row.market_tx_hash}`
            : null;
          const display = row.market_title ?? "";

          const openHref = () => {
            if (href) window.open(href, "_blank", "noopener");
          };

          return (
            <TableRow
              key={`${row.target_id}:${row.fill_id}`}
              role={href ? "link" : undefined}
              tabIndex={href ? 0 : undefined}
              onClick={openHref}
              onAuxClick={(event) => {
                if (event.button === 1) openHref();
              }}
              onKeyDown={(event) => {
                if (href && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  openHref();
                }
              }}
              className={cn(
                href &&
                  "cursor-pointer hover:bg-muted/30 focus-visible:bg-muted/30 focus-visible:outline-none"
              )}
            >
              <TableCell className="text-muted-foreground text-sm">
                <span className="inline-flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-block size-2 rounded-full",
                      STATUS_DOT[row.status] ?? "bg-muted-foreground"
                    )}
                  />
                  {row.status}
                  <StalenessDot
                    synced_at={row.synced_at}
                    staleness_ms={row.staleness_ms}
                  />
                </span>
              </TableCell>
              <TableCell className="font-medium text-sm">{display}</TableCell>
              <TableCell className="text-center">
                {row.side === "BUY" ? (
                  <span className="font-mono font-semibold text-success text-xs tracking-wide">
                    BUY
                  </span>
                ) : row.side === "SELL" ? (
                  <span className="font-mono font-semibold text-destructive text-xs tracking-wide">
                    SELL
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-right text-sm tabular-nums">
                {row.size_usdc !== null ? formatUsdc(row.size_usdc) : "—"}
              </TableCell>
              <TableCell className="text-right text-muted-foreground text-sm tabular-nums">
                {row.filled_size_usdc !== null
                  ? formatUsdc(row.filled_size_usdc)
                  : "—"}
              </TableCell>
              <TableCell className="text-right text-muted-foreground text-sm tabular-nums">
                {formatPrice(row.limit_price)}
              </TableCell>
              <TableCell className="text-right text-muted-foreground text-sm">
                {timeAgo(row.observed_at)}
              </TableCell>
              <TableCell className="pl-0 text-right">
                <RowCopyButton row={row} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function filterHistoryOrders(
  orders: readonly ExecutionOrder[],
  filter: OrdersStatusFilter
): ExecutionOrder[] {
  const bucket = HISTORY_STATUS_BUCKETS[filter];
  if (bucket === "all") return [...orders];
  const allowed = new Set(bucket);
  return orders.filter((order) => allowed.has(order.status));
}
