// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/attribution-ledger/allocation`
 * Purpose: Versioned allocation algorithm framework — pure function dispatch for computing proposed allocations from selected receipts.
 * Scope: Pure functions. Does not perform I/O or hold state. Deterministic output for same inputs.
 * Invariants:
 * - ALLOCATION_ALGO_VERSIONED: dispatch by algoRef; same inputs → identical output.
 * - ALL_MATH_BIGINT: All weight and unit computation uses BigInt.
 * - WEIGHTS_VALIDATED: rejects floats, NaN, Infinity, unsafe integers.
 * Side-effects: none
 * Links: docs/spec/attribution-ledger.md
 * @public
 */

import type { WorkItemLinksPayload } from "./enrichers/work-item-linker";
import { WORK_ITEM_LINKS_ARTIFACT_REF } from "./enrichers/work-item-linker";

/** Input: joined selection + ingestion_receipts data (only resolved, included receipts) */
export interface SelectedReceiptForAllocation {
  readonly receiptId: string;
  readonly userId: string;
  readonly source: string;
  readonly eventType: string;
  readonly included: boolean;
  readonly weightOverrideMilli: bigint | null;
}

export interface ProposedAllocation {
  readonly userId: string;
  readonly proposedUnits: bigint;
  readonly activityCount: number;
}

/**
 * Compute proposed allocations using the named algorithm version.
 * Pure function — no I/O, deterministic output for same inputs.
 * Throws if algoRef is unknown.
 *
 * artifacts: opaque map of evaluationRef -> payload. Each algorithm picks what it needs.
 * weight-sum-v0 ignores artifacts entirely (backward compat).
 * work-item-budget-v0 reads cogni.work_item_links.v0.
 */
export function computeProposedAllocations(
  algoRef: string,
  events: readonly SelectedReceiptForAllocation[],
  weightConfig: Record<string, number>,
  artifacts?: ReadonlyMap<string, unknown>
): ProposedAllocation[] {
  switch (algoRef) {
    case "weight-sum-v0":
      return weightSumV0(events, weightConfig);
    case "work-item-budget-v0":
      return workItemBudgetV0(events, weightConfig, artifacts);
    default:
      throw new Error(`Unknown allocation algorithm: ${algoRef}`);
  }
}

/**
 * V0 algorithm — weight-sum-v0:
 * 1. Filter to included === true
 * 2. For each event: weight = weightOverrideMilli ?? BigInt(weightConfig[`${source}:${eventType}`] ?? 0)
 * 3. Group by userId, sum weights → proposedUnits, count → activityCount
 * 4. Return sorted by userId (deterministic)
 */
function weightSumV0(
  events: readonly SelectedReceiptForAllocation[],
  weightConfig: Record<string, number>
): ProposedAllocation[] {
  const userUnits = new Map<string, bigint>();
  const userCounts = new Map<string, number>();

  for (const event of events) {
    if (!event.included) continue;

    const configKey = `${event.source}:${event.eventType}`;
    const weight =
      event.weightOverrideMilli ?? BigInt(weightConfig[configKey] ?? 0);

    const current = userUnits.get(event.userId) ?? 0n;
    userUnits.set(event.userId, current + weight);

    const count = userCounts.get(event.userId) ?? 0;
    userCounts.set(event.userId, count + 1);
  }

  const allocations: ProposedAllocation[] = [];
  for (const [userId, proposedUnits] of userUnits) {
    allocations.push({
      userId,
      proposedUnits,
      activityCount: userCounts.get(userId) ?? 0,
    });
  }

  // Deterministic: sort by userId
  return allocations.sort((a, b) => a.userId.localeCompare(b.userId));
}

/**
 * Validate weight config values as safe integers (milli-units).
 * Rejects floats, NaN, Infinity, unsafe integers.
 * Throws on first invalid value.
 */
