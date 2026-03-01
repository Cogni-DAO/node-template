// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/_facades/users/ownership.server`
 * Purpose: Computes an ownership summary for the authenticated user from attribution claim targets and linked identities.
 * Scope: Reads current user's bindings plus epoch claim/evaluation data. Does not handle HTTP transport or persistence writes.
 * Invariants:
 * - CLAIMANTS_ARE_PLURAL: multi-claimant subjects are treated as first-class
 * - OWNERSHIP_MATCHES_LINKED_IDENTITIES: identity claimants resolve through the
 *   user's current bindings at read time
 * - ALL_MATH_BIGINT: ownership totals stay bigint until final JSON conversion
 * Side-effects: IO (database reads)
 * Links: src/contracts/users.ownership.v1.contract.ts
 * @public
 */

import {
  type AttributionClaimant,
  type AttributionClaimSubject,
  type AttributionEpoch,
  type AttributionStore,
  buildDefaultClaimTargetsPayload,
  CLAIM_TARGETS_EVALUATION_REF,
  expandClaimUnits,
  parseClaimTargetsPayload,
} from "@cogni/attribution-ledger";
import { withTenantScope } from "@cogni/db-client";
import { type UserId, userActor } from "@cogni/ids";
import { eq } from "drizzle-orm";

import { getContainer, resolveAppDb } from "@/bootstrap/container";
import type { OwnershipSummaryOutput } from "@/contracts/users.ownership.v1.contract";
import type { SessionUser } from "@/shared/auth";
import { getNodeId } from "@/shared/config";
import { userBindings } from "@/shared/db/schema";

const MAX_RECENT_CLAIMS = 12;

type ClaimMatch = OwnershipSummaryOutput["recentClaims"][number];

function toBindingKey(provider: string, externalId: string): string {
  return `${provider}:${externalId}`;
}

function matchClaimantToUser(
  claimant: AttributionClaimant,
  userId: string,
  bindingKeys: Set<string>
): string | null {
  if (claimant.kind === "user") {
    return claimant.userId === userId ? "user_id" : null;
  }

  const key = toBindingKey(claimant.provider, claimant.externalId);
  if (!bindingKeys.has(key)) return null;
  return claimant.provider;
}

function computeOwnershipPercent(
  numerator: bigint,
  denominator: bigint
): number {
  if (denominator <= 0n || numerator <= 0n) return 0;
  const basisPoints = Number(
    (numerator * 10_000n + denominator / 2n) / denominator
  );
  return basisPoints / 100;
}

function metadataString(
  metadata: Record<string, unknown> | null,
  key: string
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" ? value : null;
}

async function loadClaimSubjectsForEpoch(
  store: AttributionStore,
  epoch: AttributionEpoch
): Promise<readonly AttributionClaimSubject[]> {
  const evaluationStatus = epoch.status === "finalized" ? "locked" : "draft";
  const evaluation = await store.getEvaluation(
    epoch.id,
    CLAIM_TARGETS_EVALUATION_REF,
    evaluationStatus
  );
  const parsed = parseClaimTargetsPayload(evaluation?.payloadJson ?? null);
  if (parsed) return parsed.subjects;

  const receipts = await store.getSelectedReceiptsForClaims(epoch.id);
  return buildDefaultClaimTargetsPayload({
    receipts,
    weightConfig: epoch.weightConfig,
  }).subjects;
}

export async function readOwnershipSummary(
  sessionUser: SessionUser
): Promise<OwnershipSummaryOutput> {
  const db = resolveAppDb();
  const actorId = userActor(sessionUser.id as UserId);

  const bindings = await withTenantScope(db, actorId, async (tx) =>
    tx
      .select({
        provider: userBindings.provider,
        externalId: userBindings.externalId,
      })
      .from(userBindings)
      .where(eq(userBindings.userId, sessionUser.id))
  );

  const bindingKeys = new Set(
    bindings.map((binding) =>
      toBindingKey(binding.provider, binding.externalId)
    )
  );

  const store = getContainer().attributionStore;
  const epochs = await store.listEpochs(getNodeId());
  const epochsDesc = [...epochs].sort((a, b) => Number(b.id - a.id));

  let finalizedUnits = 0n;
  let activeUnits = 0n;
  let finalizedUniverseUnits = 0n;
  let claimsMatched = 0;
  const matchedEpochs = new Set<string>();
  const recentClaims: ClaimMatch[] = [];

  for (const epoch of epochsDesc) {
    const subjects = await loadClaimSubjectsForEpoch(store, epoch);
    const expanded = expandClaimUnits({ version: 1, subjects });

    if (epoch.status === "finalized") {
      finalizedUniverseUnits += expanded.reduce(
        (sum, claim) => sum + claim.units,
        0n
      );
    }

    for (const claim of expanded) {
      const matchedVia = matchClaimantToUser(
        claim.claimant,
        sessionUser.id,
        bindingKeys
      );
      if (!matchedVia) continue;

      claimsMatched++;
      matchedEpochs.add(epoch.id.toString());

      if (epoch.status === "finalized") {
        finalizedUnits += claim.units;
      } else {
        activeUnits += claim.units;
      }

      if (recentClaims.length < MAX_RECENT_CLAIMS) {
        recentClaims.push({
          epochId: epoch.id.toString(),
          epochStatus: epoch.status,
          subjectRef: claim.subjectRef,
          source: claim.source,
          eventType: claim.eventType,
          units: claim.units.toString(),
          matchedVia,
          eventTime: metadataString(claim.metadata, "eventTime"),
          artifactUrl: metadataString(claim.metadata, "artifactUrl"),
        });
      }
    }
  }

  return {
    totalUnits: (finalizedUnits + activeUnits).toString(),
    finalizedUnits: finalizedUnits.toString(),
    activeUnits: activeUnits.toString(),
    ownershipPercent: computeOwnershipPercent(
      finalizedUnits,
      finalizedUniverseUnits
    ),
    epochsMatched: matchedEpochs.size,
    claimsMatched,
    linkedIdentityCount: bindings.length,
    recentClaims,
  };
}
