// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/_fixtures/ledger/seed-ledger`
 * Purpose: Reusable ledger test fixtures for seeding epochs, activity events, and related data.
 * Scope: Factory functions for ledger test data. Does not contain test logic or assertions.
 * Invariants: All generated IDs are deterministic from inputs where possible.
 * Side-effects: none (pure data factories)
 * Links: packages/ledger-core/src/store.ts, tests/component/db/drizzle-ledger.adapter.int.test.ts
 * @internal
 */

import type {
  InsertActivityEventParams,
  InsertAllocationParams,
  InsertPoolComponentParams,
  UpsertCurationParams,
} from "@cogni/ledger-core";

/** Stable test node ID for ledger integration tests */
export const TEST_NODE_ID = "00000000-0000-4000-8000-000000000001";

/** Epoch window helpers */
export function weekWindow(weekOffset = 0): {
  periodStart: Date;
  periodEnd: Date;
} {
  const base = new Date("2026-01-05T00:00:00Z"); // Monday
  const start = new Date(base);
  start.setDate(start.getDate() + weekOffset * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { periodStart: start, periodEnd: end };
}

/** Default weight config for tests */
export const TEST_WEIGHT_CONFIG: Record<string, number> = {
  "github:pr_merged": 8000,
  "github:review_submitted": 2000,
  "discord:message_sent": 500,
};

/** Build an activity event insert param with sensible defaults */
export function makeActivityEvent(
  overrides: Partial<InsertActivityEventParams> & { id: string }
): InsertActivityEventParams {
  return {
    nodeId: TEST_NODE_ID,
    source: "github",
    eventType: "pr_merged",
    platformUserId: "12345",
    producer: "test-adapter",
    eventTime: new Date("2026-01-06T12:00:00Z"),
    ...overrides,
  };
}

/** Build a curation upsert param with sensible defaults */
export function makeCuration(
  overrides: Partial<UpsertCurationParams> & {
    epochId: bigint;
    eventId: string;
  }
): UpsertCurationParams {
  return {
    nodeId: TEST_NODE_ID,
    included: true,
    ...overrides,
  };
}

/** Build an allocation insert param with sensible defaults */
export function makeAllocation(
  overrides: Partial<InsertAllocationParams> & {
    epochId: bigint;
    userId: string;
  }
): InsertAllocationParams {
  return {
    nodeId: TEST_NODE_ID,
    proposedUnits: 1000n,
    activityCount: 1,
    ...overrides,
  };
}

/** Build a pool component insert param with sensible defaults */
export function makePoolComponent(
  overrides: Partial<InsertPoolComponentParams> & { epochId: bigint }
): InsertPoolComponentParams {
  return {
    nodeId: TEST_NODE_ID,
    componentId: "base_issuance",
    algorithmVersion: "v1.0.0",
    inputsJson: { base_amount: 10000 },
    amountCredits: 10000n,
    ...overrides,
  };
}