export function validateWeightConfig(config: Record<string, number>): void {
  for (const [key, value] of Object.entries(config)) {
    if (!Number.isFinite(value)) {
      throw new RangeError(
        `Invalid weight config value for "${key}": ${value} (must be finite)`
      );
    }
    if (!Number.isInteger(value)) {
      throw new RangeError(
        `Invalid weight config value for "${key}": ${value} (must be an integer)`
      );
    }
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(
        `Invalid weight config value for "${key}": ${value} (exceeds safe integer range)`
      );
    }
  }
}

/**
 * Derive allocation algorithm ref from repo-spec credit_estimate_algo.
 * Pure function — maps governance config to internal algorithm ID.
 */
export function deriveAllocationAlgoRef(creditEstimateAlgo: string): string {
  switch (creditEstimateAlgo) {
    case "cogni-v0.0":
      return "weight-sum-v0";
    case "cogni-v0.1":
      return "work-item-budget-v0";
    default:
      throw new Error(`Unknown credit_estimate_algo: ${creditEstimateAlgo}`);
  }
}

/**
 * V1 algorithm — work-item-budget-v0:
 * Distributes fixed per-work-item budgets among contributors.
 * Event-spam on a single work item splits a fixed budget, not an unbounded sum.
 *
 * 1. Parse cogni.work_item_links.v0 artifact from artifacts map
 * 2. Build lookups: receiptId -> workItemId[], workItemId -> budgetMilli
 * 3. Linked events (budget > 0): for each work item, compute V0 event weights
 *    for linked events, distribute the work item's budgetMilli proportionally
 *    among users. Largest-remainder rounding within each work item.
 * 4. Unlinked events: apply V0 flat weights directly (fallback)
 * 5. Sum per user, sort by userId, return ProposedAllocation[]
 *
 * ALL_MATH_BIGINT. Deterministic: same events + same artifacts → identical output.
 */
