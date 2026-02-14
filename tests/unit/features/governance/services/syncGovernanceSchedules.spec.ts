// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/features/governance/services/syncGovernanceSchedules`
 * Purpose: Unit tests for governance schedule sync logic.
 * Scope: Tests sync function with mocked ScheduleControlPort; verifies create/resume/skip/prune behavior. Does not test Temporal integration or DB operations.
 * Invariants: Prune pauses (never deletes); conflict = skip or resume; idempotent on repeat.
 * Side-effects: none (all deps mocked)
 * Links: src/features/governance/services/syncGovernanceSchedules.ts
 * @public
 */

import {
  ScheduleControlConflictError,
  ScheduleControlNotFoundError,
  type ScheduleDescription,
} from "@cogni/scheduler-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type GovernanceScheduleSyncDeps,
  governanceScheduleId,
  syncGovernanceSchedules,
} from "@/features/governance/services/syncGovernanceSchedules";
import type { GovernanceConfig } from "@/shared/config";

const GRANT_ID = "test-grant-id-001";

function makeMockDeps(
  overrides?: Partial<GovernanceScheduleSyncDeps>
): GovernanceScheduleSyncDeps {
  return {
    ensureGovernanceGrant: vi.fn().mockResolvedValue(GRANT_ID),
    scheduleControl: {
      createSchedule: vi.fn().mockResolvedValue(undefined),
      pauseSchedule: vi.fn().mockResolvedValue(undefined),
      resumeSchedule: vi.fn().mockResolvedValue(undefined),
      deleteSchedule: vi.fn().mockResolvedValue(undefined),
      describeSchedule: vi.fn().mockResolvedValue(null),
      listScheduleIds: vi.fn().mockResolvedValue([]),
    },
    listGovernanceScheduleIds: vi.fn().mockResolvedValue([]),
    log: { info: vi.fn(), warn: vi.fn() },
    ...overrides,
  };
}

function makeConfig(
  charters: Array<{
    charter: string;
    cron: string;
    entrypoint: string;
    timezone?: string;
  }>
): GovernanceConfig {
  return {
    schedules: charters.map((c) => ({
      charter: c.charter,
      cron: c.cron,
      timezone: c.timezone ?? "UTC",
      entrypoint: c.entrypoint,
    })),
  };
}

