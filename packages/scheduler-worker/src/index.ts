// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker`
 * Purpose: Scheduler worker package exports.
 * Scope: Re-exports task factories, utilities, and types. Does not contain implementations.
 * Invariants: Zero imports from src/** (arch compliance).
 * Side-effects: none
 * Links: docs/SCHEDULER_SPEC.md
 * @public
 */

// Task factories (for testing or custom setups)
export { createExecuteScheduledRunTask } from "./tasks/execute-run";
export { createReconcileSchedulesTask } from "./tasks/reconcile";
// Utilities
export { computeNextCronTime } from "./utils/cron";
// Main entry point
export {
  type ExecuteRunDeps,
  type LoggerLike,
  type ReconcileDeps,
  type SchedulerWorkerConfig,
  startSchedulerWorker,
} from "./worker";
