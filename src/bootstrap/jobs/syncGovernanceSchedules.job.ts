// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/jobs/syncGovernanceSchedules.job`
 * Purpose: Job module that wires governance schedule sync to the application container.
 * Scope: Acquires advisory lock, resolves dependencies from container, and calls syncGovernanceSchedules. Does not contain business logic.
 * Invariants:
 *   - SINGLE_WRITER: pg_advisory_lock prevents concurrent sync runs
 *   - GRANT_VIA_PORT: Uses ensureGrant on ExecutionGrantUserPort, no raw SQL
 *   - SYSTEM_PRINCIPAL: Grant created for COGNI_SYSTEM_PRINCIPAL_USER_ID
 * Side-effects: IO (database advisory lock, Temporal RPC, grant creation)
 * Links: packages/scheduler-core/src/services/syncGovernanceSchedules.ts, docs/spec/governance-scheduling.md
 * @public
 */

import { toUserId } from "@cogni/ids";
import { syncGovernanceSchedules } from "@cogni/scheduler-core";
import { sql } from "drizzle-orm";
import { getServiceDb } from "@/adapters/server/db/drizzle.service-client";
import { getContainer } from "@/bootstrap/container";
import { getGovernanceConfig } from "@/shared/config";
import {
  COGNI_SYSTEM_BILLING_ACCOUNT_ID,
  COGNI_SYSTEM_PRINCIPAL_USER_ID,
} from "@/shared/constants/system-tenant";

const GOVERNANCE_GRANT_SCOPES = ["graph:execute:sandbox:openclaw"] as const;

/**
 * Run the governance schedules sync job.
 *
 * 1. Acquires a PostgreSQL advisory lock (single-writer)
 * 2. Resolves deps from the application container
 * 3. Calls syncGovernanceSchedules with repo-spec config
 */
export async function runGovernanceSchedulesSyncJob(): Promise<void> {
  const container = getContainer();
  const { log } = container;

  log.info({}, "Starting governance schedule sync job");

  // Advisory lock: non-blocking single-writer guard
  const serviceDb = getServiceDb();
  const lockResult = await serviceDb.execute(
    sql`SELECT pg_try_advisory_lock(hashtext('governance_sync')) AS acquired`
  );
  const acquired = (lockResult[0] as { acquired: boolean } | undefined)
    ?.acquired;
  if (!acquired) {
    log.info({}, "Governance sync already running, skipping");
    return;
  }

  try {
    const config = getGovernanceConfig();
    const systemUserId = toUserId(COGNI_SYSTEM_PRINCIPAL_USER_ID);

    const result = await syncGovernanceSchedules(config, {
      ensureGovernanceGrant: async () => {
        const grant = await container.executionGrantPort.ensureGrant({
          userId: systemUserId,
          billingAccountId: COGNI_SYSTEM_BILLING_ACCOUNT_ID,
          scopes: GOVERNANCE_GRANT_SCOPES,
        });
        return grant.id;
      },
      scheduleControl: container.scheduleControl,
      listGovernanceScheduleIds: () =>
        container.scheduleControl.listScheduleIds("governance:"),
      log,
    });

    log.info(
      {
        created: result.created.length,
        resumed: result.resumed.length,
        skipped: result.skipped.length,
        paused: result.paused.length,
      },
      "Governance schedule sync complete"
    );
  } finally {
    // Release advisory lock
    await serviceDb.execute(
      sql`SELECT pg_advisory_unlock(hashtext('governance_sync'))`
    );
  }
}
