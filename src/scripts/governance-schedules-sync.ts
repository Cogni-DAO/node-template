// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@scripts/governance-schedules-sync`
 * Purpose: CLI entry point for governance schedule sync. Zero logic — delegates to job module.
 * Scope: Process lifecycle (exit codes) only. Does not contain business logic or wiring.
 * Invariants: CLI = zero wiring, zero logic.
 * Side-effects: IO
 * Links: src/bootstrap/jobs/syncGovernanceSchedules.job.ts
 * @public
 */

import { runGovernanceSchedulesSyncJob } from "@/bootstrap/jobs/syncGovernanceSchedules.job";

runGovernanceSchedulesSyncJob()
  .then(() => process.exit(0))
  .catch(() => {
    process.exit(1);
  });