function workItemBudgetV0(
  events: readonly SelectedReceiptForAllocation[],
  weightConfig: Record<string, number>,
  artifacts?: ReadonlyMap<string, unknown>
): ProposedAllocation[] {
  const included = events.filter((e) => e.included);
  if (included.length === 0) return [];

  // 1. Parse artifact payload
  const payload = artifacts?.get(WORK_ITEM_LINKS_ARTIFACT_REF) as
    | WorkItemLinksPayload
    | undefined;

  // No artifact → fall back to weight-sum-v0 behavior entirely
  if (!payload) {
    return weightSumV0(events, weightConfig);
  }

  // 2. Build lookups
  // receiptId → workItemIds (from eventLinks)
  const receiptToWorkItems = new Map<string, string[]>();
  for (const [receiptId, links] of Object.entries(payload.eventLinks)) {
    receiptToWorkItems.set(
      receiptId,
      links.map((l) => l.workItemId)
    );
  }
  // workItemId → budgetMilli
  const workItemBudgets = new Map<string, bigint>();
  for (const [wiId, snapshot] of Object.entries(payload.workItems)) {
    workItemBudgets.set(wiId, BigInt(snapshot.budgetMilli));
  }
  // 3. Group events by work item for linked distribution
  // workItemId → array of { userId, weight }
  const workItemEvents = new Map<
    string,
    Array<{ userId: string; weight: bigint }>
  >();
  // Track which receipts are linked (to any work item with budget > 0)
  const linkedReceiptIds = new Set<string>();

  for (const event of included) {
    const workItemIds = receiptToWorkItems.get(event.receiptId);
    if (workItemIds && workItemIds.length > 0) {
      const configKey = `${event.source}:${event.eventType}`;
      const weight =
        event.weightOverrideMilli ?? BigInt(weightConfig[configKey] ?? 0);

      for (const wiId of workItemIds) {
        const budget = workItemBudgets.get(wiId) ?? 0n;
        if (budget > 0n) {
          linkedReceiptIds.add(event.receiptId);
          const arr = workItemEvents.get(wiId) ?? [];
          arr.push({ userId: event.userId, weight });
          workItemEvents.set(wiId, arr);
        }
      }
    }
  }

  // 4. Distribute each work item's budget proportionally among users
  const userUnits = new Map<string, bigint>();
  const userCounts = new Map<string, number>();

  for (const [wiId, eventEntries] of workItemEvents) {
    const budget = workItemBudgets.get(wiId) ?? 0n;
    if (budget === 0n || eventEntries.length === 0) continue;

    // Aggregate weights by user within this work item
    const userWeights = new Map<string, bigint>();
    for (const entry of eventEntries) {
      const current = userWeights.get(entry.userId) ?? 0n;
      userWeights.set(entry.userId, current + entry.weight);
    }

    const totalWeight = [...userWeights.values()].reduce((a, b) => a + b, 0n);
    if (totalWeight === 0n) continue;

    // Largest-remainder rounding: distribute budget exactly
    const shares = largestRemainderDistribute(budget, userWeights, totalWeight);

    for (const [userId, share] of shares) {
      const current = userUnits.get(userId) ?? 0n;
      userUnits.set(userId, current + share);
    }

    // Count activity per user for linked events in this work item
    const userEventsInWi = new Set<string>();
    for (const entry of eventEntries) {
      const key = `${entry.userId}:${wiId}`;
      if (!userEventsInWi.has(key)) {
        userEventsInWi.add(key);
        const count = userCounts.get(entry.userId) ?? 0;
        userCounts.set(entry.userId, count + 1);
      }
    }
  }

  // 5. Unlinked events: apply V0 flat weights (fallback)
  for (const event of included) {
    if (linkedReceiptIds.has(event.receiptId)) continue;
    // Treat as unlinked — either explicitly in unlinkedEventIds or not in any work item
    const configKey = `${event.source}:${event.eventType}`;
    const weight =
      event.weightOverrideMilli ?? BigInt(weightConfig[configKey] ?? 0);

    const current = userUnits.get(event.userId) ?? 0n;
    userUnits.set(event.userId, current + weight);

    const count = userCounts.get(event.userId) ?? 0;
    userCounts.set(event.userId, count + 1);
  }

  // 6. Build result, sort by userId (deterministic)
  const allocations: ProposedAllocation[] = [];
  for (const [userId, proposedUnits] of userUnits) {
    if (proposedUnits === 0n && (userCounts.get(userId) ?? 0) === 0) continue;
    allocations.push({
      userId,
      proposedUnits,
      activityCount: userCounts.get(userId) ?? 0,
    });
  }

  return allocations.sort((a, b) => a.userId.localeCompare(b.userId));
}

/**
 * Largest-remainder distribution (Hare quota).
 * Distributes `total` among users proportionally to their weights.
 * Sum of all shares === total exactly (deterministic rounding).
 *
 * Tie-breaking: when remainders are equal, break by userId (lexicographic ascending).
 * ALL_MATH_BIGINT: pure BigInt arithmetic.
 */
function largestRemainderDistribute(
  total: bigint,
  userWeights: ReadonlyMap<string, bigint>,
  totalWeight: bigint
): Map<string, bigint> {
  const result = new Map<string, bigint>();

  // Calculate floor shares and remainders
  const entries: Array<{
    userId: string;
    floor: bigint;
    remainder: bigint;
  }> = [];

  let floorSum = 0n;

  for (const [userId, weight] of userWeights) {
    // floor = (weight * total) / totalWeight
    const numerator = weight * total;
    const floor = numerator / totalWeight;
    const remainder = numerator % totalWeight;

    entries.push({ userId, floor, remainder });
    result.set(userId, floor);
    floorSum += floor;
  }

  // Distribute remaining units (total - floorSum)
  let remaining = total - floorSum;

  // Sort by remainder descending, then userId ascending for deterministic tie-breaking
  entries.sort((a, b) => {
    if (b.remainder !== a.remainder) {
      return b.remainder > a.remainder ? 1 : -1;
    }
    return a.userId.localeCompare(b.userId);
  });

  for (const entry of entries) {
    if (remaining <= 0n) break;
    result.set(entry.userId, (result.get(entry.userId) ?? 0n) + 1n);
    remaining -= 1n;
  }

  return result;
}