describe("syncGovernanceSchedules", () => {
  let deps: GovernanceScheduleSyncDeps;

  beforeEach(() => {
    deps = makeMockDeps();
  });

  it("creates schedules for each charter in config", async () => {
    const config = makeConfig([
      { charter: "COMMUNITY", cron: "0 */6 * * *", entrypoint: "COMMUNITY" },
      { charter: "GOVERN", cron: "0 * * * *", entrypoint: "GOVERN" },
    ]);

    const result = await syncGovernanceSchedules(config, deps);

    expect(result.created).toEqual([
      "governance:community",
      "governance:govern",
    ]);
    expect(deps.scheduleControl.createSchedule).toHaveBeenCalledTimes(2);
    expect(deps.scheduleControl.createSchedule).toHaveBeenCalledWith({
      scheduleId: "governance:community",
      cron: "0 */6 * * *",
      timezone: "UTC",
      graphId: "sandbox:openclaw",
      executionGrantId: GRANT_ID,
      input: { message: "COMMUNITY" },
      overlapPolicy: "skip",
      catchupWindowMs: 0,
    });
  });

  it("ensures governance grant before creating schedules", async () => {
    const config = makeConfig([
      { charter: "COMMUNITY", cron: "0 */6 * * *", entrypoint: "COMMUNITY" },
    ]);

    await syncGovernanceSchedules(config, deps);

    expect(deps.ensureGovernanceGrant).toHaveBeenCalledOnce();
  });

  it("skips creation when schedule already exists and is running", async () => {
    const runningDesc: ScheduleDescription = {
      scheduleId: "governance:community",
      nextRunAtIso: "2026-02-15T06:00:00Z",
      lastRunAtIso: null,
      isPaused: false,
    };

    deps.scheduleControl.createSchedule = vi
      .fn()
      .mockRejectedValue(
        new ScheduleControlConflictError("governance:community")
      );
    deps.scheduleControl.describeSchedule = vi
      .fn()
      .mockResolvedValue(runningDesc);

    const config = makeConfig([
      { charter: "COMMUNITY", cron: "0 */6 * * *", entrypoint: "COMMUNITY" },
    ]);

    const result = await syncGovernanceSchedules(config, deps);

    expect(result.skipped).toEqual(["governance:community"]);
    expect(result.created).toEqual([]);
    expect(deps.scheduleControl.resumeSchedule).not.toHaveBeenCalled();
  });

  it("resumes schedule when it exists but is paused", async () => {
    const pausedDesc: ScheduleDescription = {
      scheduleId: "governance:community",
      nextRunAtIso: null,
      lastRunAtIso: null,
      isPaused: true,
    };

    deps.scheduleControl.createSchedule = vi
      .fn()
      .mockRejectedValue(
        new ScheduleControlConflictError("governance:community")
      );
    deps.scheduleControl.describeSchedule = vi
      .fn()
      .mockResolvedValue(pausedDesc);

    const config = makeConfig([
      { charter: "COMMUNITY", cron: "0 */6 * * *", entrypoint: "COMMUNITY" },
    ]);

    const result = await syncGovernanceSchedules(config, deps);

    expect(result.resumed).toEqual(["governance:community"]);
    expect(deps.scheduleControl.resumeSchedule).toHaveBeenCalledWith(
      "governance:community"
    );
  });

  it("pauses stale governance schedules not in config", async () => {
    deps = makeMockDeps({
      listGovernanceScheduleIds: vi
        .fn()
        .mockResolvedValue(["governance:community", "governance:old-charter"]),
    });

    const config = makeConfig([
      { charter: "COMMUNITY", cron: "0 */6 * * *", entrypoint: "COMMUNITY" },
    ]);

    const result = await syncGovernanceSchedules(config, deps);

    expect(result.paused).toEqual(["governance:old-charter"]);
    expect(deps.scheduleControl.pauseSchedule).toHaveBeenCalledWith(
      "governance:old-charter"
    );
  });

  it("handles externally deleted schedules during prune gracefully", async () => {
    deps = makeMockDeps({
      listGovernanceScheduleIds: vi
        .fn()
        .mockResolvedValue(["governance:deleted-charter"]),
    });
    deps.scheduleControl.pauseSchedule = vi
      .fn()
      .mockRejectedValue(
        new ScheduleControlNotFoundError("governance:deleted-charter")
      );

    const config = makeConfig([]);

    const result = await syncGovernanceSchedules(config, deps);

    // Should not throw, and should not list as paused
    expect(result.paused).toEqual([]);
  });

  it("is idempotent: no-op on repeat call with same config", async () => {
    // First call: all schedules created
    const config = makeConfig([
      { charter: "COMMUNITY", cron: "0 */6 * * *", entrypoint: "COMMUNITY" },
    ]);

    const result1 = await syncGovernanceSchedules(config, deps);
    expect(result1.created).toEqual(["governance:community"]);

    // Second call: schedule exists now
    deps.scheduleControl.createSchedule = vi
      .fn()
      .mockRejectedValue(
        new ScheduleControlConflictError("governance:community")
      );
    deps.scheduleControl.describeSchedule = vi.fn().mockResolvedValue({
      scheduleId: "governance:community",
      nextRunAtIso: "2026-02-15T06:00:00Z",
      lastRunAtIso: null,
      isPaused: false,
    } satisfies ScheduleDescription);

    const result2 = await syncGovernanceSchedules(config, deps);
    expect(result2.skipped).toEqual(["governance:community"]);
    expect(result2.created).toEqual([]);
  });

  it("returns empty result for config with no schedules", async () => {
    const config = makeConfig([]);

    const result = await syncGovernanceSchedules(config, deps);

    expect(result.created).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.resumed).toEqual([]);
    expect(result.paused).toEqual([]);
  });
});

describe("governanceScheduleId", () => {
  it("lowercases charter name", () => {
    expect(governanceScheduleId("COMMUNITY")).toBe("governance:community");
    expect(governanceScheduleId("ENGINEERING")).toBe("governance:engineering");
    expect(governanceScheduleId("GOVERN")).toBe("governance:govern");
  });
});
