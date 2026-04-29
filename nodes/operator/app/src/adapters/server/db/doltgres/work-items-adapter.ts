// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/db/doltgres/work-items-adapter`
 * Purpose: Operator-local Doltgres adapter for work_items — implements the v0 surface (Query + create + patch) for task.0423.
 * Scope: Reads/writes the `work_items` table in `knowledge_operator`. Auto-commits on every write per AUTO_COMMIT_ON_WRITE.
 * Invariants:
 *   - DRIZZLE_NATIVE: Uses drizzle-orm tagged queries — Doltgres 0.56+ supports the extended wire protocol; no `sql.unsafe` workarounds.
 *   - AUTO_COMMIT_ON_WRITE: Each create/patch issues `dolt_commit('-Am', ...)` before returning.
 *   - AUTHOR_ATTRIBUTED: dolt_commit messages embed an `authorTag` string the route derives from `getSessionUser`.
 *   - ID_RANGE_RESERVED: Allocator floor is 5000 per type; `max(MAX(numeric_suffix), 4999) + 1`.
 *   - PATCH_ALLOWLIST: Only fields enumerated in `WorkItemsPatchSet` are mutable.
 *   - OPERATOR_LOCAL_ADAPTER_V0: Lives here, NOT in packages/work-items/.
 * Side-effects: IO (database reads/writes; dolt_commit calls)
 * Links: docs/spec/work-items-port.md, work/items/task.0423.doltgres-work-items-source-of-truth.md
 * @public
 */

import {
  type NewWorkItemRow,
  type WorkItemRow,
  workItems,
} from "@cogni/operator-doltgres-schema";
import type {
  ActorKind,
  SubjectRef,
  WorkItem,
  WorkItemId,
  WorkItemStatus,
  WorkItemType,
  WorkQuery,
} from "@cogni/work-items";
import { toWorkItemId } from "@cogni/work-items";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";

import type {
  WorkItemsCreateInput,
  WorkItemsDoltgresPort,
  WorkItemsPatchInput,
} from "@/ports/server";

import type { DoltgresDb } from "./client";

const ID_FLOOR = 5000;

// ── Row mapping ──────────────────────────────────────

function actorOf(v: unknown): ActorKind {
  return v === "human" || v === "ai" ? v : "either";
}

function jsonArrayOf<T>(v: unknown): readonly T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function rowToWorkItem(row: WorkItemRow): WorkItem {
  return {
    id: toWorkItemId(row.id),
    type: row.type as WorkItemType,
    title: row.title,
    status: row.status as WorkItemStatus,
    node: row.node,
    actor: actorOf((row as { actor?: unknown }).actor),
    assignees: jsonArrayOf<SubjectRef>(row.assignees),
    externalRefs: jsonArrayOf<WorkItem["externalRefs"][number]>(
      row.externalRefs
    ),
    labels: jsonArrayOf<string>(row.labels),
    specRefs: jsonArrayOf<string>(row.specRefs),
    revision: row.revision,
    deployVerified: row.deployVerified,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.priority != null && { priority: row.priority }),
    ...(row.rank != null && { rank: row.rank }),
    ...(row.estimate != null && { estimate: row.estimate }),
    ...(row.summary != null && { summary: row.summary }),
    ...(row.outcome != null && { outcome: row.outcome }),
    ...(row.projectId != null && { projectId: toWorkItemId(row.projectId) }),
    ...(row.parentId != null && { parentId: toWorkItemId(row.parentId) }),
    ...(row.branch != null && { branch: row.branch }),
    ...(row.pr != null && { pr: row.pr }),
    ...(row.reviewer != null && { reviewer: row.reviewer }),
    ...(row.blockedBy != null && { blockedBy: toWorkItemId(row.blockedBy) }),
    ...(row.claimedByRun != null && { claimedByRun: row.claimedByRun }),
    ...(row.claimedAt != null && {
      claimedAt: row.claimedAt.toISOString(),
    }),
    ...(row.lastCommand != null && { lastCommand: row.lastCommand }),
  };
}

// ── ID allocation ────────────────────────────────────

function parseSuffix(id: string, type: WorkItemType): number | null {
  const prefix = `${type}.`;
  if (!id.startsWith(prefix)) return null;
  const tail = id.slice(prefix.length);
  return /^\d+$/.test(tail) ? Number.parseInt(tail, 10) : null;
}

// ── Adapter ──────────────────────────────────────────

export class DoltgresOperatorWorkItemAdapter implements WorkItemsDoltgresPort {
  constructor(private readonly db: DoltgresDb) {}

