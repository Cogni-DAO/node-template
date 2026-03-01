// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/packages/attribution-ledger/allocation`
 * Purpose: Unit tests for computeProposedAllocations, validateWeightConfig, and deriveAllocationAlgoRef.
 * Scope: Asserts weight-sum-v0 and work-item-budget-v0 algorithm correctness, deterministic ordering, weight overrides, empty inputs, budget caps, largest-remainder rounding, and weight validation. Does not test store or I/O.
 * Invariants: ALLOCATION_ALGO_VERSIONED, ALL_MATH_BIGINT, WEIGHTS_VALIDATED.
 * Side-effects: none
 * Links: packages/attribution-ledger/src/allocation.ts
 * @internal
 */

import {
  computeProposedAllocations,
  deriveAllocationAlgoRef,
  type SelectedReceiptForAllocation,
  validateWeightConfig,
  WORK_ITEM_LINKS_ARTIFACT_REF,
  type WorkItemLinksPayload,
} from "@cogni/attribution-ledger";
import { describe, expect, it } from "vitest";

// Legacy alias — existing tests use CuratedEventForAllocation (phantom type)
type CuratedEventForAllocation = SelectedReceiptForAllocation;

const weightConfig: Record<string, number> = {
  "github:pr_merged": 1000,
  "github:review_submitted": 500,
  "github:issue_closed": 300,
};

function makeEvent(
  overrides: Partial<CuratedEventForAllocation> & {
    eventId: string;
    userId: string;
  }
): CuratedEventForAllocation {
  return {
    source: "github",
    eventType: "pr_merged",
    included: true,
    weightOverrideMilli: null,
    ...overrides,
  };
}

describe("computeProposedAllocations", () => {
  it("computes allocations for weight-sum-v0", () => {
    const events: CuratedEventForAllocation[] = [
      makeEvent({ eventId: "e1", userId: "alice" }),
      makeEvent({
        eventId: "e2",
        userId: "bob",
        eventType: "review_submitted",
      }),
      makeEvent({ eventId: "e3", userId: "alice" }),
    ];

    const result = computeProposedAllocations(
      "weight-sum-v0",
      events,
      weightConfig
    );

    expect(result).toHaveLength(2);
    // alice: 2 pr_merged → 2 * 1000 = 2000
    expect(result[0]).toEqual({
      userId: "alice",
      proposedUnits: 2000n,
      activityCount: 2,
    });
    // bob: 1 review_submitted → 500
    expect(result[1]).toEqual({
      userId: "bob",
      proposedUnits: 500n,
      activityCount: 1,
    });
  });

  it("filters out excluded events", () => {
    const events: CuratedEventForAllocation[] = [
      makeEvent({ eventId: "e1", userId: "alice" }),
      makeEvent({ eventId: "e2", userId: "bob", included: false }),
    ];

    const result = computeProposedAllocations(
      "weight-sum-v0",
      events,
      weightConfig
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.userId).toBe("alice");
  });

  it("uses weightOverrideMilli when present", () => {
    const events: CuratedEventForAllocation[] = [
      makeEvent({
        eventId: "e1",
        userId: "alice",
        weightOverrideMilli: 5000n,
      }),
    ];

    const result = computeProposedAllocations(
      "weight-sum-v0",
      events,
      weightConfig
    );

    expect(result[0]?.proposedUnits).toBe(5000n);
  });

  it("returns empty array for empty events", () => {
    const result = computeProposedAllocations(
      "weight-sum-v0",
      [],
      weightConfig
    );

    expect(result).toEqual([]);
  });

  it("returns deterministic order (sorted by userId)", () => {
    const events: CuratedEventForAllocation[] = [
      makeEvent({ eventId: "e1", userId: "zara" }),
      makeEvent({ eventId: "e2", userId: "alice" }),
      makeEvent({ eventId: "e3", userId: "mike" }),
    ];

    const result = computeProposedAllocations(
      "weight-sum-v0",
      events,
      weightConfig
    );

    expect(result.map((a) => a.userId)).toEqual(["alice", "mike", "zara"]);
  });

  it("defaults to 0 weight for unknown event types", () => {
    const events: CuratedEventForAllocation[] = [
      makeEvent({
        eventId: "e1",
        userId: "alice",
        eventType: "unknown_type",
      }),
    ];

    const result = computeProposedAllocations(
      "weight-sum-v0",
      events,
      weightConfig
    );

    expect(result[0]?.proposedUnits).toBe(0n);
  });

  it("throws for unknown algorithm ref", () => {
    expect(() =>
      computeProposedAllocations("unknown-algo", [], weightConfig)
    ).toThrow("Unknown allocation algorithm: unknown-algo");
  });

  it("produces identical output for same inputs (deterministic)", () => {
    const events: CuratedEventForAllocation[] = [
      makeEvent({ eventId: "e1", userId: "bob" }),
      makeEvent({ eventId: "e2", userId: "alice" }),
    ];

    const r1 = computeProposedAllocations(
      "weight-sum-v0",
      events,
      weightConfig
    );
    const r2 = computeProposedAllocations(
      "weight-sum-v0",
      events,
      weightConfig
    );

    expect(r1).toEqual(r2);
  });
});

