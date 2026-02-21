// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/component/db/drizzle-ledger.adapter.int`
 * Purpose: Component tests for DrizzleLedgerAdapter against real PostgreSQL via testcontainers.
 * Scope: Verifies adapter + DB triggers (ACTIVITY_APPEND_ONLY, CURATION_FREEZE_ON_CLOSE, ONE_OPEN_EPOCH, ACTIVITY_IDEMPOTENT). Does not test domain logic or routes.
 * Invariants: ACTIVITY_APPEND_ONLY, ACTIVITY_IDEMPOTENT, CURATION_FREEZE_ON_CLOSE, ONE_OPEN_EPOCH, EPOCH_WINDOW_UNIQUE, NODE_SCOPED
 * Side-effects: IO (database operations via testcontainers)
 * Links: packages/db-client/src/adapters/drizzle-ledger.adapter.ts, packages/ledger-core/src/store.ts
 * @public
 */

import { DrizzleLedgerAdapter } from "@cogni/db-client";
import {
  activityCuration,
  activityEvents,
  epochAllocations,
  epochPoolComponents,
  epochs,
  payoutStatements,
  sourceCursors,
  statementSignatures,
} from "@cogni/db-schema/ledger";
import {
  AllocationNotFoundError,
  EpochNotFoundError,
} from "@cogni/ledger-core";
import { getSeedDb } from "@tests/_fixtures/db/seed-client";
import {
  makeActivityEvent,
  makeAllocation,
  makeCuration,
  makePoolComponent,
  TEST_NODE_ID,
  TEST_WEIGHT_CONFIG,
  weekWindow,
} from "@tests/_fixtures/ledger/seed-ledger";
import { seedTestActor, type TestActor } from "@tests/_fixtures/stack/seed";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("DrizzleLedgerAdapter (Component)", () => {
  const db = getSeedDb();
  const adapter = new DrizzleLedgerAdapter(db);

  let actor: TestActor;

  beforeAll(async () => {
    actor = await seedTestActor(db);
  });

  // Cleanup in FK-safe order
  afterAll(async () => {
    await db.delete(statementSignatures);
    await db.delete(payoutStatements);
    await db.delete(epochAllocations);
    await db.delete(activityCuration);
    await db.delete(epochPoolComponents);
    await db.delete(sourceCursors);
    await db.delete(activityEvents);
    await db.delete(epochs);
  });

  // ── Epochs ────────────────────────────────────────────────────

  describe("epochs", () => {
    it("creates an epoch and retrieves it", async () => {
      const window = weekWindow(0);
      const epoch = await adapter.createEpoch({
        nodeId: TEST_NODE_ID,
        ...window,
        weightConfig: TEST_WEIGHT_CONFIG,
      });

      expect(epoch.status).toBe("open");
      expect(epoch.nodeId).toBe(TEST_NODE_ID);
      expect(epoch.poolTotalCredits).toBeNull();
      expect(epoch.closedAt).toBeNull();

      const fetched = await adapter.getEpoch(epoch.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(epoch.id);
    });

    it("getOpenEpoch returns the open epoch for the node", async () => {
      const open = await adapter.getOpenEpoch(TEST_NODE_ID);
      expect(open).not.toBeNull();
      expect(open!.status).toBe("open");
    });

    it("listEpochs returns all epochs for the node", async () => {
      const list = await adapter.listEpochs(TEST_NODE_ID);
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list.every((e) => e.nodeId === TEST_NODE_ID)).toBe(true);
    });

    it("ONE_OPEN_EPOCH: rejects second open epoch for same node", async () => {
      const window2 = weekWindow(1);
      await expect(
        adapter.createEpoch({
          nodeId: TEST_NODE_ID,
          ...window2,
          weightConfig: TEST_WEIGHT_CONFIG,
        })
      ).rejects.toThrow();
    });

    it("EPOCH_WINDOW_UNIQUE: rejects duplicate window for same node", async () => {
      // Close the current open epoch first
      const open = await adapter.getOpenEpoch(TEST_NODE_ID);
      expect(open).not.toBeNull();
      await adapter.closeEpoch(open!.id, 10000n);

      // Attempt to create duplicate window
      const window = weekWindow(0);
      await expect(
        adapter.createEpoch({
          nodeId: TEST_NODE_ID,
          ...window,
          weightConfig: TEST_WEIGHT_CONFIG,
        })
      ).rejects.toThrow();
    });

    it("closeEpoch sets status, poolTotal, and closedAt", async () => {
      const window = weekWindow(2);
      const epoch = await adapter.createEpoch({
        nodeId: TEST_NODE_ID,
        ...window,
        weightConfig: TEST_WEIGHT_CONFIG,
      });

      const closed = await adapter.closeEpoch(epoch.id, 50000n);
      expect(closed.status).toBe("closed");
      expect(closed.poolTotalCredits).toBe(50000n);
      expect(closed.closedAt).not.toBeNull();
    });

    it("closeEpoch on already-closed epoch returns it (EPOCH_CLOSE_IDEMPOTENT)", async () => {
      // Use the epoch closed in the previous test
      const list = await adapter.listEpochs(TEST_NODE_ID);
      const closed = list.find(
        (e) => e.status === "closed" && e.poolTotalCredits === 50000n
      );
      expect(closed).toBeDefined();

      const result = await adapter.closeEpoch(closed!.id, 99999n);
      // Returns existing closed epoch, does NOT update poolTotal
      expect(result.status).toBe("closed");
      expect(result.poolTotalCredits).toBe(50000n);
    });

    it("closeEpoch on non-existent epoch throws EpochNotFoundError", async () => {
      await expect(adapter.closeEpoch(999999n, 100n)).rejects.toThrow(
        EpochNotFoundError
      );
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

      // Should not throw
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
      ).rejects.toThrow(/not allowed/i);
    });

    it("ACTIVITY_APPEND_ONLY: DELETE on activity_events is rejected by trigger", async () => {
      await expect(
        db.execute(
          sql`DELETE FROM activity_events WHERE id = 'github:pr:test/repo:1' AND node_id = ${TEST_NODE_ID}::uuid`
        )
      ).rejects.toThrow(/not allowed/i);
    });
  });

  // ── Curation ──────────────────────────────────────────────────

  describe("curation", () => {
    let openEpochId: bigint;

    beforeAll(async () => {
      // Create a fresh open epoch for curation tests
      const window = weekWindow(3);
      const epoch = await adapter.createEpoch({
        nodeId: TEST_NODE_ID,
        ...window,
        weightConfig: TEST_WEIGHT_CONFIG,
      });
      openEpochId = epoch.id;
    });

    it("upserts curation entries and retrieves them", async () => {
      await adapter.upsertCuration([
        makeCuration({
          epochId: openEpochId,
          eventId: "github:pr:test/repo:1",
          userId: actor.user.id,
        }),
        makeCuration({
          epochId: openEpochId,
          eventId: "github:pr:test/repo:2",
          userId: null,
        }),
      ]);

      const all = await adapter.getCurationForEpoch(openEpochId);
      expect(all).toHaveLength(2);
    });

    it("getUnresolvedCuration returns only entries with null userId", async () => {
      const unresolved = await adapter.getUnresolvedCuration(openEpochId);
      expect(unresolved).toHaveLength(1);
      expect(unresolved[0]!.eventId).toBe("github:pr:test/repo:2");
    });

    it("upsert updates existing curation (same epoch+event)", async () => {
      await adapter.upsertCuration([
        makeCuration({
          epochId: openEpochId,
          eventId: "github:pr:test/repo:2",
          userId: actor.user.id,
        }),
      ]);

      const unresolved = await adapter.getUnresolvedCuration(openEpochId);
      expect(unresolved).toHaveLength(0);
    });

    it("CURATION_FREEZE_ON_CLOSE: rejects curation writes after epoch close", async () => {
      await adapter.closeEpoch(openEpochId, 5000n);

      await expect(
        adapter.upsertCuration([
          makeCuration({
            epochId: openEpochId,
            eventId: "github:pr:test/repo:1",
            userId: null,
            note: "should fail",
          }),
        ])
      ).rejects.toThrow(/closed/i);
    });
  });

  // ── Allocations ───────────────────────────────────────────────

  describe("allocations", () => {
    let epochId: bigint;

    beforeAll(async () => {
      const window = weekWindow(4);
      const epoch = await adapter.createEpoch({
        nodeId: TEST_NODE_ID,
        ...window,
        weightConfig: TEST_WEIGHT_CONFIG,
      });
      epochId = epoch.id;
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
      expect(allocs[0]!.proposedUnits).toBe(8000n);
      expect(allocs[0]!.finalUnits).toBeNull();
    });

    it("updateAllocationFinalUnits sets final_units and override_reason", async () => {
      await adapter.updateAllocationFinalUnits(
        epochId,
        actor.user.id,
        10000n,
        "bonus for extra work"
      );

      const allocs = await adapter.getAllocationsForEpoch(epochId);
      expect(allocs[0]!.finalUnits).toBe(10000n);
      expect(allocs[0]!.overrideReason).toBe("bonus for extra work");
    });

    it("updateAllocationFinalUnits throws AllocationNotFoundError for missing allocation", async () => {
      await expect(
        adapter.updateAllocationFinalUnits(epochId, "nonexistent-user", 100n)
      ).rejects.toThrow(AllocationNotFoundError);
    });
  });

  // ── Cursors ───────────────────────────────────────────────────

  describe("cursors", () => {
    it("upserts and retrieves a cursor", async () => {
      await adapter.upsertCursor(
        TEST_NODE_ID,
        "github",
        "pull_requests",
        "test/repo",
        "2026-01-06T00:00:00Z"
      );

      const cursor = await adapter.getCursor(
        TEST_NODE_ID,
        "github",
        "pull_requests",
        "test/repo"
      );
      expect(cursor).not.toBeNull();
      expect(cursor!.cursorValue).toBe("2026-01-06T00:00:00Z");
    });

    it("upsert updates existing cursor value", async () => {
      await adapter.upsertCursor(
        TEST_NODE_ID,
        "github",
        "pull_requests",
        "test/repo",
        "2026-01-07T00:00:00Z"
      );

      const cursor = await adapter.getCursor(
        TEST_NODE_ID,
        "github",
        "pull_requests",
        "test/repo"
      );
      expect(cursor!.cursorValue).toBe("2026-01-07T00:00:00Z");
    });

    it("getCursor returns null for unknown cursor", async () => {
      const cursor = await adapter.getCursor(
        TEST_NODE_ID,
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
      const window = weekWindow(5);
      const epoch = await adapter.createEpoch({
        nodeId: TEST_NODE_ID,
        ...window,
        weightConfig: TEST_WEIGHT_CONFIG,
      });
      epochId = epoch.id;
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
      ).rejects.toThrow(/not allowed/i);
    });
  });

  // ── Payout Statements ─────────────────────────────────────────

  describe("payout statements", () => {
    let epochId: bigint;

    beforeAll(async () => {
      const window = weekWindow(6);
      const epoch = await adapter.createEpoch({
        nodeId: TEST_NODE_ID,
        ...window,
        weightConfig: TEST_WEIGHT_CONFIG,
      });
      await adapter.closeEpoch(epoch.id, 10000n);
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
      expect(fetched!.id).toBe(stmt.id);
    });

    it("getStatementForEpoch returns null for epoch without statement", async () => {
      const result = await adapter.getStatementForEpoch(999999n);
      expect(result).toBeNull();
    });
  });

  // ── Statement Signatures ──────────────────────────────────────

  describe("statement signatures", () => {
    it("inserts and retrieves a signature", async () => {
      // Get the statement from previous test
      const list = await adapter.listEpochs(TEST_NODE_ID);
      const closedEpoch = list.find(
        (e) => e.status === "closed" && e.poolTotalCredits === 10000n
      );
      expect(closedEpoch).toBeDefined();

      const stmt = await adapter.getStatementForEpoch(closedEpoch!.id);
      expect(stmt).not.toBeNull();

      await adapter.insertStatementSignature({
        nodeId: TEST_NODE_ID,
        statementId: stmt!.id,
        signerWallet: "0x1234567890abcdef1234567890abcdef12345678",
        signature: "0xdeadbeef",
        signedAt: new Date(),
      });

      const sigs = await adapter.getSignaturesForStatement(stmt!.id);
      expect(sigs).toHaveLength(1);
      expect(sigs[0]!.signerWallet).toBe(
        "0x1234567890abcdef1234567890abcdef12345678"
      );
    });
  });
});
