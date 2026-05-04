// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/research/view`
 * Purpose: One-view wallets research workspace — focus one benchmark target,
 *          then move between target, hedge, compare, discovery, and guardrail
 *          panels without stacking every surface at once.
 * Scope: Client view. Joins live leaderboard (`fetchTopWallets`) with the user's
 *        tracked targets (`fetchCopyTargets`) and passes rows into the shared
 *        table. Track/untrack mutations live here. Does not place orders.
 * Invariants:
 *   - WALLET_TABLE_SINGLETON: renders via `@app/(app)/_components/wallets-table`.
 *     Sort/filter/hide controls live in each column header (reui kit) —
 *     no parallel toolbar chips.
 *   - URL_DRIVEN_STATE: q / period / tracked / sort all round-trip through
 *     the URL for shareable views.
 *   - COPY_TARGETS_QUERY_KEY shared with the dashboard copy-target controls so flips
 *     reflect across surfaces.
 * Side-effects: IO (React Query — fetchTopWallets, fetchCopyTargets,
 *               createCopyTarget, deleteCopyTarget).
 * @public
 */

"use client";

import type { WalletTimePeriod } from "@cogni/poly-ai-tools";
import {
  PolyAddressSchema,
  type PolyWalletStatusOutput,
  type WalletAnalysisDistributions,
  type WalletAnalysisResponse,
} from "@cogni/poly-node-contracts";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { ColumnFiltersState, SortingState } from "@tanstack/react-table";
import { Ban, Plus, Radio, Search, Shield, WalletCards } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import {
  buildWalletRows,
  type WalletRow,
  WalletsTable,
} from "@/app/(app)/_components/wallets-table";
import { Input, ToggleGroup, ToggleGroupItem } from "@/components";
import {
  CopyWalletButton,
  DistributionComparisonBlock,
  type DistributionComparisonSeries,
  useWalletAnalysis,
  WalletAnalysisSurface,
  WalletDetailDrawer,
  WalletQuickJump,
} from "@/features/wallet-analysis";

import {
  createCopyTarget,
  deleteCopyTarget,
  fetchCopyTargets,
} from "../dashboard/_api/fetchCopyTargets";
import { fetchTopWallets } from "../dashboard/_api/fetchTopWallets";

const COPY_TARGETS_QUERY_KEY = ["dashboard-copy-targets"] as const;

const PERIOD_OPTIONS: readonly WalletTimePeriod[] = [
  "DAY",
  "WEEK",
  "MONTH",
  "ALL",
] as const;
const TOP_N = 100;
const PRIMARY_RESEARCH_WALLETS = [
  {
    label: "RN1",
    address: "0x2005d16a84ceefa912d4e380cd32e7ff827875ea",
  },
  {
    label: "swisstony",
    address: "0x204f72f35326db932158cba6adff0b9a1da95e14",
  },
] as const;

const RESEARCH_PANELS = [
  { id: "target", label: "Target" },
  { id: "hedges", label: "Hedges" },
  { id: "compare", label: "Compare" },
  { id: "discover", label: "Discover" },
  { id: "guardrails", label: "Guardrails" },
] as const;

type ResearchComparisonWallet = {
  label: string;
  address: string;
};

type ResearchPanel = (typeof RESEARCH_PANELS)[number]["id"];
type PrimaryResearchWallet = (typeof PRIMARY_RESEARCH_WALLETS)[number];

async function fetchWalletStatus(): Promise<PolyWalletStatusOutput> {
  const res = await fetch("/api/v1/poly/wallet/status", {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`wallet status failed: ${res.status}`);
  }
  return (await res.json()) as PolyWalletStatusOutput;
}

async function fetchWalletDistributions(
  address: string
): Promise<WalletAnalysisDistributions | undefined> {
  const params = new URLSearchParams({
    include: "distributions",
    interval: "ALL",
    distributionMode: "historical",
  });
  const res = await fetch(
    `/api/v1/poly/wallets/${address.toLowerCase()}?${params.toString()}`
  );
  if (!res.ok) {
    throw new Error(`wallet distributions failed: ${res.status}`);
  }
  const json = (await res.json()) as WalletAnalysisResponse;
  return json.distributions;
}