describe("validateWeightConfig", () => {
  it("accepts valid integer config", () => {
    expect(() =>
      validateWeightConfig({ "github:pr_merged": 1000 })
    ).not.toThrow();
  });

  it("rejects NaN", () => {
    expect(() => validateWeightConfig({ "github:pr_merged": NaN })).toThrow(
      "must be finite"
    );
  });

  it("rejects Infinity", () => {
    expect(() =>
      validateWeightConfig({ "github:pr_merged": Infinity })
    ).toThrow("must be finite");
  });

  it("rejects floats", () => {
    expect(() => validateWeightConfig({ "github:pr_merged": 1.5 })).toThrow(
      "must be an integer"
    );
  });

  it("rejects unsafe integers", () => {
    expect(() =>
      validateWeightConfig({
        "github:pr_merged": Number.MAX_SAFE_INTEGER + 1,
      })
    ).toThrow("exceeds safe integer range");
  });

  it("accepts empty config", () => {
    expect(() => validateWeightConfig({})).not.toThrow();
  });

  it("accepts zero and negative values", () => {
    expect(() => validateWeightConfig({ a: 0, b: -100 })).not.toThrow();
  });
});

describe("deriveAllocationAlgoRef", () => {
  it("maps cogni-v0.0 to weight-sum-v0", () => {
    expect(deriveAllocationAlgoRef("cogni-v0.0")).toBe("weight-sum-v0");
  });

  it("maps cogni-v0.1 to work-item-budget-v0", () => {
    expect(deriveAllocationAlgoRef("cogni-v0.1")).toBe("work-item-budget-v0");
  });

  it("throws for unknown algo", () => {
    expect(() => deriveAllocationAlgoRef("unknown")).toThrow(
      "Unknown credit_estimate_algo"
    );
  });
});

// --- work-item-budget-v0 tests ---

function makeReceipt(
  overrides: Partial<SelectedReceiptForAllocation> & {
    receiptId: string;
    userId: string;
  }
): SelectedReceiptForAllocation {
  return {
    source: "github",
    eventType: "pr_merged",
    included: true,
    weightOverrideMilli: null,
    ...overrides,
  };
}

function makeArtifacts(
  payload: WorkItemLinksPayload
): ReadonlyMap<string, unknown> {
  return new Map([[WORK_ITEM_LINKS_ARTIFACT_REF, payload]]);
}

function makePayload(
  overrides: Partial<WorkItemLinksPayload> = {}
): WorkItemLinksPayload {
  return {
    repoCommitSha: "abc123",
    priorityMultipliers: { 0: 0, 1: 1000, 2: 2000, 3: 4000 },
    workItems: {},
    eventLinks: {},
    unlinkedEventIds: [],
    ...overrides,
  };
}

