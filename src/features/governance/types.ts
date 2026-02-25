// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/governance/types`
 * Purpose: View model types for governance UI — client-side composition of ledger API data.
 * Scope: Type-only module. No runtime imports. These are NOT API contracts; they are UI view models
 * composed from multiple ledger endpoints by hooks.
 * Invariants:
 *   - ALL_MATH_BIGINT: credit/unit values are strings (BigInt serialized)
 *   - avatar/color are placeholder defaults until a profile system exists
 * Side-effects: none
 * Links: src/contracts/ledger.list-epochs.v1.contract.ts, src/contracts/ledger.epoch-allocations.v1.contract.ts
 * @public
 */

/** A single activity event as displayed in the UI. */
export interface ActivityEvent {
  readonly artifactUrl: string | null;
  readonly eventTime: string;
  readonly eventType: string;
  readonly id: string;
  readonly platformLogin: string | null;
  readonly source: string;
}

/** A contributor row within an epoch view. */
export interface EpochContributor {
  readonly activities: readonly ActivityEvent[];
  readonly activityCount: number;
  readonly avatar: string;
  readonly color: string;
  readonly creditShare: number;
  readonly displayName: string | null;
  readonly finalUnits: string | null;
  readonly proposedUnits: string;
  readonly userId: string;
}

/** Composite view of a single epoch (current or historical). */
export interface EpochView {
  readonly contributors: readonly EpochContributor[];
  readonly id: string;
  readonly periodEnd: string;
  readonly periodStart: string;
  readonly poolTotalCredits: string | null;
  readonly status: "open" | "review" | "finalized";
}

/** Hook return shape for current epoch. */
export interface CurrentEpochData {
  readonly epoch: EpochView | null;
}

/** Hook return shape for epoch history. */
export interface EpochHistoryData {
  readonly epochs: readonly EpochView[];
}

/** A single user's cumulative holdings. */
export interface HoldingView {
  readonly avatar: string;
  readonly color: string;
  readonly displayName: string | null;
  readonly epochsContributed: number;
  readonly ownershipPercent: number;
  readonly totalCredits: string;
  readonly userId: string;
}

/** Hook return shape for holdings. */
export interface HoldingsData {
  readonly epochsCompleted: number;
  readonly holdings: readonly HoldingView[];
  readonly totalContributors: number;
  readonly totalCreditsIssued: string;
}
