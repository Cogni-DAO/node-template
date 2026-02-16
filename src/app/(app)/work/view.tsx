// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/work/view`
 * Purpose: Client-side work dashboard with sorting, filtering, and search.
 * Scope: Presentation + URL-driven filter state. Does not fetch data or modify server state.
 * Invariants: KIT_IS_ONLY_API, MOBILE_FIRST
 * Side-effects: none
 * Links: [WorkPage](./page.tsx)
 * @public
 */

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";

import {
  Badge,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components";
import type { WorkItem } from "@/lib/work-scanner";

const STATUS_ORDER: Record<string, number> = {
  "In Progress": 0,
  InProgress: 0,
  Active: 0,
  Todo: 1,
  Blocked: 2,
  Backlog: 3,
  Done: 4,
  Archived: 5,
  Complete: 5,
};

const STATUS_INTENT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  "In Progress": "default",
  InProgress: "default",
  Active: "default",
  Todo: "secondary",
  Blocked: "destructive",
  Backlog: "outline",
  Done: "outline",
  Archived: "outline",
  Complete: "outline",
};

function sortItems(items: WorkItem[]): WorkItem[] {
  return [...items].sort((a, b) => {
    // Priority ascending (undefined last)
    const pa = a.priority ?? 999;
    const pb = b.priority ?? 999;
    if (pa !== pb) return pa - pb;

    // Status order
    const sa = STATUS_ORDER[a.status] ?? 6;
    const sb = STATUS_ORDER[b.status] ?? 6;
    if (sa !== sb) return sa - sb;

    // Updated descending (fallback to created)
    const da = a.updated || a.created || "";
    const db = b.updated || b.created || "";
    return db.localeCompare(da);
  });
}

function getUnique(items: WorkItem[], key: keyof WorkItem): string[] {
  const set = new Set<string>();
  for (const item of items) {
    const val = item[key];
    if (typeof val === "string" && val) set.add(val);
  }
  return [...set].sort();
}

function countByField(
  items: WorkItem[],
  key: keyof WorkItem
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const val = item[key];
    if (typeof val === "string" && val) {
      counts[val] = (counts[val] ?? 0) + 1;
    }
  }
  return counts;
}

export function WorkDashboardView({ items }: { items: WorkItem[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const typeFilter = searchParams.get("type") ?? "";
  const statusFilter = searchParams.get("status") ?? "";
  const maxPri = searchParams.get("maxPri") ?? "";
  const query = searchParams.get("q") ?? "";

  const setParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.replace(`/work?${params.toString()}`, { scroll: false });
  };

  const filtered = useMemo(() => {
    let result = items;

    if (typeFilter) {
      result = result.filter((i) => i.type === typeFilter);
    }
    if (statusFilter) {
      result = result.filter((i) => i.status === statusFilter);
    }
    if (maxPri) {
      const n = Number(maxPri);
      if (!Number.isNaN(n)) {
        result = result.filter(
          (i) => i.priority !== undefined && i.priority <= n
        );
      }
    }
    if (query) {
      const q = query.toLowerCase();
      result = result.filter(
        (i) =>
          i.id.toLowerCase().includes(q) ||
          i.title.toLowerCase().includes(q) ||
          i.labels.some((l) => l.toLowerCase().includes(q))
      );
    }

    return sortItems(result);
  }, [items, typeFilter, statusFilter, maxPri, query]);

  const types = getUnique(items, "type");
  const statuses = getUnique(items, "status");
  const statusCounts = countByField(filtered, "status");

  return (
    <div className="mx-auto flex max-w-[var(--max-width-container-screen)] flex-col gap-6 p-4 md:p-8 lg:px-16">
      <div>
        <h1 className="font-semibold text-2xl">Work Dashboard</h1>
        <p className="text-muted-foreground text-sm">
          {filtered.length} of {items.length} items
          {Object.entries(statusCounts).length > 0 && (
            <span className="ml-2">
              (
              {Object.entries(statusCounts)
                .sort(
                  ([a], [b]) => (STATUS_ORDER[a] ?? 6) - (STATUS_ORDER[b] ?? 6)
                )
                .map(([s, c]) => `${s}: ${c}`)
                .join(" / ")}
              )
            </span>
          )}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select
          value={typeFilter}
          onValueChange={(v) => setParam("type", v === "all" ? "" : v)}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {types.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={statusFilter}
          onValueChange={(v) => setParam("status", v === "all" ? "" : v)}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={maxPri}
          onValueChange={(v) => setParam("maxPri", v === "any" ? "" : v)}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Any priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any priority</SelectItem>
            <SelectItem value="0">P0</SelectItem>
            <SelectItem value="1">P0-P1</SelectItem>
            <SelectItem value="2">P0-P2</SelectItem>
            <SelectItem value="3">P0-P3</SelectItem>
          </SelectContent>
        </Select>

        <Input
          className="w-48"
          placeholder="Search id, title, labels..."
          value={query}
          onChange={(e) => setParam("q", e.target.value)}
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">ID</TableHead>
              <TableHead>Title</TableHead>
              <TableHead className="w-20">Type</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-12">Pri</TableHead>
              <TableHead className="w-12">Est</TableHead>
              <TableHead>Assignees</TableHead>
              <TableHead>Labels</TableHead>
              <TableHead className="w-24">Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="py-8 text-center text-muted-foreground"
                >
                  No work items found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((item) => (
                <TableRow key={item.path}>
                  <TableCell className="font-mono text-xs">
                    {item.id || "\u2014"}
                  </TableCell>
                  <TableCell>
                    <span className="font-medium text-sm">
                      {item.title || "\u2014"}
                    </span>
                    <span className="block max-w-sm truncate text-muted-foreground text-xs">
                      {item.path}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge intent="outline" className="text-xs">
                      {item.type || "\u2014"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {item.status ? (
                      <Badge
                        intent={STATUS_INTENT[item.status] ?? "outline"}
                        className="text-xs"
                      >
                        {item.status}
                      </Badge>
                    ) : (
                      "\u2014"
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {item.priority ?? "\u2014"}
                  </TableCell>
                  <TableCell className="text-center">
                    {item.estimate ?? "\u2014"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {item.assignees.length > 0
                      ? item.assignees.join(", ")
                      : "\u2014"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {item.labels.length > 0
                        ? item.labels.map((l) => (
                            <Badge key={l} intent="outline" className="text-xs">
                              {l}
                            </Badge>
                          ))
                        : "\u2014"}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {item.updated || item.created || "\u2014"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