describe("work-item-budget-v0", () => {
  it("distributes work item budget among linked events", () => {
    const events = [
      makeReceipt({ receiptId: "e1", userId: "alice" }),
      makeReceipt({ receiptId: "e2", userId: "bob" }),
    ];
    const payload = makePayload({
      workItems: {
        "task.0102": {
          estimate: 3,
          priority: 1,
          status: "done",
          title: "Test",
          frontmatterHash: "sha256:abc",
          budgetMilli: "3000", // 3 * 1000
        },
      },
      eventLinks: {
        e1: [{ workItemId: "task.0102", linkSource: "title" }],
        e2: [{ workItemId: "task.0102", linkSource: "branch" }],
      },
    });

    const result = computeProposedAllocations(
      "work-item-budget-v0",
      events,
      weightConfig,
      makeArtifacts(payload)
    );

    // Both events are pr_merged (weight 1000 each). Equal split of 3000 budget = 1500 each.
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      userId: "alice",
      proposedUnits: 1500n,
      activityCount: 1,
    });
    expect(result[1]).toEqual({
      userId: "bob",
      proposedUnits: 1500n,
      activityCount: 1,
    });
  });

  it("caps budget per work item — adding events splits budget, not increases", () => {
    // One event: gets full budget
    const oneEvent = [makeReceipt({ receiptId: "e1", userId: "alice" })];
    const payload = makePayload({
      workItems: {
        "task.0102": {
          estimate: 2,
          priority: 2,
          status: "done",
          title: "Test",
          frontmatterHash: "sha256:abc",
          budgetMilli: "4000", // 2 * 2000
        },
      },
      eventLinks: {
        e1: [{ workItemId: "task.0102", linkSource: "title" }],
      },
    });

    const r1 = computeProposedAllocations(
      "work-item-budget-v0",
      oneEvent,
      weightConfig,
      makeArtifacts(payload)
    );
    expect(r1[0]?.proposedUnits).toBe(4000n);

    // Three events: budget is still 4000, split three ways
    const threeEvents = [
      makeReceipt({ receiptId: "e1", userId: "alice" }),
      makeReceipt({ receiptId: "e2", userId: "alice" }),
      makeReceipt({ receiptId: "e3", userId: "alice" }),
    ];
    const payload2 = makePayload({
      ...payload,
      eventLinks: {
        e1: [{ workItemId: "task.0102", linkSource: "title" }],
        e2: [{ workItemId: "task.0102", linkSource: "body" }],
        e3: [{ workItemId: "task.0102", linkSource: "branch" }],
      },
    });

    const r2 = computeProposedAllocations(
      "work-item-budget-v0",
      threeEvents,
      weightConfig,
      makeArtifacts(payload2)
    );
    // Total still 4000 (capped)
    const total = r2.reduce((sum, a) => sum + a.proposedUnits, 0n);
    expect(total).toBe(4000n);
  });

  it("largest-remainder rounding: sum equals budget exactly", () => {
    // 3 users with equal weight splitting budget of 10000 (not divisible by 3)
    const events = [
      makeReceipt({ receiptId: "e1", userId: "alice" }),
      makeReceipt({ receiptId: "e2", userId: "bob" }),
      makeReceipt({ receiptId: "e3", userId: "charlie" }),
    ];
    const payload = makePayload({
      workItems: {
        "task.0102": {
          estimate: 10,
          priority: 1,
          status: "done",
          title: "Test",
          frontmatterHash: "sha256:abc",
          budgetMilli: "10000",
        },
      },
      eventLinks: {
        e1: [{ workItemId: "task.0102", linkSource: "title" }],
        e2: [{ workItemId: "task.0102", linkSource: "title" }],
        e3: [{ workItemId: "task.0102", linkSource: "title" }],
      },
    });

    const result = computeProposedAllocations(
      "work-item-budget-v0",
      events,
      weightConfig,
      makeArtifacts(payload)
    );

    // Sum must be exactly 10000
    const total = result.reduce((sum, a) => sum + a.proposedUnits, 0n);
    expect(total).toBe(10000n);

    // Each gets ~3333, with 1 remaining unit distributed
    expect(result).toHaveLength(3);
    const units = result.map((a) => a.proposedUnits).sort();
    expect(units).toEqual([3333n, 3333n, 3334n]);
  });

  it("unlinked events get flat V0 weights (fallback)", () => {
    const events = [
      makeReceipt({ receiptId: "e1", userId: "alice" }),
      makeReceipt({
        receiptId: "e2",
        userId: "bob",
        eventType: "review_submitted",
      }),
    ];
    const payload = makePayload({
      unlinkedEventIds: ["e1", "e2"],
    });

    const result = computeProposedAllocations(
      "work-item-budget-v0",
      events,
      weightConfig,
      makeArtifacts(payload)
    );

    // Flat V0 weights: alice = 1000 (pr_merged), bob = 500 (review_submitted)
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      userId: "alice",
      proposedUnits: 1000n,
      activityCount: 1,
    });
    expect(result[1]).toEqual({
      userId: "bob",
      proposedUnits: 500n,
      activityCount: 1,
    });
  });

  it("mixed linked and unlinked events are additive", () => {
    const events = [
      makeReceipt({ receiptId: "e1", userId: "alice" }), // linked
      makeReceipt({ receiptId: "e2", userId: "alice" }), // unlinked
    ];
    const payload = makePayload({
      workItems: {
        "task.0102": {
          estimate: 2,
          priority: 1,
          status: "done",
          title: "Test",
          frontmatterHash: "sha256:abc",
          budgetMilli: "2000",
        },
      },
      eventLinks: {
        e1: [{ workItemId: "task.0102", linkSource: "title" }],
      },
      unlinkedEventIds: ["e2"],
    });

    const result = computeProposedAllocations(
      "work-item-budget-v0",
      events,
      weightConfig,
      makeArtifacts(payload)
    );

    // alice: linked = 2000 (full budget, sole contributor) + unlinked = 1000 = 3000
    expect(result).toHaveLength(1);
    expect(result[0]?.proposedUnits).toBe(3000n);
  });

  it("multi-user work item split with different event types", () => {
    const events = [
      makeReceipt({ receiptId: "e1", userId: "alice" }), // pr_merged: 1000
      makeReceipt({ receiptId: "e2", userId: "alice" }), // pr_merged: 1000
      makeReceipt({
        receiptId: "e3",
        userId: "bob",
        eventType: "review_submitted",
      }), // review: 500
    ];
    const payload = makePayload({
      workItems: {
        "task.0102": {
          estimate: 5,
          priority: 2,
          status: "done",
          title: "Test",
          frontmatterHash: "sha256:abc",
          budgetMilli: "10000", // 5 * 2000
        },
      },
      eventLinks: {
        e1: [{ workItemId: "task.0102", linkSource: "title" }],
        e2: [{ workItemId: "task.0102", linkSource: "body" }],
        e3: [{ workItemId: "task.0102", linkSource: "title" }],
      },
    });

    const result = computeProposedAllocations(
      "work-item-budget-v0",
      events,
      weightConfig,
      makeArtifacts(payload)
    );

    // alice weight = 2000, bob weight = 500, total = 2500
    // alice share = (2000/2500) * 10000 = 8000
    // bob share = (500/2500) * 10000 = 2000
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      userId: "alice",
      proposedUnits: 8000n,
      activityCount: 1,
    });
    expect(result[1]).toEqual({
      userId: "bob",
      proposedUnits: 2000n,
      activityCount: 1,
    });
    // Verify exact budget
    const total = result.reduce((sum, a) => sum + a.proposedUnits, 0n);
    expect(total).toBe(10000n);
  });

  it("zero-budget work items (error/missing) do not affect allocation", () => {
    const events = [makeReceipt({ receiptId: "e1", userId: "alice" })];
    const payload = makePayload({
      workItems: {
        "task.0102": {
          estimate: null,
          priority: null,
          status: null,
          title: null,
          frontmatterHash: "sha256:abc",
          budgetMilli: "0",
          error: "file_not_found",
        },
      },
      eventLinks: {
        e1: [{ workItemId: "task.0102", linkSource: "title" }],
      },
    });

    const result = computeProposedAllocations(
      "work-item-budget-v0",
      events,
      weightConfig,
      makeArtifacts(payload)
    );

    // Zero-budget work item — event treated as unlinked (flat weight fallback)
    expect(result).toHaveLength(1);
    expect(result[0]?.proposedUnits).toBe(1000n); // pr_merged flat weight
  });

  it("falls back to weight-sum-v0 when no artifact present", () => {
    const events = [
      makeReceipt({ receiptId: "e1", userId: "alice" }),
      makeReceipt({
        receiptId: "e2",
        userId: "bob",
        eventType: "review_submitted",
      }),
    ];

    const result = computeProposedAllocations(
      "work-item-budget-v0",
      events,
      weightConfig
      // no artifacts
    );

    // Falls back to weight-sum-v0
    expect(result).toHaveLength(2);
    expect(result[0]?.proposedUnits).toBe(1000n); // alice pr_merged
    expect(result[1]?.proposedUnits).toBe(500n); // bob review
  });

  it("weight-sum-v0 ignores artifacts (backward compat)", () => {
    const events = [makeReceipt({ receiptId: "e1", userId: "alice" })];
    const payload = makePayload({
      workItems: {
        "task.0102": {
          estimate: 5,
          priority: 3,
          status: "done",
          title: "Test",
          frontmatterHash: "sha256:abc",
          budgetMilli: "20000",
        },
      },
      eventLinks: {
        e1: [{ workItemId: "task.0102", linkSource: "title" }],
      },
    });

    const result = computeProposedAllocations(
      "weight-sum-v0",
      events,
      weightConfig,
      makeArtifacts(payload)
    );

    // weight-sum-v0 ignores artifacts — uses flat weight
    expect(result[0]?.proposedUnits).toBe(1000n);
  });

  it("returns empty array for empty events", () => {
    const result = computeProposedAllocations(
      "work-item-budget-v0",
      [],
      weightConfig,
      makeArtifacts(makePayload())
    );
    expect(result).toEqual([]);
  });

  it("deterministic: same inputs + same artifacts = identical output", () => {
    const events = [
      makeReceipt({ receiptId: "e1", userId: "bob" }),
      makeReceipt({ receiptId: "e2", userId: "alice" }),
      makeReceipt({
        receiptId: "e3",
        userId: "charlie",
        eventType: "review_submitted",
      }),
    ];
    const payload = makePayload({
      workItems: {
        "task.0102": {
          estimate: 3,
          priority: 1,
          status: "done",
          title: "Test",
          frontmatterHash: "sha256:abc",
          budgetMilli: "3000",
        },
      },
      eventLinks: {
        e1: [{ workItemId: "task.0102", linkSource: "title" }],
        e2: [{ workItemId: "task.0102", linkSource: "body" }],
        e3: [{ workItemId: "task.0102", linkSource: "branch" }],
      },
    });

    const artifacts = makeArtifacts(payload);
    const r1 = computeProposedAllocations(
      "work-item-budget-v0",
      events,
      weightConfig,
      artifacts
    );
    const r2 = computeProposedAllocations(
      "work-item-budget-v0",
      events,
      weightConfig,
      artifacts
    );

    expect(r1).toEqual(r2);
  });

  it("event linked to multiple work items contributes to each budget", () => {
    const events = [makeReceipt({ receiptId: "e1", userId: "alice" })];
    const payload = makePayload({
      workItems: {
        "task.0101": {
          estimate: 1,
          priority: 1,
          status: "done",
          title: "A",
          frontmatterHash: "sha256:aaa",
          budgetMilli: "1000",
        },
        "task.0102": {
          estimate: 2,
          priority: 1,
          status: "done",
          title: "B",
          frontmatterHash: "sha256:bbb",
          budgetMilli: "2000",
        },
      },
      eventLinks: {
        e1: [
          { workItemId: "task.0101", linkSource: "title" },
          { workItemId: "task.0102", linkSource: "body" },
        ],
      },
    });

    const result = computeProposedAllocations(
      "work-item-budget-v0",
      events,
      weightConfig,
      makeArtifacts(payload)
    );

    // alice gets full budget from both: 1000 + 2000 = 3000
    expect(result).toHaveLength(1);
    expect(result[0]?.proposedUnits).toBe(3000n);
  });

  it("proposedUnits are milli-units (same unit as budgetMilli)", () => {
    const events = [makeReceipt({ receiptId: "e1", userId: "alice" })];
    const payload = makePayload({
      workItems: {
        "task.0102": {
          estimate: 3,
          priority: 1,
          status: "done",
          title: "Test",
          frontmatterHash: "sha256:abc",
          budgetMilli: "3000",
        },
      },
      eventLinks: {
        e1: [{ workItemId: "task.0102", linkSource: "title" }],
      },
    });

    const result = computeProposedAllocations(
      "work-item-budget-v0",
      events,
      weightConfig,
      makeArtifacts(payload)
    );

    // Budget is 3000 milli-units, proposedUnits should be 3000 milli-units
    expect(result[0]?.proposedUnits).toBe(3000n);
  });

  it("excluded events do not participate in budget distribution", () => {
    const events = [
      makeReceipt({ receiptId: "e1", userId: "alice" }),
      makeReceipt({ receiptId: "e2", userId: "bob", included: false }),
    ];
    const payload = makePayload({
      workItems: {
        "task.0102": {
          estimate: 2,
          priority: 1,
          status: "done",
          title: "Test",
          frontmatterHash: "sha256:abc",
          budgetMilli: "2000",
        },
      },
      eventLinks: {
        e1: [{ workItemId: "task.0102", linkSource: "title" }],
        e2: [{ workItemId: "task.0102", linkSource: "body" }],
      },
    });

    const result = computeProposedAllocations(
      "work-item-budget-v0",
      events,
      weightConfig,
      makeArtifacts(payload)
    );

    // Only alice (included), gets full budget
    expect(result).toHaveLength(1);
    expect(result[0]?.proposedUnits).toBe(2000n);
  });
});
