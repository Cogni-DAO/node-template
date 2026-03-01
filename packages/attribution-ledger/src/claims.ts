// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/attribution-ledger/claims`
 * Purpose: Defines pure domain types and helpers for multi-claimant attribution.
 * Scope: Defines claimant-share payloads, default receipt-backed claims, and deterministic unit splitting. Does not perform I/O or store access.
 * Invariants:
 * - CLAIMANTS_ARE_PLURAL: every attribution subject carries `claimants[]`, even
 *   when only one claimant is present.
 * - CLAIMS_CAN_BE_UNRESOLVED: identity claimants may reference provider +
 *   external_id without a resolved user_id.
 * - CLAIM_SUBJECT_UNITS_EXPLICIT: each subject carries explicit `subjectUnits`
 *   so plugin evaluators can attribute work-item or custom units directly.
 * - CLAIM_SPLIT_DETERMINISTIC: unit splitting uses integer math with
 *   largest-remainder tiebroken by claimant key.
 * Side-effects: none
 * Links: docs/spec/attribution-ledger.md
 * @public
 */

export const CLAIM_TARGETS_EVALUATION_REF = "cogni.claim_targets.v0";
export const CLAIM_TARGETS_ALGO_REF = "claim-targets-v0";
export const CLAIM_SHARE_DENOMINATOR_PPM = 1_000_000;

export interface UserClaimant {
  readonly kind: "user";
  readonly userId: string;
}

export interface IdentityClaimant {
  readonly kind: "identity";
  readonly provider: string;
  readonly externalId: string;
  readonly providerLogin: string | null;
}

export type AttributionClaimant = UserClaimant | IdentityClaimant;

export interface AttributionClaimTarget {
  readonly claimant: AttributionClaimant;
  readonly sharePpm: number;
}

export interface AttributionClaimSubject {
  readonly subjectRef: string;
  readonly subjectType: "receipt" | "work_item" | "custom";
  readonly subjectUnits: string;
  readonly source: string | null;
  readonly eventType: string | null;
  readonly receiptIds: readonly string[];
  readonly claimants: readonly AttributionClaimTarget[];
  readonly metadata: Record<string, unknown> | null;
}

export interface ClaimTargetsPayload {
  readonly version: 1;
  readonly subjects: readonly AttributionClaimSubject[];
}

export interface SelectedReceiptForClaims {
  readonly receiptId: string;
  readonly userId: string | null;
  readonly source: string;
  readonly eventType: string;
  readonly included: boolean;
  readonly weightOverrideMilli: bigint | null;
  readonly platformUserId: string;
  readonly platformLogin: string | null;
  readonly artifactUrl: string | null;
  readonly eventTime: Date;
  readonly payloadHash: string;
}

export interface ExpandedClaimUnit {
  readonly subjectRef: string;
  readonly subjectType: AttributionClaimSubject["subjectType"];
  readonly source: string | null;
  readonly eventType: string | null;
  readonly receiptIds: readonly string[];
  readonly claimant: AttributionClaimant;
  readonly units: bigint;
  readonly metadata: Record<string, unknown> | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidSharePpm(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= CLAIM_SHARE_DENOMINATOR_PPM
  );
}

export function claimantKey(claimant: AttributionClaimant): string {
  if (claimant.kind === "user") return `user:${claimant.userId}`;
  return `identity:${claimant.provider}:${claimant.externalId}`;
}

export function buildDefaultClaimTargetsPayload(params: {
  receipts: readonly SelectedReceiptForClaims[];
  weightConfig: Record<string, number>;
}): ClaimTargetsPayload {
  const subjects: AttributionClaimSubject[] = [];

  for (const receipt of params.receipts) {
    if (!receipt.included) continue;

    const configKey = `${receipt.source}:${receipt.eventType}`;
    const subjectUnits =
      receipt.weightOverrideMilli ??
      BigInt(params.weightConfig[configKey] ?? 0);
    if (subjectUnits <= 0n) continue;

    const claimant: AttributionClaimant = receipt.userId
      ? {
          kind: "user",
          userId: receipt.userId,
        }
      : {
          kind: "identity",
          provider: receipt.source,
          externalId: receipt.platformUserId,
          providerLogin: receipt.platformLogin,
        };

    subjects.push({
      subjectRef: receipt.receiptId,
      subjectType: "receipt",
      subjectUnits: subjectUnits.toString(),
      source: receipt.source,
      eventType: receipt.eventType,
      receiptIds: [receipt.receiptId],
      claimants: [
        {
          claimant,
          sharePpm: CLAIM_SHARE_DENOMINATOR_PPM,
        },
      ],
      metadata: {
        artifactUrl: receipt.artifactUrl,
        eventTime: receipt.eventTime.toISOString(),
        platformLogin: receipt.platformLogin,
        platformUserId: receipt.platformUserId,
        payloadHash: receipt.payloadHash,
      },
    });
  }

  return {
    version: 1,
    subjects,
  };
}

