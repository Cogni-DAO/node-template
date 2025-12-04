// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/accounts/drizzle.usage`
 * Purpose: Drizzle implementation of UsageService port.
 * Scope: Implements getUsageStats (SQL aggregation) and listUsageLogs (keyset pagination).
 * Invariants:
 * - Buckets are zero-filled for the requested range.
 * - Cursor is opaque base64-encoded string.
 * - Money is returned as decimal string.
 * @internal
 */

import { and, desc, eq, gte, lt, sql } from "drizzle-orm";

import type { Database } from "@/adapters/server/db/client";
import type {
  UsageBucket,
  UsageLogEntry,
  UsageLogsParams,
  UsageLogsResult,
  UsageService,
  UsageStatsParams,
  UsageStatsResult,
} from "@/ports";
import { llmUsage } from "@/shared/db";

export class DrizzleUsageAdapter implements UsageService {
  constructor(private readonly db: Database) {}

  async getUsageStats(params: UsageStatsParams): Promise<UsageStatsResult> {
    const { billingAccountId, from, to, groupBy } = params;

    // 1. Generate time series series in SQL or application
    // Using application-side zero-filling for simplicity and portability
    const buckets = this.generateBuckets(from, to, groupBy);

    // 2. Aggregate data in SQL
    // Truncate to bucket size
    const timeBucket =
      groupBy === "day"
        ? sql`date_trunc('day', ${llmUsage.createdAt} AT TIME ZONE 'UTC')`
        : sql`date_trunc('hour', ${llmUsage.createdAt} AT TIME ZONE 'UTC')`;

    const rows = await this.db
      .select({
        bucketStart: timeBucket,
        spend: sql<string>`sum(${llmUsage.providerCostUsd})`,
        tokens: sql<number>`sum(${llmUsage.promptTokens} + ${llmUsage.completionTokens})`,
        requests: sql<number>`count(*)`,
      })
      .from(llmUsage)
      .where(
        and(
          eq(llmUsage.billingAccountId, billingAccountId),
          gte(llmUsage.createdAt, from),
          lt(llmUsage.createdAt, to)
        )
      )
      .groupBy(timeBucket)
      .orderBy(timeBucket);

    // 3. Merge SQL results into zero-filled buckets
    const bucketMap = new Map<string, UsageBucket>();
    for (const row of rows) {
      // Drizzle returns Date object for timestamp, but sometimes it might be a string depending on driver/query
      const bucketStart = new Date(row.bucketStart as unknown as string | Date);
      const dateStr = bucketStart.toISOString();
      bucketMap.set(dateStr, {
        bucketStart: bucketStart,
        spend: row.spend ?? "0",
        tokens: Number(row.tokens ?? 0),
        requests: Number(row.requests ?? 0),
      });
    }

    const series: UsageBucket[] = buckets.map((date) => {
      const dateStr = date.toISOString();
      return (
        bucketMap.get(dateStr) ?? {
          bucketStart: date,
          spend: "0",
          tokens: 0,
          requests: 0,
        }
      );
    });

    // 4. Calculate totals
    let totalSpend = 0;
    let totalTokens = 0;
    let totalRequests = 0;

    for (const bucket of series) {
      totalSpend += Number.parseFloat(bucket.spend);
      totalTokens += bucket.tokens;
      totalRequests += bucket.requests;
    }

    return {
      series,
      totals: {
        spend: totalSpend.toFixed(6), // Keep precision
        tokens: totalTokens,
        requests: totalRequests,
      },
    };
  }

  async listUsageLogs(params: UsageLogsParams): Promise<UsageLogsResult> {
    const { billingAccountId, limit, cursor } = params;

    // Keyset pagination: (createdAt, id) < (cursorTime, cursorId)
    // Order: createdAt DESC, id DESC
    const where = cursor
      ? and(
          eq(llmUsage.billingAccountId, billingAccountId),
          sql`(${llmUsage.createdAt}, ${llmUsage.id}) < (${cursor.createdAt}, ${cursor.id})`
        )
      : eq(llmUsage.billingAccountId, billingAccountId);

    const rows = await this.db
      .select({
        id: llmUsage.id,
        createdAt: llmUsage.createdAt,
        model: llmUsage.model,
        promptTokens: llmUsage.promptTokens,
        completionTokens: llmUsage.completionTokens,
        providerCostUsd: llmUsage.providerCostUsd,
        metadata: llmUsage.usage, // Assuming usage column contains metadata/finish reason
      })
      .from(llmUsage)
      .where(where)
      .orderBy(desc(llmUsage.createdAt), desc(llmUsage.id))
      .limit(limit);

    const logs: UsageLogEntry[] = rows.map((row) => ({
      id: row.id,
      timestamp: row.createdAt,
      model: row.model ?? "unknown",
      tokensIn: row.promptTokens ?? 0,
      tokensOut: row.completionTokens ?? 0,
      cost: row.providerCostUsd ?? "0",
      metadata: row.metadata as Record<string, unknown>,
    }));

    let nextCursor: { createdAt: Date; id: string } | undefined;
    if (logs.length > 0) {
      const last = logs[logs.length - 1];
      if (last) {
        nextCursor = {
          createdAt: last.timestamp,
          id: last.id,
        };
      }
    }

    return {
      logs,
      ...(nextCursor ? { nextCursor } : {}),
    };
  }

  private generateBuckets(
    from: Date,
    to: Date,
    groupBy: "day" | "hour"
  ): Date[] {
    const buckets: Date[] = [];
    const current = new Date(from);

    // Align start to bucket boundary
    if (groupBy === "day") {
      current.setUTCHours(0, 0, 0, 0);
    } else {
      current.setUTCMinutes(0, 0, 0);
    }

    while (current < to) {
      if (current >= from) {
        buckets.push(new Date(current));
      }

      if (groupBy === "day") {
        current.setUTCDate(current.getUTCDate() + 1);
      } else {
        current.setUTCHours(current.getUTCHours() + 1);
      }
    }

    return buckets;
  }
}