  async get(id: WorkItemId): Promise<WorkItem | null> {
    const rows = await this.db
      .select()
      .from(workItems)
      .where(eq(workItems.id, id as string))
      .limit(1);
    return rows[0] ? rowToWorkItem(rows[0]) : null;
  }

  async list(
    query: WorkQuery = {}
  ): Promise<{ items: WorkItem[]; nextCursor?: string }> {
    const conds = [];

    if (query.ids?.length) {
      conds.push(
        inArray(
          workItems.id,
          query.ids.map((id) => id as string)
        )
      );
    }
    if (query.types?.length) {
      conds.push(inArray(workItems.type, [...query.types]));
    }
    if (query.statuses?.length) {
      conds.push(inArray(workItems.status, [...query.statuses]));
    }
    if (query.projectId) {
      conds.push(eq(workItems.projectId, query.projectId as string));
    }
    if (query.node) {
      const nodes = Array.isArray(query.node) ? [...query.node] : [query.node];
      conds.push(inArray(workItems.node, nodes));
    }
    if (query.text) {
      const pat = `%${query.text}%`;
      conds.push(
        or(ilike(workItems.title, pat), ilike(workItems.summary, pat))
      );
    }

    const limit = Math.min(query.limit ?? 100, 500);

    const rows = await this.db
      .select()
      .from(workItems)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(workItems.createdAt))
      .limit(limit);

    return { items: rows.map(rowToWorkItem) };
  }

  async create(
    input: WorkItemsCreateInput,
    authorTag: string
  ): Promise<WorkItem> {
    const idRows = await this.db
      .select({ id: workItems.id })
      .from(workItems)
      .where(eq(workItems.type, input.type));

    let maxSuffix = ID_FLOOR - 1;
    for (const r of idRows) {
      const suffix = parseSuffix(r.id, input.type);
      if (suffix !== null && suffix > maxSuffix) maxSuffix = suffix;
    }
    const allocatedId = `${input.type}.${String(maxSuffix + 1).padStart(4, "0")}`;

    const values: NewWorkItemRow = {
      id: allocatedId,
      type: input.type,
      title: input.title,
      status: "needs_triage",
      node: input.node ?? "shared",
      ...(input.summary !== undefined && { summary: input.summary }),
      ...(input.outcome !== undefined && { outcome: input.outcome }),
      ...(input.projectId !== undefined && {
        projectId: input.projectId as string,
      }),
      ...(input.parentId !== undefined && {
        parentId: input.parentId as string,
      }),
      ...(input.assignees && { assignees: [...input.assignees] }),
      ...(input.labels && { labels: [...input.labels] }),
      ...(input.specRefs && { specRefs: [...input.specRefs] }),
    };

    const inserted = await this.db.insert(workItems).values(values).returning();
    const row = inserted[0];
    if (!row) throw new Error("INSERT returned no row");

    await this.db.execute(
      sql`SELECT dolt_commit('-Am', ${`task.0423: create ${allocatedId} by ${authorTag}`})`
    );

    return rowToWorkItem(row);
  }

  async patch(
    input: WorkItemsPatchInput,
    authorTag: string
  ): Promise<WorkItem | null> {
    const set: Partial<NewWorkItemRow> = { updatedAt: new Date() };
    const s = input.set;
    if (s.title !== undefined) set.title = s.title;
    if (s.summary !== undefined) set.summary = s.summary;
    if (s.outcome !== undefined) set.outcome = s.outcome;
    if (s.status !== undefined) set.status = s.status;
    if (s.priority !== undefined) set.priority = s.priority;
    if (s.rank !== undefined) set.rank = s.rank;
    if (s.estimate !== undefined) set.estimate = s.estimate;
    if (s.labels !== undefined) set.labels = [...s.labels];
    if (s.specRefs !== undefined) set.specRefs = [...s.specRefs];
    if (s.branch !== undefined) set.branch = s.branch;
    if (s.pr !== undefined) set.pr = s.pr;
    if (s.reviewer !== undefined) set.reviewer = s.reviewer;
    if (s.node !== undefined) set.node = s.node;

    const updated = await this.db
      .update(workItems)
      .set(set)
      .where(eq(workItems.id, input.id as string))
      .returning();
    const row = updated[0];
    if (!row) return null;

    await this.db.execute(
      sql`SELECT dolt_commit('-Am', ${`task.0423: patch ${input.id as string} by ${authorTag}`})`
    );

    return rowToWorkItem(row);
  }
}