export function parseClaimTargetsPayload(
  payload: Record<string, unknown> | null
): ClaimTargetsPayload | null {
  if (!isRecord(payload) || payload.version !== 1) return null;
  if (!Array.isArray(payload.subjects)) return null;

  const subjects: AttributionClaimSubject[] = [];

  for (const subject of payload.subjects) {
    if (!isRecord(subject)) return null;
    if (
      typeof subject.subjectRef !== "string" ||
      (subject.subjectType !== "receipt" &&
        subject.subjectType !== "work_item" &&
        subject.subjectType !== "custom") ||
      typeof subject.subjectUnits !== "string" ||
      !Array.isArray(subject.receiptIds) ||
      !Array.isArray(subject.claimants)
    ) {
      return null;
    }

    let units: bigint;
    try {
      units = BigInt(subject.subjectUnits);
    } catch {
      return null;
    }
    if (units < 0n) return null;

    const claimants: AttributionClaimTarget[] = [];
    let shareTotal = 0;

    for (const target of subject.claimants) {
      if (!isRecord(target) || !isValidSharePpm(target.sharePpm)) return null;
      if (!isRecord(target.claimant)) return null;

      let claimant: AttributionClaimant;
      if (
        target.claimant.kind === "user" &&
        typeof target.claimant.userId === "string"
      ) {
        claimant = {
          kind: "user",
          userId: target.claimant.userId,
        };
      } else if (
        target.claimant.kind === "identity" &&
        typeof target.claimant.provider === "string" &&
        typeof target.claimant.externalId === "string" &&
        (typeof target.claimant.providerLogin === "string" ||
          target.claimant.providerLogin === null)
      ) {
        claimant = {
          kind: "identity",
          provider: target.claimant.provider,
          externalId: target.claimant.externalId,
          providerLogin: target.claimant.providerLogin,
        };
      } else {
        return null;
      }

      shareTotal += target.sharePpm;
      claimants.push({
        claimant,
        sharePpm: target.sharePpm,
      });
    }

    if (
      claimants.length === 0 ||
      shareTotal !== CLAIM_SHARE_DENOMINATOR_PPM ||
      subject.receiptIds.some((id) => typeof id !== "string")
    ) {
      return null;
    }

    subjects.push({
      subjectRef: subject.subjectRef,
      subjectType: subject.subjectType,
      subjectUnits: units.toString(),
      source: typeof subject.source === "string" ? subject.source : null,
      eventType:
        typeof subject.eventType === "string" ? subject.eventType : null,
      receiptIds: subject.receiptIds,
      claimants,
      metadata: isRecord(subject.metadata) ? subject.metadata : null,
    });
  }

  return {
    version: 1,
    subjects,
  };
}

export function expandClaimUnits(
  payload: ClaimTargetsPayload
): ExpandedClaimUnit[] {
  const expanded: ExpandedClaimUnit[] = [];

  for (const subject of payload.subjects) {
    const totalUnits = BigInt(subject.subjectUnits);
    if (totalUnits <= 0n) continue;

    const provisional = subject.claimants.map((target) => {
      const numerator = totalUnits * BigInt(target.sharePpm);
      return {
        claimant: target.claimant,
        floorUnits: numerator / BigInt(CLAIM_SHARE_DENOMINATOR_PPM),
        remainder: numerator % BigInt(CLAIM_SHARE_DENOMINATOR_PPM),
      };
    });

    let remainderUnits =
      totalUnits - provisional.reduce((sum, item) => sum + item.floorUnits, 0n);

    provisional.sort((a, b) => {
      if (a.remainder === b.remainder) {
        return claimantKey(a.claimant).localeCompare(claimantKey(b.claimant));
      }
      return a.remainder > b.remainder ? -1 : 1;
    });

    for (const item of provisional) {
      const extra = remainderUnits > 0n ? 1n : 0n;
      if (remainderUnits > 0n) remainderUnits--;

      expanded.push({
        subjectRef: subject.subjectRef,
        subjectType: subject.subjectType,
        source: subject.source,
        eventType: subject.eventType,
        receiptIds: subject.receiptIds,
        claimant: item.claimant,
        units: item.floorUnits + extra,
        metadata: subject.metadata,
      });
    }
  }

  return expanded.sort((a, b) => {
    const subjectCompare = a.subjectRef.localeCompare(b.subjectRef);
    if (subjectCompare !== 0) return subjectCompare;
    return claimantKey(a.claimant).localeCompare(claimantKey(b.claimant));
  });
}
