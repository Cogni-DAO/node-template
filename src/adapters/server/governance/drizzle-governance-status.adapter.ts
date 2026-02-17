// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/governance/drizzle-governance-status`
 * Purpose: Drizzle implementation of GovernanceStatusPort for system tenant governance queries.
 * Scope: Read-only queries against schedules and ai_threads tables for system tenant. Does not contain business logic or handle authentication.
 * Invariants:
 * - SYSTEM_TENANT_SCOPE: All queries filter by COGNI_SYSTEM_PRINCIPAL_USER_ID
 * - RLS_COMPATIBLE: Queries use owner_user_id filter
 * - Returns Date objects (not ISO strings)
 * Side-effects: IO (database reads)
 * Links: src/ports/governance-status.port.ts, docs/spec/governance-status-api.md
 * @public
 */

import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";

import type { Database } from "@/adapters/server/db/client";
import type { GovernanceRun, GovernanceStatusPort } from "@/ports";
import { COGNI_SYSTEM_PRINCIPAL_USER_ID } from "@/shared/constants/system-tenant";
import { aiThreads, schedules } from "@/shared/db/schema";

export class DrizzleGovernanceStatusAdapter implements GovernanceStatusPort {
  constructor(private readonly db: Database) {}

  async getScheduleStatus(): Promise<Date | null> {
    // next_run_at is a cron-derived cache. Temporal is authoritative.
    // Future: hydrate from ScheduleControlPort.describeSchedule() for precision.
    const results = await this.db
      .select({ nextRunAt: schedules.nextRunAt })
      .from(schedules)
      .where(
        and(
          eq(schedules.ownerUserId, COGNI_SYSTEM_PRINCIPAL_USER_ID),
          eq(schedules.enabled, true),
          isNotNull(schedules.nextRunAt)
        )
      )
      .orderBy(asc(schedules.nextRunAt))
      .limit(1);

    return results[0]?.nextRunAt ?? null;
  }

  async getRecentRuns(params: { limit: number }): Promise<GovernanceRun[]> {
    const threads = await this.db
      .select({
        stateKey: aiThreads.stateKey,
        metadata: aiThreads.metadata,
        createdAt: aiThreads.createdAt,
        updatedAt: aiThreads.updatedAt,
      })
      .from(aiThreads)
      .where(
        and(
          eq(aiThreads.ownerUserId, COGNI_SYSTEM_PRINCIPAL_USER_ID),
          isNull(aiThreads.deletedAt)
        )
      )
      .orderBy(desc(aiThreads.updatedAt))
      .limit(params.limit);

    return threads.map((t) => ({
      id: t.stateKey,
      title: (t.metadata as { title?: string } | null)?.title ?? null,
      startedAt: t.createdAt,
      lastActivity: t.updatedAt,
    }));
  }
}
