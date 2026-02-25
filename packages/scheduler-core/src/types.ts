// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-core/types`
 * Purpose: Shared scheduling type definitions and constants (logic-free).
 * Scope: Defines ExecutionGrant, ScheduleSpec, ScheduleRun types and status enums. Does not contain logic.
 * Invariants:
 * - ONLY exports: enums (as const arrays), literal union types, and interfaces
 * - FORBIDDEN: functions, computations, validation logic, or business rules
 * - Grant scopes constrain which graphIds can be executed (GRANT_SCOPES_CONSTRAIN_GRAPHS)
 * Side-effects: none (constants and types only)
 * Links: docs/spec/scheduler.md
 * @public
 */

// Import from db-schema (source of truth for DB enums)
import {
  SCHEDULE_RUN_STATUSES as _SCHEDULE_RUN_STATUSES,
  type ScheduleRunStatus as _ScheduleRunStatus,
} from "@cogni/db-schema/scheduling";

// Re-export
export const SCHEDULE_RUN_STATUSES = _SCHEDULE_RUN_STATUSES;
export type ScheduleRunStatus = _ScheduleRunStatus;

/**
 * Grant scope action types.
 * P0: Only graph:execute is supported.
 */
export const GRANT_SCOPE_ACTIONS = ["graph:execute"] as const;

export type GrantScopeAction = (typeof GRANT_SCOPE_ACTIONS)[number];

/**
 * Execution grant - durable authorization for scheduled graph execution.
 * Per GRANT_NOT_SESSION: Scheduled runs authenticate via grants, not user sessions.
 * Note: virtualKeyId is resolved at runtime via AccountService (not stored in grant).
 */
export interface ExecutionGrant {
  readonly billingAccountId: string;
  readonly createdAt: Date;
  readonly expiresAt: Date | null;
  readonly id: string;
  readonly revokedAt: Date | null;
  /** Scopes in format "graph:execute:{graphId}" or "graph:execute:*" for wildcard */
  readonly scopes: readonly string[];
  readonly userId: string;
}

/**
 * Schedule specification - defines a recurring graph execution.
 */
export interface ScheduleSpec {
  readonly createdAt: Date;
  readonly cron: string;
  readonly enabled: boolean;
  readonly executionGrantId: string;
  readonly graphId: string;
  readonly id: string;
  readonly input: unknown;
  readonly lastRunAt: Date | null;
  readonly nextRunAt: Date | null;
  readonly ownerUserId: string;
  readonly timezone: string;
  readonly updatedAt: Date;
}

/**
 * Schedule run record - execution ledger entry for auditability.
 * Per P0 feedback: Minimal execution persistence for governance and debugging.
 */
export interface ScheduleRun {
  readonly attemptCount: number;
  readonly completedAt: Date | null;
  readonly errorMessage: string | null;
  readonly id: string;
  readonly langfuseTraceId: string | null;
  readonly runId: string;
  readonly scheduledFor: Date;
  readonly scheduleId: string;
  readonly startedAt: Date | null;
  readonly status: ScheduleRunStatus;
}
