// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@ports/governance-status`
 * Purpose: Governance status query port for system tenant governance visibility.
 * Scope: Read-only queries for schedule status and recent governance runs. System tenant scope only. Does not include governance control or historical analytics.
 * Invariants:
 * - All queries implicitly filter by COGNI_SYSTEM_PRINCIPAL_USER_ID (no userId param)
 * - Recent runs ordered by most recent first
 * - Adapter must return Date objects (not ISO strings)
 * Side-effects: none (interface definition only)
 * Notes: Created for single caller (governance dashboard) but properly abstracted for future reuse.
 * Links: Implemented by DrizzleGovernanceStatusAdapter, used by getGovernanceStatus feature service
 * @public
 */

export interface GovernanceRun {
  id: string;
  title: string | null;
  startedAt: Date;
  lastActivity: Date;
}

export interface GovernanceStatusPort {
  /**
   * Get next scheduled governance run time for system tenant.
   * Returns null if no runs are scheduled.
   */
  getScheduleStatus(): Promise<Date | null>;

  /**
   * Get recent governance runs for system tenant.
   * Returns up to `limit` runs ordered by most recent first.
   */
  getRecentRuns(params: { limit: number }): Promise<GovernanceRun[]>;
}
