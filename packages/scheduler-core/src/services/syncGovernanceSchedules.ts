// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-core/services/syncGovernanceSchedules`
 * Purpose: Sync governance schedules from config to Temporal. Pure orchestration — depends only on ports and types.
 * Scope: Creates/resumes Temporal schedules for each charter in governance config; pauses schedules removed from config. Does not manage tenant-facing schedule CRUD or workflow execution.
 * Invariants:
 *   - OVERLAP_SKIP_DEFAULT: All governance schedules use overlap=SKIP (enforced by ScheduleControlPort)
 *   - CATCHUP_WINDOW_ZERO: No backfill (enforced by ScheduleControlPort)
 *   - PRUNE_IS_PAUSE: Removed schedules are paused, never deleted (reversible)
 *   - SYSTEM_OPS_ONLY: This function runs at deploy time, never exposed as an API endpoint
 *   - PURE_ORCHESTRATION: No adapters, no DB, no Temporal client — only ports/types
 * Side-effects: IO (Temporal RPC via ScheduleControlPort, grant creation via ensureGovernanceGrant)
 * Links: docs/spec/scheduler.md, docs/spec/governance-council.md, .cogni/repo-spec.yaml
 * @public
 */

import {
  isScheduleControlConflictError,
  isScheduleControlNotFoundError,
  type ScheduleControlPort,
} from "../ports/schedule-control.port";

/** Graph ID for OpenClaw sandbox execution */
const GOVERNANCE_GRAPH_ID = "sandbox:openclaw";

/** Minimal governance schedule shape (no @/ imports — pure type) */
export interface GovernanceScheduleEntry {
  charter: string;
  cron: string;
  timezone: string;
  entrypoint: string;
}

/** Minimal governance config shape (no @/ imports — pure type) */
export interface GovernanceScheduleConfig {
  schedules: GovernanceScheduleEntry[];
}

/** Logger interface matching pino shape */
interface SyncLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

/** Injectable dependencies for governance schedule sync */
export interface GovernanceScheduleSyncDeps {
  /** Idempotent: ensures governance grant exists, returns grantId */
  ensureGovernanceGrant(): Promise<string>;
  /** Temporal schedule lifecycle control */
  scheduleControl: ScheduleControlPort;
  /** Returns all Temporal schedule IDs with 'governance:' prefix */
  listGovernanceScheduleIds(): Promise<string[]>;
  /** Structured logger */
  log: SyncLogger;
}

/** Result of a governance schedule sync operation */
export interface GovernanceScheduleSyncResult {
  created: string[];
  resumed: string[];
  skipped: string[];
  paused: string[];
}

/**
 * Derives the Temporal schedule ID from a charter name.
 * Format: `governance:{charter_lowercase}`
 */
export function governanceScheduleId(charter: string): string {
  return `governance:${charter.toLowerCase()}`;
}

/**
 * Syncs governance schedules from repo-spec config to Temporal.
 *
 * For each schedule in config:
 * - If missing in Temporal: create
 * - If exists but paused: resume
 * - If exists and running: skip (no-op)
 *
 * For governance schedules in Temporal but not in config:
 * - Pause (don't delete — reversible)
 *
 * @param config - Governance config from repo-spec
 * @param deps - Injectable dependencies
 * @returns Summary of actions taken
 */
export async function syncGovernanceSchedules(
  config: GovernanceScheduleConfig,
  deps: GovernanceScheduleSyncDeps
): Promise<GovernanceScheduleSyncResult> {
  const { scheduleControl, log } = deps;

  // 1. Ensure governance grant exists for cogni_system
  const grantId = await deps.ensureGovernanceGrant();
  log.info({ grantId }, "Governance grant ready");

  // 2. Create or resume schedules from config
  const result: GovernanceScheduleSyncResult = {
    created: [],
    resumed: [],
    skipped: [],
    paused: [],
  };

  const configScheduleIds = new Set<string>();

  for (const schedule of config.schedules) {
    const scheduleId = governanceScheduleId(schedule.charter);
    configScheduleIds.add(scheduleId);

    try {
      await scheduleControl.createSchedule({
        scheduleId,
        dbScheduleId: null,
        cron: schedule.cron,
        timezone: schedule.timezone,
        graphId: GOVERNANCE_GRAPH_ID,
        executionGrantId: grantId,
        // TODO(task.0068): Use default_flash from LiteLLM config metadata instead of hardcoded model
        input: { message: schedule.entrypoint, model: "gpt-4o-mini" },
        // Governance-specific safety: no overlap, no backfill
        overlapPolicy: "skip",
        catchupWindowMs: 0,
      });
      result.created.push(scheduleId);
      log.info(
        { scheduleId, cron: schedule.cron },
        "Created governance schedule"
      );
    } catch (error) {
      if (isScheduleControlConflictError(error)) {
        // Schedule already exists — check if paused and resume if needed
        const desc = await scheduleControl.describeSchedule(scheduleId);
        if (desc?.isPaused) {
          await scheduleControl.resumeSchedule(scheduleId);
          result.resumed.push(scheduleId);
          log.info({ scheduleId }, "Resumed governance schedule");
        } else {
          result.skipped.push(scheduleId);
          log.info({ scheduleId }, "Governance schedule exists, skipping");
        }
      } else {
        throw error;
      }
    }
  }

  // 3. Prune: pause governance schedules not in current config
  const allGovernanceIds = await deps.listGovernanceScheduleIds();
  for (const existingId of allGovernanceIds) {
    if (!configScheduleIds.has(existingId)) {
      try {
        await scheduleControl.pauseSchedule(existingId);
        result.paused.push(existingId);
        log.warn(
          { scheduleId: existingId },
          "Paused governance schedule (removed from repo-spec)"
        );
      } catch (error) {
        if (isScheduleControlNotFoundError(error)) {
          // Schedule was deleted externally — nothing to pause
          log.warn(
            { scheduleId: existingId },
            "Governance schedule not found in Temporal (deleted externally)"
          );
        } else {
          throw error;
        }
      }
    }
  }

  return result;
}
