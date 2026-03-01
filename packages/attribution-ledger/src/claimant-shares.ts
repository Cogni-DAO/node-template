// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/attribution-ledger/claimant-shares`
 * Purpose: Defines the canonical claimant-share attribution shape and deterministic unit expansion helpers.
 * Scope: Defines claimant-share payloads, a default receipt-backed builder, and deterministic unit splitting. Does not perform I/O or plugin-specific enrichment.
 * Invariants:
 * - CLAIMANTS_ARE_PLURAL: every attribution subject carries `claimantShares[]`, even when only one claimant is present.
 * - CLAIMANTS_CAN_BE_UNRESOLVED: identity claimants may reference provider + external_id without a resolved user_id.
 * - SUBJECT_KIND_OPEN_ENDED: subjectKind is an open string so plugin-defined attribution subjects do not leak into core enums.
 * - SUBJECT_UNITS_EXPLICIT: each subject carries explicit units.
 * - CLAIMANT_SHARE_SPLIT_DETERMINISTIC: unit splitting uses integer math with largest-remainder tiebroken by claimant key.
 * Side-effects: none
 * Links: docs/spec/attribution-ledger.md
 * @public
 */

export const CLAIMANT_SHARES_EVALUATION_REF = "cogni.claimant_shares.v0";
export const CLAIMANT_SHARES_ALGO_REF = "claimant-shares-v0";
export const CLAIMANT_SHARE_DENOMINATOR_PPM = 1_000_000;

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

export interface ClaimantShare {
  readonly claimant: AttributionClaimant;
  readonly sharePpm: number;
}

export interface ClaimantSharesSubject {
  readonly subjectRef: string;
  readonly subjectKind: string;
  readonly units: string;
  readonly source: string | null;
  readonly eventType: string | null;
  readonly receiptIds: readonly string[];
  readonly claimantShares: readonly ClaimantShare[];
  readonly metadata: Record<string, unknown> | null;
}

export interface ClaimantSharesPayload {
  readonly version: 1;
  readonly subjects: readonly ClaimantSharesSubject[];
}

export interface SelectedReceiptForAttribution {
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

export interface ExpandedClaimantUnit {
  readonly subjectRef: string;
  readonly subjectKind: string;
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isValidSharePpm(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= CLAIMANT_SHARE_DENOMINATOR_PPM
  );
}

export function claimantKey(claimant: AttributionClaimant): string {
  if (claimant.kind === "user") return `user:${claimant.userId}`;
  return `identity:${claimant.provider}:${claimant.externalId}`;
}

export function buildDefaultReceiptClaimantSharesPayload(params: {
  receipts: readonly SelectedReceiptForAttribution[];
  weightConfig: Record<string, number>;
}): ClaimantSharesPayload {
  const subjects: ClaimantSharesSubject[] = [];

  for (const receipt of params.receipts) {
    if (!receipt.included) continue;

    const configKey = `${receipt.source}:${receipt.eventType}`;
    const units =
      receipt.weightOverrideMilli ??
      BigInt(params.weightConfig[configKey] ?? 0);
    if (units <= 0n) continue;

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
      subjectKind: "receipt",
      units: units.toString(),
      source: receipt.source,
      eventType: receipt.eventType,
      receiptIds: [receipt.receiptId],
      claimantShares: [
        {
          claimant,
          sharePpm: CLAIMANT_SHARE_DENOMINATOR_PPM,
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

export function parseClaimantSharesPayload(
  payload: Record<string, unknown> | null
): ClaimantSharesPayload | null {
  if (!isRecord(payload) || payload.version !== 1) return null;
  if (!Array.isArray(payload.subjects)) return null;

  const subjects: ClaimantSharesSubject[] = [];

  for (const subject of payload.subjects) {
    if (!isRecord(subject)) return null;
    if (
      !isNonEmptyString(subject.subjectRef) ||
      !isNonEmptyString(subject.subjectKind) ||
      typeof subject.units !== "string" ||
      !Array.isArray(subject.receiptIds) ||
      !Array.isArray(subject.claimantShares)
    ) {
      return null;
    }

    let units: bigint;
    try {
      units = BigInt(subject.units);
    } catch {
      return null;
    }
    if (units < 0n) return null;

    const claimantShares: ClaimantShare[] = [];
    let shareTotal = 0;

    for (const target of subject.claimantShares) {
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
      claimantShares.push({
        claimant,
        sharePpm: target.sharePpm,
      });
    }

    if (
      claimantShares.length === 0 ||
      shareTotal !== CLAIMANT_SHARE_DENOMINATOR_PPM ||
      subject.receiptIds.some((id) => typeof id !== "string")
    ) {
      return null;
    }

    subjects.push({
      subjectRef: subject.subjectRef,
      subjectKind: subject.subjectKind,
      units: units.toString(),
      source: typeof subject.source === "string" ? subject.source : null,
      eventType:
        typeof subject.eventType === "string" ? subject.eventType : null,
      receiptIds: subject.receiptIds,
      claimantShares,
      metadata: isRecord(subject.metadata) ? subject.metadata : null,
    });
  }

  return {
    version: 1,
    subjects,
  };
}

export function expandClaimantUnits(
  payload: ClaimantSharesPayload
): ExpandedClaimantUnit[] {
  const expanded: ExpandedClaimantUnit[] = [];

  for (const subject of payload.subjects) {
    const totalUnits = BigInt(subject.units);
    if (totalUnits <= 0n) continue;

    const provisional = subject.claimantShares.map((target) => {
      const numerator = totalUnits * BigInt(target.sharePpm);
      return {
        claimant: target.claimant,
        floorUnits: numerator / BigInt(CLAIMANT_SHARE_DENOMINATOR_PPM),
        remainder: numerator % BigInt(CLAIMANT_SHARE_DENOMINATOR_PPM),
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
        subjectKind: subject.subjectKind,
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
