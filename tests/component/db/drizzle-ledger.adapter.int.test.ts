// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/component/db/drizzle-ledger.adapter.int`
 * Purpose: Component tests for DrizzleLedgerAdapter against real PostgreSQL via testcontainers.
 * Scope: Verifies adapter + DB triggers (ACTIVITY_APPEND_ONLY, CURATION_FREEZE_ON_FINALIZE, ONE_OPEN_EPOCH, ACTIVITY_IDEMPOTENT). Does not test domain logic or routes.
 * Invariants: ACTIVITY_APPEND_ONLY, ACTIVITY_IDEMPOTENT, CURATION_FREEZE_ON_FINALIZE, ONE_OPEN_EPOCH, SCOPE_GATED_QUERIES
 * Side-effects: IO (database operations via testcontainers)
 * Links: packages/db-client/src/adapters/drizzle-ledger.adapter.ts, packages/ledger-core/src/store.ts
 * @public
 */

import { DrizzleLedgerAdapter } from "@cogni/db-client";
import {
  AllocationNotFoundError,
  EpochNotFoundError,
  EpochNotOpenError,
} from "@cogni/ledger-core";
import { getSeedDb } from "@tests/_fixtures/db/seed-client";
import {
  epochWindow,
  makeActivityEvent,
  makeAllocation,
  makeCuration,
  makePoolComponent,
  TEST_NODE_ID,
  TEST_SCOPE_ID,
  TEST_WEIGHT_CONFIG,
} from "@tests/_fixtures/ledger/seed-ledger";
import { seedTestActor, type TestActor } from "@tests/_fixtures/stack/seed";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** Unwrap DrizzleQueryError → underlying PostgresError message */
function drizzleCause(err: unknown): string {
  if (err instanceof Error && err.cause instanceof Error)
    return err.cause.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

describe("DrizzleLedgerAdapter (Component)", () => {
  const db = getSeedDb();
  const adapter = new DrizzleLedgerAdapter(db, TEST_SCOPE_ID);

  let actor: TestActor;

  beforeAll(async () => {
    actor = await seedTestActor(db);
  });

  // No global afterAll cleanup needed — testcontainers PostgreSQL is ephemeral.

  // ── Epochs ────────────────────────────────────────────────────

  describe("epochs", () => {
    let createdEpochId: bigint;

    afterAll(async () => {
      // Ensure no open epoch leaks to subsequent describes
      const open = await adapter.getOpenEpoch(TEST_NODE_ID, TEST_SCOPE_ID);
      if (open) {
        await adapter.closeIngestion(
          open.id,
          "cleanup-hash",
          "weight-sum-v0",
          "cleanup-wch"
        );
        await adapter.finalizeEpoch(open.id, 0n);
      }
    });

    it("creates an epoch and retrieves it", async () => {
      const window = epochWindow(0);
      const epoch = await adapter.createEpoch({
        nodeId: TEST_NODE_ID,
        scopeId: TEST_SCOPE_ID,
        ...window,
        weightConfig: TEST_WEIGHT_CONFIG,
      });
      createdEpochId = epoch.id;

      expect(epoch.status).toBe("open");
      expect(epoch.nodeId).toBe(TEST_NODE_ID);
      expect(epoch.poolTotalCredits).toBeNull();
      expect(epoch.closedAt).toBeNull();

      const fetched = await adapter.getEpoch(epoch.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.id).toBe(epoch.id);
    });

    it("getOpenEpoch returns the open epoch for the node", async () => {
      const open = await adapter.getOpenEpoch(TEST_NODE_ID, TEST_SCOPE_ID);
      expect(open).not.toBeNull();
      expect(open?.status).toBe("open");
    });

    it("listEpochs returns all epochs for the node", async () => {
      const list = await adapter.listEpochs(TEST_NODE_ID);
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list.every((e) => e.nodeId === TEST_NODE_ID)).toBe(true);
    });

    it("ONE_OPEN_EPOCH: rejects second open epoch for same node", async () => {
      await expect(
        adapter.createEpoch({
          nodeId: TEST_NODE_ID,
          scopeId: TEST_SCOPE_ID,
          ...epochWindow(1),
          weightConfig: TEST_WEIGHT_CONFIG,
        })
      ).rejects.toThrow();
    });

    it("EPOCH_WINDOW_UNIQUE: rejects duplicate window for same node", async () => {
      // Finalize the open epoch so we can test the window constraint in isolation
      await adapter.closeIngestion(
        createdEpochId,
        "test-hash",
        "weight-sum-v0",
        "test-wch"
      );
      await adapter.finalizeEpoch(createdEpochId, 10000n);

      await expect(
        adapter.createEpoch({
          nodeId: TEST_NODE_ID,
          scopeId: TEST_SCOPE_ID,
          ...epochWindow(0), // same window as the closed epoch
          weightConfig: TEST_WEIGHT_CONFIG,
        })
      ).rejects.toThrow();
    });

    it("closeIngestion transitions open → review with approverSetHash", async () => {
      const epoch = await adapter.createEpoch({
        nodeId: TEST_NODE_ID,
        scopeId: TEST_SCOPE_ID,
        ...epochWindow(2),
        weightConfig: TEST_WEIGHT_CONFIG,
      });

      const reviewed = await adapter.closeIngestion(
        epoch.id,
        "abc123hash",
        "weight-sum-v0",
        "test-wch"
      );
      expect(reviewed.status).toBe("review");
      expect(reviewed.approverSetHash).toBe("abc123hash");
    });

    it("finalizeEpoch transitions review → finalized with poolTotal and closedAt", async () => {
      // Find the review epoch we just created
      const list = await adapter.listEpochs(TEST_NODE_ID);
      const review = list.find(
        (e) => e.status === "review" && e.approverSetHash === "abc123hash"
      );
      expect(review).toBeDefined();
      if (!review) throw new Error("Expected review epoch");

      const finalized = await adapter.finalizeEpoch(review.id, 50000n);
      expect(finalized.status).toBe("finalized");
      expect(finalized.poolTotalCredits).toBe(50000n);
      expect(finalized.closedAt).not.toBeNull();
    });

    it("finalizeEpoch on already-finalized epoch returns it (EPOCH_FINALIZE_IDEMPOTENT)", async () => {
      const list = await adapter.listEpochs(TEST_NODE_ID);
      const finalized = list.find(
        (e) => e.status === "finalized" && e.poolTotalCredits === 50000n
      );
      expect(finalized).toBeDefined();

      if (!finalized) throw new Error("Expected finalized epoch");
      const result = await adapter.finalizeEpoch(finalized.id, 99999n);
      expect(result.status).toBe("finalized");
      expect(result.poolTotalCredits).toBe(50000n); // unchanged
    });

    it("finalizeEpoch on non-existent epoch throws EpochNotFoundError", async () => {
      await expect(adapter.finalizeEpoch(999999n, 100n)).rejects.toThrow(
        EpochNotFoundError
      );
    });

    it("finalizeEpoch on open epoch throws EpochNotOpenError (must review first)", async () => {
      const epoch = await adapter.createEpoch({
        nodeId: TEST_NODE_ID,
        scopeId: TEST_SCOPE_ID,
        ...epochWindow(8),
        weightConfig: TEST_WEIGHT_CONFIG,
      });

      await expect(adapter.finalizeEpoch(epoch.id, 100n)).rejects.toThrow(
        EpochNotOpenError
      );

      // Cleanup: transition to finalized so ONE_OPEN_EPOCH doesn't block later tests
      await adapter.closeIngestion(
        epoch.id,
        "cleanup-hash",
        "weight-sum-v0",
        "cleanup-wch"
      );
      await adapter.finalizeEpoch(epoch.id, 0n);
    });

    it("closeIngestion on finalized epoch returns it idempotently", async () => {
      const list = await adapter.listEpochs(TEST_NODE_ID);
      const finalized = list.find((e) => e.status === "finalized");
      expect(finalized).toBeDefined();
      if (!finalized) throw new Error("Expected finalized epoch");

      const result = await adapter.closeIngestion(
        finalized.id,
        "should-be-ignored",
        "weight-sum-v0",
        "ignored-wch"
      );
      expect(result.status).toBe("finalized");
      // approverSetHash unchanged — not overwritten
      expect(result.approverSetHash).not.toBe("should-be-ignored");
    });
  });

  // ── Activity Events ───────────────────────────────────────────

  describe("activity events", () => {
    it("inserts events and retrieves by time window", async () => {
      const events = [
        makeActivityEvent({
          id: "github:pr:test/repo:1",
          eventTime: new Date("2026-01-06T10:00:00Z"),
          platformUserId: "111",
        }),
        makeActivityEvent({
          id: "github:pr:test/repo:2",
          eventTime: new Date("2026-01-07T10:00:00Z"),
          platformUserId: "222",
        }),
      ];

      await adapter.insertActivityEvents(events);

      const results = await adapter.getActivityForWindow(
        TEST_NODE_ID,
        new Date("2026-01-06T00:00:00Z"),
        new Date("2026-01-08T00:00:00Z")
      );

      expect(results.length).toBeGreaterThanOrEqual(2);
      const ids = results.map((e) => e.id);
      expect(ids).toContain("github:pr:test/repo:1");
      expect(ids).toContain("github:pr:test/repo:2");
    });

    it("ACTIVITY_IDEMPOTENT: re-inserting same event is a no-op", async () => {
      const event = makeActivityEvent({
        id: "github:pr:test/repo:1",
        platformUserId: "111",
      });

      await adapter.insertActivityEvents([event]);

      const results = await adapter.getActivityForWindow(
        TEST_NODE_ID,
        new Date("2026-01-06T00:00:00Z"),
        new Date("2026-01-08T00:00:00Z")
      );
      const matching = results.filter((e) => e.id === "github:pr:test/repo:1");
      expect(matching).toHaveLength(1);
    });

    it("ACTIVITY_APPEND_ONLY: UPDATE on activity_events is rejected by trigger", async () => {
      await expect(
        db.execute(
          sql`UPDATE activity_events SET source = 'modified' WHERE id = 'github:pr:test/repo:1' AND node_id = ${TEST_NODE_ID}::uuid`
        )
      ).rejects.toSatisfy((err: unknown) =>
        /not allowed/i.test(drizzleCause(err))
      );
    });

    it("ACTIVITY_APPEND_ONLY: DELETE on activity_events is rejected by trigger", async () => {
      await expect(
        db.execute(
          sql`DELETE FROM activity_events WHERE id = 'github:pr:test/repo:1' AND node_id = ${TEST_NODE_ID}::uuid`
        )
      ).rejects.toSatisfy((err: unknown) =>
        /not allowed/i.test(drizzleCause(err))
      );
    });
  });

  // ── Curation ──────────────────────────────────────────────────

  describe("curation", () => {
    let epochId: bigint;

    beforeAll(async () => {
      const epoch = await adapter.createEpoch({
        nodeId: TEST_NODE_ID,
        scopeId: TEST_SCOPE_ID,
        ...epochWindow(3),
        weightConfig: TEST_WEIGHT_CONFIG,
      });
      epochId = epoch.id;
    });

    // Freeze test finalizes the epoch; afterAll is a safety net
    afterAll(async () => {
      const open = await adapter.getOpenEpoch(TEST_NODE_ID, TEST_SCOPE_ID);
      if (open) {
        await adapter.closeIngestion(
          open.id,
          "cleanup-hash",
          "weight-sum-v0",
          "cleanup-wch"
        );
        await adapter.finalizeEpoch(open.id, 0n);
      }
    });

    it("upserts curation entries and retrieves them", async () => {
      await adapter.upsertCuration([
        makeCuration({
          epochId,
          eventId: "github:pr:test/repo:1",
          userId: actor.user.id,
        }),
        makeCuration({
          epochId,
          eventId: "github:pr:test/repo:2",
          userId: null,
        }),
      ]);

      const all = await adapter.getCurationForEpoch(epochId);
      expect(all).toHaveLength(2);
    });

    it("getUnresolvedCuration returns only entries with null userId", async () => {
      const unresolved = await adapter.getUnresolvedCuration(epochId);
      expect(unresolved).toHaveLength(1);
      expect(unresolved[0]?.eventId).toBe("github:pr:test/repo:2");
    });

    it("upsert updates existing curation (same epoch+event)", async () => {
      await adapter.upsertCuration([
        makeCuration({
          epochId,
          eventId: "github:pr:test/repo:2",
          userId: actor.user.id,
        }),
      ]);

      const unresolved = await adapter.getUnresolvedCuration(epochId);
      expect(unresolved).toHaveLength(0);
    });

    it("CURATION_FREEZE_ON_FINALIZE: curation is mutable during review", async () => {
      await adapter.closeIngestion(
        epochId,
        "review-curation-test",
        "weight-sum-v0",
        "review-wch"
      );

      // Curation writes should succeed while epoch is in review
      await expect(
        adapter.upsertCuration([
          makeCuration({
            epochId,
            eventId: "github:pr:test/repo:1",
            userId: actor.user.id,
            note: "updated during review",
          }),
        ])
      ).resolves.not.toThrow();
    });

    it("CURATION_FREEZE_ON_FINALIZE: rejects curation writes after epoch finalize", async () => {
      // Epoch is already in review from the previous test
      await adapter.finalizeEpoch(epochId, 5000n);

      await expect(
        adapter.upsertCuration([
          makeCuration({
            epochId,
            eventId: "github:pr:test/repo:1",
            userId: null,
            note: "should fail",
          }),
        ])
      ).rejects.toSatisfy((err: unknown) =>
        /finalized/i.test(drizzleCause(err))
      );
    });
  });

  // ── getCuratedEventsForAllocation ─────────────────────────────

  describe("getCuratedEventsForAllocation", () => {
    let epochId: bigint;
    let resolvedActor: TestActor;

    beforeAll(async () => {
      resolvedActor = await seedTestActor(db);

      const epoch = await adapter.createEpoch({
        nodeId: TEST_NODE_ID,
        scopeId: TEST_SCOPE_ID,
        ...epochWindow(31),
        weightConfig: TEST_WEIGHT_CONFIG,
      });
      epochId = epoch.id;

      // Insert activity events within epoch window
      const eventTime = new Date("2026-08-20T12:00:00Z");
      await adapter.insertActivityEvents([
        makeActivityEvent({
          id: "join-test:resolved",
          eventTime,
          platformUserId: "gh-resolved",
          source: "github",
          eventType: "pr_merged",
        }),
        makeActivityEvent({
          id: "join-test:unresolved",
          eventTime,
          platformUserId: "gh-unresolved",
          source: "github",
          eventType: "review_submitted",
        }),
        makeActivityEvent({
          id: "join-test:excluded",
          eventTime,
          platformUserId: "gh-excluded",
          source: "github",
          eventType: "pr_merged",
        }),
      ]);

      // Curate: one resolved, one unresolved (null userId), one excluded
      await adapter.upsertCuration([
        makeCuration({
          epochId,
          eventId: "join-test:resolved",
          userId: resolvedActor.user.id,
          included: true,
        }),
        makeCuration({
          epochId,
          eventId: "join-test:unresolved",
          userId: null,
          included: true,
        }),
        makeCuration({
          epochId,
          eventId: "join-test:excluded",
          userId: resolvedActor.user.id,
          included: false,
        }),
      ]);
    });

    afterAll(async () => {
      await adapter.closeIngestion(
        epochId,
        "cleanup-hash",
        "weight-sum-v0",
        "cleanup-wch"
      );
      await adapter.finalizeEpoch(epochId, 0n);
    });

    it("returns only curations with non-null userId", async () => {
      const events = await adapter.getCuratedEventsForAllocation(epochId);

      // "resolved" has userId set → included
      // "unresolved" has userId=null → excluded by join filter
      // "excluded" has userId set but included=false → still returned (filtering is domain logic)
      const eventIds = events.map((e) => e.eventId);
      expect(eventIds).toContain("join-test:resolved");
      expect(eventIds).toContain("join-test:excluded");
      expect(eventIds).not.toContain("join-test:unresolved");
    });

    it("join populates source and eventType from activity_events", async () => {
      const events = await adapter.getCuratedEventsForAllocation(epochId);
      const resolved = events.find((e) => e.eventId === "join-test:resolved");

      expect(resolved).toBeDefined();
      expect(resolved?.source).toBe("github");
      expect(resolved?.eventType).toBe("pr_merged");
      expect(resolved?.userId).toBe(resolvedActor.user.id);
    });
  });

  // ── Allocations ───────────────────────────────────────────────

  describe("allocations", () => {
    let epochId: bigint;

    beforeAll(async () => {
      const epoch = await adapter.createEpoch({
        nodeId: TEST_NODE_ID,
        scopeId: TEST_SCOPE_ID,
        ...epochWindow(4),
        weightConfig: TEST_WEIGHT_CONFIG,
      });
      epochId = epoch.id;
    });

    afterAll(async () => {
      await adapter.closeIngestion(
        epochId,
        "cleanup-hash",
        "weight-sum-v0",
        "cleanup-wch"
      );
      await adapter.finalizeEpoch(epochId, 0n);
    });

    it("inserts allocations and retrieves them", async () => {
      await adapter.insertAllocations([
        makeAllocation({
          epochId,
          userId: actor.user.id,
          proposedUnits: 8000n,
          activityCount: 3,
        }),
      ]);

      const allocs = await adapter.getAllocationsForEpoch(epochId);
      expect(allocs).toHaveLength(1);
      expect(allocs[0]?.proposedUnits).toBe(8000n);
      expect(allocs[0]?.finalUnits).toBeNull();
    });

    it("updateAllocationFinalUnits sets final_units and override_reason", async () => {
      await adapter.updateAllocationFinalUnits(
        epochId,
        actor.user.id,
        10000n,
        "bonus for extra work"
      );

      const allocs = await adapter.getAllocationsForEpoch(epochId);
      expect(allocs[0]?.finalUnits).toBe(10000n);
      expect(allocs[0]?.overrideReason).toBe("bonus for extra work");
    });

    it("updateAllocationFinalUnits throws AllocationNotFoundError for missing allocation", async () => {
      await expect(
        adapter.updateAllocationFinalUnits(epochId, "nonexistent-user", 100n)
      ).rejects.toThrow(AllocationNotFoundError);
    });

    it("ALLOCATION_PRESERVES_OVERRIDES: upsertAllocations does not overwrite final_units", async () => {
      // actor.user already has final_units=10000n from previous test
      await adapter.upsertAllocations([
        makeAllocation({
          epochId,
          userId: actor.user.id,
          proposedUnits: 99999n,
          activityCount: 10,
        }),
      ]);

      const allocs = await adapter.getAllocationsForEpoch(epochId);
      const alloc = allocs.find((a) => a.userId === actor.user.id);
      expect(alloc).toBeDefined();
      expect(alloc?.proposedUnits).toBe(99999n); // updated
      expect(alloc?.activityCount).toBe(10); // updated
      expect(alloc?.finalUnits).toBe(10000n); // preserved
      expect(alloc?.overrideReason).toBe("bonus for extra work"); // preserved
    });

    it("deleteStaleAllocations does not remove rows with final_units set", async () => {
      // Seed two more users
      const actorB = await seedTestActor(db);
      const actorC = await seedTestActor(db);

      await adapter.insertAllocations([
        makeAllocation({
          epochId,
          userId: actorB.user.id,
          proposedUnits: 2000n,
          activityCount: 1,
        }),
        makeAllocation({
          epochId,
          userId: actorC.user.id,
          proposedUnits: 3000n,
          activityCount: 1,
        }),
      ]);

      // actorB gets an override (final_units set)
      await adapter.updateAllocationFinalUnits(
        epochId,
        actorB.user.id,
        5000n,
        "admin override"
      );

      // Delete stale: only actor.user is "active" — actorB and actorC are "stale"
      // But actorB has final_units → should be kept
      await adapter.deleteStaleAllocations(epochId, [actor.user.id]);

      const allocs = await adapter.getAllocationsForEpoch(epochId);
      const userIds = allocs.map((a) => a.userId);

      expect(userIds).toContain(actor.user.id); // active
      expect(userIds).toContain(actorB.user.id); // stale but has final_units → kept
      expect(userIds).not.toContain(actorC.user.id); // stale, no final_units → deleted
    });
  });

  // ── Cursors ───────────────────────────────────────────────────

  describe("cursors", () => {
    it("upserts and retrieves a cursor", async () => {
      await adapter.upsertCursor(
        TEST_NODE_ID,
        TEST_SCOPE_ID,
        "github",
        "pull_requests",
        "test/repo",
        "2026-01-06T00:00:00Z"
      );

      const cursor = await adapter.getCursor(
        TEST_NODE_ID,
        TEST_SCOPE_ID,
        "github",
        "pull_requests",
        "test/repo"
      );
      expect(cursor).not.toBeNull();
      expect(cursor?.cursorValue).toBe("2026-01-06T00:00:00Z");
    });

    it("upsert updates existing cursor value", async () => {
      await adapter.upsertCursor(
        TEST_NODE_ID,
        TEST_SCOPE_ID,
        "github",
        "pull_requests",
        "test/repo",
        "2026-01-07T00:00:00Z"
      );

      const cursor = await adapter.getCursor(
        TEST_NODE_ID,
        TEST_SCOPE_ID,
        "github",
        "pull_requests",
        "test/repo"
      );
      expect(cursor?.cursorValue).toBe("2026-01-07T00:00:00Z");
    });

    it("getCursor returns null for unknown cursor", async () => {
      const cursor = await adapter.getCursor(
        TEST_NODE_ID,
        TEST_SCOPE_ID,
        "github",
        "unknown_stream",
        "test/repo"
      );
      expect(cursor).toBeNull();
    });
  });

  // ── Pool Components ───────────────────────────────────────────

  describe("pool components", () => {
    let epochId: bigint;

    beforeAll(async () => {
      const epoch = await adapter.createEpoch({
        nodeId: TEST_NODE_ID,
        scopeId: TEST_SCOPE_ID,
        ...epochWindow(5),
        weightConfig: TEST_WEIGHT_CONFIG,
      });
      epochId = epoch.id;
    });

    afterAll(async () => {
      await adapter.closeIngestion(
        epochId,
        "cleanup-hash",
        "weight-sum-v0",
        "cleanup-wch"
      );
      await adapter.finalizeEpoch(epochId, 0n);
    });

    it("inserts and retrieves pool components", async () => {
      const comp = await adapter.insertPoolComponent(
        makePoolComponent({ epochId })
      );

      expect(comp.componentId).toBe("base_issuance");
      expect(comp.amountCredits).toBe(10000n);

      const all = await adapter.getPoolComponentsForEpoch(epochId);
      expect(all).toHaveLength(1);
    });

    it("POOL_UNIQUE_PER_TYPE: rejects duplicate component_id per epoch", async () => {
      await expect(
        adapter.insertPoolComponent(makePoolComponent({ epochId }))
      ).rejects.toThrow();
    });

    it("POOL_IMMUTABLE: UPDATE on pool components is rejected by trigger", async () => {
      await expect(
        db.execute(
          sql`UPDATE epoch_pool_components SET amount_credits = 99999 WHERE epoch_id = ${epochId}`
        )
      ).rejects.toSatisfy((err: unknown) =>
        /not allowed/i.test(drizzleCause(err))
      );
    });

    it("POOL_LOCKED_AT_REVIEW: insertPoolComponent rejected after closeIngestion", async () => {
      // Use a dedicated epoch to avoid interfering with afterAll cleanup
      const reviewEpoch = await adapter.createEpoch({
        nodeId: TEST_NODE_ID,
        scopeId: TEST_SCOPE_ID,
        ...epochWindow(30),
        weightConfig: TEST_WEIGHT_CONFIG,
      });
      await adapter.closeIngestion(
        reviewEpoch.id,
        "pool-lock-hash",
        "weight-sum-v0",
        "pool-lock-wch"
      );

      await expect(
        adapter.insertPoolComponent(
          makePoolComponent({ epochId: reviewEpoch.id })
        )
      ).rejects.toThrow(EpochNotOpenError);

      // Also rejected when finalized
      await adapter.finalizeEpoch(reviewEpoch.id, 0n);
      await expect(
        adapter.insertPoolComponent(
          makePoolComponent({ epochId: reviewEpoch.id })
        )
      ).rejects.toThrow(EpochNotOpenError);
    });
  });

  // ── Payout Statements ─────────────────────────────────────────

  describe("payout statements", () => {
    let epochId: bigint;

    beforeAll(async () => {
      const epoch = await adapter.createEpoch({
        nodeId: TEST_NODE_ID,
        scopeId: TEST_SCOPE_ID,
        ...epochWindow(6),
        weightConfig: TEST_WEIGHT_CONFIG,
      });
      await adapter.closeIngestion(
        epoch.id,
        "stmt-test-hash",
        "weight-sum-v0",
        "stmt-wch"
      );
      await adapter.finalizeEpoch(epoch.id, 10000n);
      epochId = epoch.id;
    });

    it("inserts and retrieves a payout statement", async () => {
      const stmt = await adapter.insertPayoutStatement({
        nodeId: TEST_NODE_ID,
        epochId,
        allocationSetHash: "abc123def456",
        poolTotalCredits: 10000n,
        payoutsJson: [
          {
            user_id: actor.user.id,
            total_units: "8000",
            share: "1.000000",
            amount_credits: "10000",
          },
        ],
      });

      expect(stmt.epochId).toBe(epochId);
      expect(stmt.poolTotalCredits).toBe(10000n);

      const fetched = await adapter.getStatementForEpoch(epochId);
      expect(fetched).not.toBeNull();
      expect(fetched?.id).toBe(stmt.id);
    });

    it("getStatementForEpoch throws EpochNotFoundError for non-existent epoch", async () => {
      await expect(adapter.getStatementForEpoch(999999n)).rejects.toThrow(
        EpochNotFoundError
      );
    });
  });

  // ── Statement Signatures ──────────────────────────────────────

  describe("statement signatures", () => {
    let statementId: string;

    beforeAll(async () => {
      // Self-contained: create epoch → close → insert statement
      const epoch = await adapter.createEpoch({
        nodeId: TEST_NODE_ID,
        scopeId: TEST_SCOPE_ID,
        ...epochWindow(7),
        weightConfig: TEST_WEIGHT_CONFIG,
      });
      await adapter.closeIngestion(
        epoch.id,
        "sig-test-hash",
        "weight-sum-v0",
        "sig-wch"
      );
      await adapter.finalizeEpoch(epoch.id, 20000n);

      const stmt = await adapter.insertPayoutStatement({
        nodeId: TEST_NODE_ID,
        epochId: epoch.id,
        allocationSetHash: "sig-test-hash",
        poolTotalCredits: 20000n,
        payoutsJson: [
          {
            user_id: "sig-test-user",
            total_units: "20000",
            share: "1.0",
            amount_credits: "20000",
          },
        ],
      });
      statementId = stmt.id;
    });

    it("inserts and retrieves a signature", async () => {
      await adapter.insertStatementSignature({
        nodeId: TEST_NODE_ID,
        statementId,
        signerWallet: "0x1234567890abcdef1234567890abcdef12345678",
        signature: "0xdeadbeef",
        signedAt: new Date(),
      });

      const sigs = await adapter.getSignaturesForStatement(statementId);
      expect(sigs).toHaveLength(1);
      expect(sigs[0]?.signerWallet).toBe(
        "0x1234567890abcdef1234567890abcdef12345678"
      );
    });

    it("insertStatementSignature duplicate is a no-op", async () => {
      // Re-insert the same signature — should not throw
      await expect(
        adapter.insertStatementSignature({
          nodeId: TEST_NODE_ID,
          statementId,
          signerWallet: "0x1234567890abcdef1234567890abcdef12345678",
          signature: "0xdeadbeef",
          signedAt: new Date(),
        })
      ).resolves.not.toThrow();

      const sigs = await adapter.getSignaturesForStatement(statementId);
      expect(sigs).toHaveLength(1);
    });
  });

  // ── finalizeEpochAtomic ──────────────────────────────────────

  describe("finalizeEpochAtomic", () => {
    const SIGNER_WALLET = "0xaaaa000000000000000000000000000000000001";
    const HASH = "atomic-test-hash-abc123";
    const PAYOUTS_JSON = [
      {
        user_id: "user-1",
        total_units: "8000",
        share: "0.800000",
        amount_credits: "8000",
      },
      {
        user_id: "user-2",
        total_units: "2000",
        share: "0.200000",
        amount_credits: "2000",
      },
    ];

    function makeAtomicParams(epochId: bigint) {
      return {
        epochId,
        poolTotal: 10000n,
        statement: {
          nodeId: TEST_NODE_ID,
          allocationSetHash: HASH,
          poolTotalCredits: 10000n,
          payoutsJson: PAYOUTS_JSON,
        },
        signature: {
          nodeId: TEST_NODE_ID,
          signerWallet: SIGNER_WALLET,
          signature: "0xsig_aaa",
          signedAt: new Date(),
        },
        expectedAllocationSetHash: HASH,
      };
    }

    it("happy path: review → finalized with statement + signature", async () => {
      const epoch = await adapter.createEpoch({
        nodeId: TEST_NODE_ID,
        scopeId: TEST_SCOPE_ID,
        ...epochWindow(20),
        weightConfig: TEST_WEIGHT_CONFIG,
      });
      await adapter.closeIngestion(
        epoch.id,
        "atomic-approver-hash",
        "weight-sum-v0",
        "atomic-wch"
      );

      const { epoch: fin, statement } = await adapter.finalizeEpochAtomic(
        makeAtomicParams(epoch.id)
      );

      expect(fin.status).toBe("finalized");
      expect(fin.poolTotalCredits).toBe(10000n);
      expect(fin.closedAt).not.toBeNull();
      expect(statement.allocationSetHash).toBe(HASH);
      expect(statement.poolTotalCredits).toBe(10000n);

      // Signature was created
      const sigs = await adapter.getSignaturesForStatement(statement.id);
      expect(sigs).toHaveLength(1);
      expect(sigs[0]?.signerWallet).toBe(SIGNER_WALLET);
    });

    it("retry: call twice with same inputs — no error, same statement", async () => {
      const epoch = await adapter.createEpoch({
        nodeId: TEST_NODE_ID,
        scopeId: TEST_SCOPE_ID,
        ...epochWindow(21),
        weightConfig: TEST_WEIGHT_CONFIG,
      });
      await adapter.closeIngestion(
        epoch.id,
        "retry-hash",
        "weight-sum-v0",
        "retry-wch"
      );

      const params = makeAtomicParams(epoch.id);
      const first = await adapter.finalizeEpochAtomic(params);
      const second = await adapter.finalizeEpochAtomic(params);

      expect(first.statement.id).toBe(second.statement.id);
      expect(second.epoch.status).toBe("finalized");
    });

    it("already-finalized + missing signature → signature repaired", async () => {
      const epoch = await adapter.createEpoch({
        nodeId: TEST_NODE_ID,
        scopeId: TEST_SCOPE_ID,
        ...epochWindow(22),
        weightConfig: TEST_WEIGHT_CONFIG,
      });
      await adapter.closeIngestion(
        epoch.id,
        "repair-hash",
        "weight-sum-v0",
        "repair-wch"
      );

      // First call creates statement + signature for signer A
      const params = makeAtomicParams(epoch.id);
      await adapter.finalizeEpochAtomic(params);

      // Second call with different signer — should add the signature
      const SIGNER_B = "0xbbbb000000000000000000000000000000000002";
      const repairParams = {
        ...params,
        signature: {
          ...params.signature,
          signerWallet: SIGNER_B,
          signature: "0xsig_bbb",
        },
      };
      const { statement } = await adapter.finalizeEpochAtomic(repairParams);

      const sigs = await adapter.getSignaturesForStatement(statement.id);
      expect(sigs).toHaveLength(2);
      const wallets = sigs.map((s) => s.signerWallet).sort();
      expect(wallets).toEqual([SIGNER_WALLET, SIGNER_B].sort());
    });

    it("hash mismatch → throws", async () => {
      const epoch = await adapter.createEpoch({
        nodeId: TEST_NODE_ID,
        scopeId: TEST_SCOPE_ID,
        ...epochWindow(23),
        weightConfig: TEST_WEIGHT_CONFIG,
      });
      await adapter.closeIngestion(
        epoch.id,
        "hash-mismatch-approver",
        "weight-sum-v0",
        "hash-wch"
      );

      // First call with hash A
      const params = makeAtomicParams(epoch.id);
      await adapter.finalizeEpochAtomic(params);

      // Second call with different expected hash
      const badParams = {
        ...params,
        expectedAllocationSetHash: "different-hash-xyz",
      };
      await expect(adapter.finalizeEpochAtomic(badParams)).rejects.toThrow(
        /allocationSetHash mismatch/
      );
    });

    it("signature divergence → throws", async () => {
      const epoch = await adapter.createEpoch({
        nodeId: TEST_NODE_ID,
        scopeId: TEST_SCOPE_ID,
        ...epochWindow(24),
        weightConfig: TEST_WEIGHT_CONFIG,
      });
      await adapter.closeIngestion(
        epoch.id,
        "diverge-approver",
        "weight-sum-v0",
        "diverge-wch"
      );

      const params = makeAtomicParams(epoch.id);
      await adapter.finalizeEpochAtomic(params);

      // Same signer, different signature text
      const divergeParams = {
        ...params,
        signature: {
          ...params.signature,
          signature: "0xdifferent_sig",
        },
      };
      await expect(adapter.finalizeEpochAtomic(divergeParams)).rejects.toThrow(
        /signature divergence/
      );
    });

    it("open epoch → throws EpochNotOpenError", async () => {
      const epoch = await adapter.createEpoch({
        nodeId: TEST_NODE_ID,
        scopeId: TEST_SCOPE_ID,
        ...epochWindow(25),
        weightConfig: TEST_WEIGHT_CONFIG,
      });

      await expect(
        adapter.finalizeEpochAtomic(makeAtomicParams(epoch.id))
      ).rejects.toThrow(EpochNotOpenError);

      // Cleanup
      await adapter.closeIngestion(
        epoch.id,
        "cleanup",
        "weight-sum-v0",
        "cleanup"
      );
      await adapter.finalizeEpoch(epoch.id, 0n);
    });

    it("missing epoch → throws EpochNotFoundError", async () => {
      await expect(
        adapter.finalizeEpochAtomic(makeAtomicParams(999999n))
      ).rejects.toThrow(EpochNotFoundError);
    });
  });

  // ── SCOPE_GATED_QUERIES ─────────────────────────────────────────

  describe("SCOPE_GATED_QUERIES", () => {
    const OTHER_SCOPE_ID = "00000000-0000-4000-8000-000000000099";
    const otherScopeAdapter = new DrizzleLedgerAdapter(db, OTHER_SCOPE_ID);
    let scopeTestEpochId: bigint;

    beforeAll(async () => {
      // Create epoch in TEST_SCOPE_ID (via the main adapter)
      const epoch = await adapter.createEpoch({
        nodeId: TEST_NODE_ID,
        scopeId: TEST_SCOPE_ID,
        ...epochWindow(10),
        weightConfig: TEST_WEIGHT_CONFIG,
      });
      scopeTestEpochId = epoch.id;
    });

    afterAll(async () => {
      const open = await adapter.getOpenEpoch(TEST_NODE_ID, TEST_SCOPE_ID);
      if (open) {
        await adapter.closeIngestion(
          open.id,
          "cleanup-hash",
          "weight-sum-v0",
          "cleanup-wch"
        );
        await adapter.finalizeEpoch(open.id, 0n);
      }
    });

    it("getEpoch returns null for cross-scope epochId", async () => {
      const result = await otherScopeAdapter.getEpoch(scopeTestEpochId);
      expect(result).toBeNull();
    });

    it("closeIngestion throws EpochNotFoundError for cross-scope epochId", async () => {
      await expect(
        otherScopeAdapter.closeIngestion(
          scopeTestEpochId,
          "test-hash",
          "weight-sum-v0",
          "test-wch"
        )
      ).rejects.toThrow(EpochNotFoundError);
    });

    it("finalizeEpoch throws EpochNotFoundError for cross-scope epochId", async () => {
      await expect(
        otherScopeAdapter.finalizeEpoch(scopeTestEpochId, 100n)
      ).rejects.toThrow(EpochNotFoundError);
    });

    it("getCurationForEpoch throws EpochNotFoundError for cross-scope epochId", async () => {
      await expect(
        otherScopeAdapter.getCurationForEpoch(scopeTestEpochId)
      ).rejects.toThrow(EpochNotFoundError);
    });

    it("getUnresolvedCuration throws EpochNotFoundError for cross-scope epochId", async () => {
      await expect(
        otherScopeAdapter.getUnresolvedCuration(scopeTestEpochId)
      ).rejects.toThrow(EpochNotFoundError);
    });

    it("getAllocationsForEpoch throws EpochNotFoundError for cross-scope epochId", async () => {
      await expect(
        otherScopeAdapter.getAllocationsForEpoch(scopeTestEpochId)
      ).rejects.toThrow(EpochNotFoundError);
    });

    it("getPoolComponentsForEpoch throws EpochNotFoundError for cross-scope epochId", async () => {
      await expect(
        otherScopeAdapter.getPoolComponentsForEpoch(scopeTestEpochId)
      ).rejects.toThrow(EpochNotFoundError);
    });

    it("getStatementForEpoch throws EpochNotFoundError for cross-scope epochId", async () => {
      await expect(
        otherScopeAdapter.getStatementForEpoch(scopeTestEpochId)
      ).rejects.toThrow(EpochNotFoundError);
    });

    it("updateAllocationFinalUnits throws EpochNotFoundError for cross-scope epochId", async () => {
      await expect(
        otherScopeAdapter.updateAllocationFinalUnits(
          scopeTestEpochId,
          "any-user",
          100n
        )
      ).rejects.toThrow(EpochNotFoundError);
    });

    it("getUncuratedEvents throws EpochNotFoundError for cross-scope epochId", async () => {
      await expect(
        otherScopeAdapter.getUncuratedEvents(
          TEST_NODE_ID,
          scopeTestEpochId,
          new Date("2026-01-01"),
          new Date("2026-12-31")
        )
      ).rejects.toThrow(EpochNotFoundError);
    });

    it("updateCurationUserId throws EpochNotFoundError for cross-scope epochId", async () => {
      await expect(
        otherScopeAdapter.updateCurationUserId(
          scopeTestEpochId,
          "any-event",
          "any-user"
        )
      ).rejects.toThrow(EpochNotFoundError);
    });

    it("listEpochs returns empty for wrong scope", async () => {
      const results = await otherScopeAdapter.listEpochs(TEST_NODE_ID);
      const match = results.find((e) => e.id === scopeTestEpochId);
      expect(match).toBeUndefined();
    });

    it("same-scope adapter can access the epoch normally", async () => {
      const result = await adapter.getEpoch(scopeTestEpochId);
      expect(result).not.toBeNull();
      expect(result?.scopeId).toBe(TEST_SCOPE_ID);
    });
  });
});