export function ResearchView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  // ── URL-driven state ──────────────────────────────────────────────
  const initialPeriod = useMemo<WalletTimePeriod>(() => {
    const p = searchParams.get("period");
    return PERIOD_OPTIONS.includes(p as WalletTimePeriod)
      ? (p as WalletTimePeriod)
      : "WEEK";
  }, [searchParams]);

  const initialFilters = useMemo<ColumnFiltersState>(() => {
    const out: ColumnFiltersState = [];
    const trk = searchParams.get("tracked");
    if (trk) out.push({ id: "tracked", value: trk.split(",") });
    return out;
  }, [searchParams]);

  const initialSort = useMemo<SortingState>(() => {
    const s = searchParams.get("sort");
    if (!s) return [{ id: "rank", desc: false }];
    const desc = s.startsWith("-");
    return [{ id: desc ? s.slice(1) : s, desc }];
  }, [searchParams]);

  const [period, setPeriod] = useState<WalletTimePeriod>(initialPeriod);
  const [columnFilters, setColumnFilters] =
    useState<ColumnFiltersState>(initialFilters);
  const [sorting, setSorting] = useState<SortingState>(initialSort);
  const [globalFilter, setGlobalFilter] = useState(searchParams.get("q") ?? "");
  const [selectedAddr, setSelectedAddr] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<ResearchPanel>("target");
  const [activeWalletAddress, setActiveWalletAddress] = useState<string>(
    PRIMARY_RESEARCH_WALLETS[0].address
  );

  const syncUrl = useCallback(
    (next: {
      period?: WalletTimePeriod;
      filters?: ColumnFiltersState;
      sorting?: SortingState;
      q?: string;
    }) => {
      const params = new URLSearchParams();
      const p = next.period ?? period;
      if (p !== "WEEK") params.set("period", p);
      for (const f of next.filters ?? columnFilters) {
        if (Array.isArray(f.value) && f.value.length > 0) {
          params.set(f.id, (f.value as string[]).join(","));
        }
      }
      const s = (next.sorting ?? sorting)[0];
      if (s && !(s.id === "rank" && !s.desc)) {
        params.set("sort", s.desc ? `-${s.id}` : s.id);
      }
      const q = next.q ?? globalFilter;
      if (q) params.set("q", q);
      const qs = params.toString();
      router.replace(qs ? `/research?${qs}` : "/research", { scroll: false });
    },
    [period, columnFilters, sorting, globalFilter, router]
  );

  // ── Data ──────────────────────────────────────────────────────────
  const {
    data: walletsData,
    isLoading: walletsLoading,
    isError: walletsError,
  } = useQuery({
    queryKey: ["research-top-wallets", period],
    queryFn: () => fetchTopWallets({ timePeriod: period, limit: TOP_N }),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });

  const { data: targetsData } = useQuery({
    queryKey: COPY_TARGETS_QUERY_KEY,
    queryFn: fetchCopyTargets,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });

  const { data: walletStatus } = useQuery({
    queryKey: ["poly-wallet-status"],
    queryFn: fetchWalletStatus,
    staleTime: 10_000,
    gcTime: 60_000,
    retry: 1,
  });

  const trackedSet = useMemo(
    () =>
      new Set(
        (targetsData?.targets ?? []).map((t) => t.target_wallet.toLowerCase())
      ),
    [targetsData]
  );

  const targetsByWallet = useMemo(
    () =>
      new Map(
        (targetsData?.targets ?? []).map((t) => [
          t.target_wallet.toLowerCase(),
          t,
        ])
      ),
    [targetsData]
  );

  const rows = useMemo(
    () => buildWalletRows(walletsData?.traders ?? [], trackedSet),
    [walletsData, trackedSet]
  );

  // ── Mutations (track / untrack) ───────────────────────────────────
  const createTargetMutation = useMutation({
    mutationFn: (targetWallet: string) =>
      createCopyTarget({ target_wallet: targetWallet }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: COPY_TARGETS_QUERY_KEY }),
  });

  const deleteTargetMutation = useMutation({
    mutationFn: (id: string) => deleteCopyTarget(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: COPY_TARGETS_QUERY_KEY }),
  });

  const renderActions = useCallback(
    (row: WalletRow) => {
      const target = targetsByWallet.get(row.proxyWallet.toLowerCase());
      if (row.tracked && target) {
        return (
          <button
            type="button"
            aria-label={`Untrack ${row.proxyWallet}`}
            title="Stop copy-trading this wallet (click the green icon to unfollow)"
            disabled={deleteTargetMutation.isPending}
            onClick={(e) => {
              e.stopPropagation();
              deleteTargetMutation.mutate(target.target_id);
            }}
            className="inline-flex size-7 items-center justify-center rounded text-success hover:bg-destructive/10 hover:text-destructive disabled:cursor-wait disabled:opacity-40"
          >
            <Radio className="size-3.5 animate-pulse" />
          </button>
        );
      }
      return (
        <button
          type="button"
          aria-label={`Track ${row.proxyWallet}`}
          title="Track this wallet (mirror its fills)"
          disabled={createTargetMutation.isPending}
          onClick={(e) => {
            e.stopPropagation();
            createTargetMutation.mutate(row.proxyWallet);
          }}
          className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-primary/10 hover:text-primary disabled:cursor-wait disabled:opacity-40"
        >
          <Plus className="size-3.5" />
        </button>
      );
    },
    [createTargetMutation, deleteTargetMutation, targetsByWallet]
  );

  // ── Off-roster address jump ───────────────────────────────────────
  // If the search box contains a full valid 0x address not present in the
  // current leaderboard window, surface a direct-analyze affordance so the
  // user is never limited to the in-memory top-N.
  const addressMatch = useMemo(
    () => PolyAddressSchema.safeParse(globalFilter.trim()),
    [globalFilter]
  );
  const offRosterAddress =
    addressMatch.success &&
    !rows.some(
      (r) => r.proxyWallet.toLowerCase() === addressMatch.data.toLowerCase()
    )
      ? addressMatch.data
      : null;
  const activeWallet =
    PRIMARY_RESEARCH_WALLETS.find(
      (wallet) => wallet.address === activeWalletAddress
    ) ?? PRIMARY_RESEARCH_WALLETS[0];

  return (
    <div className="flex flex-col gap-4 p-5 md:p-6">
      <section className="rounded-lg border bg-card p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider">
              <WalletCards className="size-3.5" />
              Research
            </div>
            <h1 className="font-semibold text-xl tracking-tight md:text-2xl">
              Hedge-ready copy targets
            </h1>
          </div>

          <div className="flex flex-wrap gap-2">
            {PRIMARY_RESEARCH_WALLETS.map((wallet) => (
              <button
                key={wallet.address}
                type="button"
                aria-pressed={activeWallet.address === wallet.address}
                onClick={() => setActiveWalletAddress(wallet.address)}
                className={
                  activeWallet.address === wallet.address
                    ? "rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground text-sm"
                    : "rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
                }
              >
                {wallet.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex gap-1 overflow-x-auto rounded-lg border bg-background p-1">
          {RESEARCH_PANELS.map((panel) => (
            <button
              key={panel.id}
              type="button"
              aria-pressed={activePanel === panel.id}
              onClick={() => setActivePanel(panel.id)}
              className={
                activePanel === panel.id
                  ? "shrink-0 rounded-md bg-muted px-3 py-1.5 font-medium text-sm"
                  : "shrink-0 rounded-md px-3 py-1.5 text-muted-foreground text-sm hover:bg-muted/60 hover:text-foreground"
              }
            >
              {panel.label}
            </button>
          ))}
        </div>
      </section>

      <ResearchBenchmarkBoard
        userWalletAddress={walletStatus?.funder_address ?? null}
        userWalletConnected={walletStatus?.connected === true}
        targets={targetsData?.targets ?? []}
        activeWallet={activeWallet}
        activePanel={activePanel}
      />

      {activePanel === "discover" ? (
        <ResearchDiscoveryPanel
          period={period}
          setPeriod={setPeriod}
          globalFilter={globalFilter}
          setGlobalFilter={setGlobalFilter}
          syncUrl={syncUrl}
          offRosterAddress={offRosterAddress}
          rows={rows}
          walletsLoading={walletsLoading}
          walletsError={walletsError}
          sorting={sorting}
          setSorting={setSorting}
          columnFilters={columnFilters}
          setColumnFilters={setColumnFilters}
          renderActions={renderActions}
          onSelectWallet={(addr) => setSelectedAddr(addr)}
        />
      ) : null}

      {activePanel === "guardrails" ? <NoFlyFooter /> : null}

      {/* Inline drawer — skeletons render instantly. */}
      <WalletDetailDrawer
        addr={selectedAddr}
        open={selectedAddr !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedAddr(null);
        }}
      />
    </div>
  );
}

function ResearchBenchmarkBoard({
  userWalletAddress,
  userWalletConnected,
  targets,
  activeWallet,
  activePanel,
}: {
  userWalletAddress: string | null;
  userWalletConnected: boolean;
  targets: readonly { target_wallet: string }[];
  activeWallet: PrimaryResearchWallet;
  activePanel: ResearchPanel;
}) {
  const comparisonWallets = useMemo(
    () => buildComparisonWallets(userWalletAddress, targets),
    [userWalletAddress, targets]
  );
  const distributionQueries = useQueries({
    queries: comparisonWallets.map((wallet) => ({
      queryKey: [
        "research-distribution-comparison",
        wallet.address.toLowerCase(),
      ],
      queryFn: () => fetchWalletDistributions(wallet.address),
      enabled: activePanel === "compare",
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    })),
  });
  const distributionSeries: readonly DistributionComparisonSeries[] =
    comparisonWallets.map((wallet, i) => ({
      label: wallet.label,
      data: distributionQueries[i]?.data,
      isLoading: distributionQueries[i]?.isLoading,
      isError: distributionQueries[i]?.isError,
    }));

  if (activePanel === "target") {
    return (
      <section className="flex flex-col gap-4">
        <PanelHeader eyebrow="Active Target" title={activeWallet.label} />
        <WalletAnalysisSurface
          key={activeWallet.address}
          addr={activeWallet.address}
          variant="compact"
          size="default"
          includeDistributions={false}
          headerActions={<CopyWalletButton addr={activeWallet.address} />}
        />
      </section>
    );
  }

  if (activePanel === "hedges") {
    return <HedgePolicyPanel activeWallet={activeWallet} />;
  }

  if (activePanel !== "compare") {
    return null;
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider">
            <WalletCards className="size-3.5" />
            Live Wallet Benchmarks
          </div>
          <h2 className="font-semibold text-lg">
            Copy targets vs your trading wallet
          </h2>
        </div>
        {userWalletAddress ? (
          <Link
            href={`/research/w/${userWalletAddress}`}
            className="rounded border px-3 py-1.5 text-sm hover:bg-muted"
          >
            Open your wallet
          </Link>
        ) : null}
      </div>

      {userWalletAddress ? (
        <WalletAnalysisSurface
          addr={userWalletAddress}
          variant="compact"
          size="default"
          includeDistributions={false}
        />
      ) : (
        <div className="rounded-lg border bg-muted/10 p-4">
          <p className="font-medium text-sm">Your comparison wallet</p>
          <p className="mt-1 text-muted-foreground text-sm">
            {userWalletConnected
              ? "Your wallet is connected, but the funder address is not available from wallet status yet."
              : "Connect a Polymarket trading wallet to compare your VWAP and active positions against RN1 and swisstony."}
          </p>
          <Link
            href="/credits"
            className="mt-3 inline-flex rounded border px-3 py-1.5 text-sm hover:bg-muted"
          >
            Open money setup
          </Link>
        </div>
      )}

      <div className="rounded-lg border border-primary/20 bg-card p-4">
        <DistributionComparisonBlock series={distributionSeries} />
      </div>
    </section>
  );
}

function HedgePolicyPanel({
  activeWallet,
}: {
  activeWallet: PrimaryResearchWallet;
}) {
  const { data, isLoading } = useWalletAnalysis(activeWallet.address, true, {
    interval: "ALL",
    includeDistributions: false,
  });
  const benchmark = data.benchmark;
  const policy = benchmark?.hedgePolicy;

  return (
    <section className="flex flex-col gap-4">
      <PanelHeader eyebrow="Hedge Policy" title={activeWallet.label}>
        <CopyWalletButton addr={activeWallet.address} />
      </PanelHeader>

      <div className="grid gap-3 md:grid-cols-3">
        <PolicyTile
          label="Actionable"
          value={
            policy
              ? `${policy.actionableHedges.toLocaleString()}/${policy.hedgedConditions.toLocaleString()}`
              : isLoading.benchmark
                ? "Loading"
                : "Not observed"
          }
          detail="Hedges passing dust and ratio gates"
        />
        <PolicyTile
          label="Follow when"
          value={
            policy ? `>=${formatPolicyPct(policy.minTargetHedgeRatio)}` : ">=2%"
          }
          detail={`and >=${formatPolicyUsd(policy?.minTargetHedgeUsdc ?? 5)} target hedge`}
        />
        <PolicyTile
          label="Smallest live pass"
          value={
            policy?.lowestActionableRatio
              ? formatPolicyPct(policy.lowestActionableRatio)
              : "Pending"
          }
          detail="Confirms the gate is reachable"
        />
      </div>

      <div className="rounded-lg border bg-muted/10 p-4 text-sm">
        <p className="font-medium">Prototype rule</p>
        <p className="mt-1 text-muted-foreground">
          Mirror opposite-token target buys only after the target has at least a
          2% hedge against its primary side and at least $5 in hedge cost basis.
        </p>
      </div>
    </section>
  );
}

function ResearchDiscoveryPanel({
  period,
  setPeriod,
  globalFilter,
  setGlobalFilter,
  syncUrl,
  offRosterAddress,
  rows,
  walletsLoading,
  walletsError,
  sorting,
  setSorting,
  columnFilters,
  setColumnFilters,
  renderActions,
  onSelectWallet,
}: {
  period: WalletTimePeriod;
  setPeriod: (period: WalletTimePeriod) => void;
  globalFilter: string;
  setGlobalFilter: (value: string) => void;
  syncUrl: (next: {
    period?: WalletTimePeriod;
    filters?: ColumnFiltersState;
    sorting?: SortingState;
    q?: string;
  }) => void;
  offRosterAddress: string | null;
  rows: WalletRow[];
  walletsLoading: boolean;
  walletsError: boolean;
  sorting: SortingState;
  setSorting: (next: SortingState) => void;
  columnFilters: ColumnFiltersState;
  setColumnFilters: (next: ColumnFiltersState) => void;
  renderActions: (row: WalletRow) => React.ReactNode;
  onSelectWallet: (addr: string) => void;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider">
            <Search className="size-3.5" />
            Wallet Discovery
          </div>
          <h2 className="font-semibold text-lg">Search Polymarket wallets</h2>
        </div>
        <WalletQuickJump className="w-full max-w-xl sm:w-96" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          data-search-input
          className="h-9 w-full sm:w-72"
          placeholder="Search wallet address or name..."
          value={globalFilter}
          onChange={(e) => {
            setGlobalFilter(e.target.value);
            syncUrl({ q: e.target.value });
          }}
        />
        <ToggleGroup
          type="single"
          value={period}
          onValueChange={(v) => {
            const next = (v as WalletTimePeriod | "") || "WEEK";
            if (!PERIOD_OPTIONS.includes(next)) return;
            setPeriod(next);
            syncUrl({ period: next });
          }}
          className="rounded-lg border"
        >
          {PERIOD_OPTIONS.map((p) => (
            <ToggleGroupItem key={p} value={p} className="px-3 text-xs">
              {p === "ALL" ? "All" : p.charAt(0) + p.slice(1).toLowerCase()}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {offRosterAddress && (
        <button
          type="button"
          onClick={() => onSelectWallet(offRosterAddress)}
          className="self-start rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-left text-sm hover:bg-primary/10"
        >
          Open wallet analysis for{" "}
          <code className="font-mono">{offRosterAddress}</code>
        </button>
      )}

      <WalletsTable
        rows={rows}
        variant="full"
        isLoading={walletsLoading}
        onRowClick={(row) => onSelectWallet(row.proxyWallet.toLowerCase())}
        renderActions={renderActions}
        emptyMessage={
          walletsError
            ? "Failed to load wallets. Try refreshing."
            : "No wallets match the current filters."
        }
        fullState={{
          sorting,
          onSortingChange: (next) => {
            setSorting(next);
            syncUrl({ sorting: next });
          },
          columnFilters,
          onColumnFiltersChange: (next) => {
            setColumnFilters(next);
            syncUrl({ filters: next });
          },
          globalFilter,
          onGlobalFilterChange: setGlobalFilter,
        }}
      />
    </section>
  );
}

function PanelHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-col gap-1">
        <div className="text-muted-foreground text-xs uppercase tracking-wider">
          {eyebrow}
        </div>
        <h2 className="font-semibold text-lg">{title}</h2>
      </div>
      {children ? (
        <div className="flex items-center gap-2">{children}</div>
      ) : null}
    </div>
  );
}

function PolicyTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 font-semibold text-2xl">{value}</p>
      <p className="mt-1 text-muted-foreground text-xs">{detail}</p>
    </div>
  );
}

function formatPolicyPct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatPolicyUsd(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function buildComparisonWallets(
  userWalletAddress: string | null,
  targets: readonly { target_wallet: string }[]
): readonly ResearchComparisonWallet[] {
  const wallets: ResearchComparisonWallet[] = [];
  const seen = new Set<string>();
  const addWallet = (wallet: ResearchComparisonWallet) => {
    const lower = wallet.address.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    wallets.push({ ...wallet, address: lower });
  };

  if (userWalletAddress) {
    addWallet({ label: "You", address: userWalletAddress });
  }
  for (const wallet of PRIMARY_RESEARCH_WALLETS) {
    addWallet(wallet);
  }
  for (const target of targets) {
    addWallet({
      label: shortAddress(target.target_wallet),
      address: target.target_wallet,
    });
  }

  return wallets;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function NoFlyFooter() {
  return (
    <aside className="mt-4 grid gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm md:grid-cols-2">
      <div className="flex gap-3">
        <Ban className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="space-y-1">
          <p className="font-semibold">Do not mirror</p>
          <ul className="text-muted-foreground text-xs leading-relaxed">
            <li>
              <code>JPMorgan101</code> — sub-block latency arb, uncopyable
            </li>
            <li>
              <code>denizz</code> — Iran-ceasefire specialist, Harvard-flagged
              category
            </li>
            <li>
              <code>avenger</code> — single-bet outlier, not skill
            </li>
            <li>generic whales — capital, not edge</li>
          </ul>
        </div>
      </div>
      <div className="flex gap-3">
        <Shield className="mt-0.5 size-4 shrink-0 text-success" />
        <div className="space-y-1 text-xs leading-relaxed">
          <p className="font-semibold text-foreground text-sm">
            Compliance gate
          </p>
          <p className="text-muted-foreground">
            Cross-check every wallet against the{" "}
            <a
              href="https://corpgov.law.harvard.edu/2026/03/25/from-iran-to-taylor-swift-informed-trading-in-prediction-markets/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline-offset-2 hover:underline"
            >
              Harvard 2026 flagged-wallet dataset
            </a>{" "}
            (210k pairs) before mirroring real money. Single correctness gate,
            zero runtime cost.
          </p>
        </div>
      </div>
    </aside>
  );
}
