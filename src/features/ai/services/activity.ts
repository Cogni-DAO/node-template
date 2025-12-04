// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/ai/services/activity`
 * Purpose: Feature service for fetching activity data.
 * Scope: Orchestrates UsageService. Validates inputs.
 * Invariants:
 * - Enforces max time range.
 * - Scopes data to billingAccountId.
 * @public
 */

import type { UsageLogsResult, UsageService, UsageStatsResult } from "@/ports";

export class ActivityService {
  constructor(private readonly usageService: UsageService) {}

  async getActivitySummary(params: {
    billingAccountId: string;
    from: Date;
    to: Date;
    groupBy: "day" | "hour";
  }): Promise<UsageStatsResult> {
    const { billingAccountId, from, to, groupBy } = params;

    // Validate range
    const diffMs = to.getTime() - from.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (groupBy === "day" && diffDays > 90) {
      throw new Error("Date range too large for daily grouping (max 90 days)");
    }
    if (groupBy === "hour" && diffDays > 7) {
      throw new Error("Date range too large for hourly grouping (max 7 days)");
    }

    return this.usageService.getUsageStats({
      billingAccountId,
      from,
      to,
      groupBy,
    });
  }

  async getRecentActivity(params: {
    billingAccountId: string;
    limit: number;
    cursor?: string; // Opaque string from API/Contract
  }): Promise<UsageLogsResult> {
    const { billingAccountId, limit, cursor } = params;

    let decodedCursor: { createdAt: Date; id: string } | undefined;

    if (cursor) {
      try {
        const json = Buffer.from(cursor, "base64").toString("utf-8");
        const parsed = JSON.parse(json);
        if (parsed.createdAt && parsed.id) {
          decodedCursor = {
            createdAt: new Date(parsed.createdAt),
            id: parsed.id,
          };
        }
      } catch {
        // Invalid cursor, ignore or throw?
        // Ignoring allows "resetting" to first page if cursor is bad
        // But stricter API might want to throw.
        // For now, let's throw to be explicit.
        throw new Error("Invalid cursor format");
      }
    }

    return this.usageService.listUsageLogs({
      billingAccountId,
      limit,
      ...(decodedCursor ? { cursor: decodedCursor } : {}),
    });
  }
}
