// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker-service/ports`
 * Purpose: Port barrel — canonical import surface for all port interfaces used by this service.
 * Scope: Re-exports only. No implementations, no runtime objects.
 * Invariants: Named exports only, no concrete adapter types
 * Side-effects: none
 * Links: Consumed by activities/, workflows/, and bootstrap/
 * @public
 */

// Scheduling ports from @cogni/scheduler-core
export type {
  ExecutionGrantWorkerPort,
  ScheduleRunRepository,
} from "@cogni/scheduler-core";
