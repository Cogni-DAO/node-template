// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/work/_components/columns`
 * Purpose: TanStack column definitions for the work-items DataGrid.
 * Scope: Pure column descriptors + inline cells. No fetching, no router.
 * Invariants:
 *   - HEADER_OWNS_CONTROLS: every header renders via reui `DataGridColumnHeader`
 *     so sort + visibility live inside the column dropdown — same standard as
 *     poly `WalletsTable` / `PositionsTable`.
 *   - filterFn: "arrIncludesSome" on type/status/projectId so the multi-select
 *     facet toolbar in `view.tsx` can drive `columnFilters`.
 * @internal
 */

"use client";

import type { WorkItemDto } from "@cogni/node-contracts";
import { createColumnHelper } from "@tanstack/react-table";

import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";

import { StatusPill, TypeIcon } from "./work-item-icons";

const col = createColumnHelper<WorkItemDto>();

export const columns = [
  col.accessor("priority", {
    header: ({ column }) => (
      <DataGridColumnHeader column={column} title="Pri" visibility />
    ),
    size: 60,
    cell: (info) => {
      const v = info.getValue();
      if (v == null)
        return <span className="text-muted-foreground">&mdash;</span>;
      return (
        <span className="inline-flex w-7 justify-center rounded-md bg-muted px-1.5 py-0.5 font-medium text-xs">
          P{v}
        </span>
      );
    },
    sortingFn: (a, b) => {
      const pa = a.original.priority ?? 999;
      const pb = b.original.priority ?? 999;
      return pa - pb;
    },
    meta: { headerTitle: "Pri" },
  }),

  col.accessor("type", {
    header: ({ column }) => (
      <DataGridColumnHeader column={column} title="Type" visibility />
    ),
    size: 55,
    cell: (info) => <TypeIcon type={info.getValue()} />,
    filterFn: "arrIncludesSome",
    meta: { headerTitle: "Type" },
  }),

  col.display({
    id: "item",
    header: ({ column }) => (
      <DataGridColumnHeader column={column} title="Item" visibility />
    ),
    minSize: 250,
    cell: ({ row }) => {
      const { id, title } = row.original;
      return (
        <div className="flex flex-col gap-0.5 py-0.5">
          <span className="line-clamp-1 text-sm">{title}</span>
          <span className="font-mono text-muted-foreground text-xs">{id}</span>
        </div>
      );
    },
    meta: { headerTitle: "Item" },
  }),

  col.accessor("status", {
    header: ({ column }) => (
      <DataGridColumnHeader column={column} title="Status" visibility />
    ),
    size: 150,
    cell: (info) => <StatusPill status={info.getValue()} />,
    filterFn: "arrIncludesSome",
    meta: { headerTitle: "Status" },
  }),

  col.accessor("projectId", {
    header: ({ column }) => (
      <DataGridColumnHeader column={column} title="Project" visibility />
    ),
    size: 140,
    cell: (info) => {
      const v = info.getValue();
      if (!v) return null;
      return (
        <span className="truncate text-muted-foreground text-xs">
          {v.replace("proj.", "")}
        </span>
      );
    },
    filterFn: "arrIncludesSome",
    meta: { headerTitle: "Project" },
  }),

  col.accessor("updatedAt", {
    header: ({ column }) => (
      <DataGridColumnHeader column={column} title="Updated" visibility />
    ),
    size: 110,
    cell: (info) => {
      const v = info.getValue() || info.row.original.createdAt;
      if (!v) return <span className="text-muted-foreground">&mdash;</span>;
      return (
        <span className="text-muted-foreground text-xs">{v.slice(0, 10)}</span>
      );
    },
    sortingFn: (a, b) => {
      const da = a.original.updatedAt || a.original.createdAt || "";
      const db = b.original.updatedAt || b.original.createdAt || "";
      return da.localeCompare(db);
    },
    meta: { headerTitle: "Updated" },
  }),

  col.accessor("estimate", {
    header: ({ column }) => (
      <DataGridColumnHeader column={column} title="Est" visibility />
    ),
    size: 55,
    cell: (info) => {
      const v = info.getValue();
      return (
        <span className="text-center text-muted-foreground text-xs">
          {v ?? "—"}
        </span>
      );
    },
    meta: { headerTitle: "Est" },
  }),
];
