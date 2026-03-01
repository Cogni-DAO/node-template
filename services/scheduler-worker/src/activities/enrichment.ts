// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker-service/activities/enrichment`
 * Purpose: Temporal Activities for epoch enrichment — draft evaluation creation and final evaluation building.
 * Scope: Echo enricher (cogni.echo.v0) and claimant-share enricher (cogni.claimant_shares.v0). Both evaluateEpochDraft and buildLockedEvaluations produce evaluations for each enricher. buildClaimantSharesEvaluationData extracts the shared hash computation.
 * Invariants:
 * - ENRICHER_IDEMPOTENT: Same receipts → same hashes → same evaluation.
 * - ENRICHER_DRAFT_ONLY: evaluateEpochDraft writes status='draft' only; buildLockedEvaluations returns data without writing.
 * Side-effects: IO (database via attributionStore)
 * Links: work/items/task.0113.epoch-artifact-pipeline.md
 * @internal
 */

import {
  buildDefaultReceiptClaimantSharesPayload,
  CLAIMANT_SHARES_ALGO_REF,
  CLAIMANT_SHARES_EVALUATION_REF,
  computeArtifactsHash,
  computeEnricherInputsHash,
  sha256OfCanonicalJson,
} from "@cogni/attribution-ledger";

import type { Logger } from "../observability/logger.js";
import type { AttributionStore } from "../ports/index.js";

/** Namespaced evaluation ref for the echo enricher. */
export const ECHO_EVALUATION_REF = "cogni.echo.v0";

/** Algorithm ref for the echo enricher. */
export const ECHO_ALGO_REF = "echo-v0";

/**
 * Dependencies injected into enrichment activities.
 */
export interface EnrichmentActivityDeps {
  readonly attributionStore: AttributionStore;
  readonly nodeId: string;
  readonly logger: Logger;
}

/**
 * Input for evaluateEpochDraft activity.
 */
export interface EvaluateEpochDraftInput {
  readonly epochId: string; // bigint serialized as string for Temporal
}

/**
 * Output from evaluateEpochDraft activity.
 */
export interface EvaluateEpochDraftOutput {
  readonly evaluationRefs: string[];
  readonly receiptCount: number;
}

/**
 * Input for buildLockedEvaluations activity.
 */
export interface BuildLockedEvaluationsInput {
  readonly epochId: string; // bigint serialized as string for Temporal
}

/**
 * Evaluation params serialized for Temporal wire format.
 * All bigint fields represented as decimal strings — Temporal serializes
 * activity args/returns as JSON, and JSON.stringify(bigint) throws.
 * Inside activities, convert back: BigInt(epochId).
 */
export interface UpsertEvaluationParamsWire {
  readonly nodeId: string;
  readonly epochId: string; // bigint as decimal string
  readonly evaluationRef: string;
  readonly status: "draft" | "locked";
  readonly algoRef: string;
  readonly inputsHash: string;
  readonly payloadHash: string;
  readonly payloadJson: Record<string, unknown>;
}

/**
 * Output from buildLockedEvaluations activity.
 */
export interface BuildLockedEvaluationsOutput {
  readonly evaluations: UpsertEvaluationParamsWire[];
  readonly artifactsHash: string;
}

async function buildClaimantSharesEvaluationData(params: {
  readonly epochId: string;
  readonly weightConfig: Record<string, number>;
  readonly receipts: ReadonlyArray<{
    receiptId: string;
    userId: string | null;
    source: string;
    eventType: string;
    included: boolean;
    weightOverrideMilli: bigint | null;
    platformUserId: string;
    payloadHash: string;
    platformLogin: string | null;
    artifactUrl: string | null;
    eventTime: Date;
  }>;
}): Promise<{
  readonly inputsHash: string;
  readonly payloadHash: string;
  readonly payloadJson: Record<string, unknown>;
}> {
  const payloadJson = buildDefaultReceiptClaimantSharesPayload({
    receipts: params.receipts,
    weightConfig: params.weightConfig,
  });
  const payloadHash = await sha256OfCanonicalJson(payloadJson);
  const inputsHash = await sha256OfCanonicalJson({
    epochId: params.epochId,
    weightConfig: params.weightConfig,
    receipts: params.receipts.map((receipt) => ({
      receiptId: receipt.receiptId,
      userId: receipt.userId,
      source: receipt.source,
      eventType: receipt.eventType,
      included: receipt.included,
      weightOverrideMilli: receipt.weightOverrideMilli?.toString() ?? null,
      platformUserId: receipt.platformUserId,
      payloadHash: receipt.payloadHash,
    })),
  });

  return {
    inputsHash,
    payloadHash,
    payloadJson,
  };
}

/**
 * Creates enrichment activity functions with injected dependencies.
 */
export function createEnrichmentActivities(deps: EnrichmentActivityDeps) {
  const { attributionStore, nodeId, logger } = deps;

  /**
   * Build the echo payload from selected receipts.
   * Pure computation — same receipts always produce same payload.
   */
  function buildEchoPayload(
    receipts: ReadonlyArray<{
      receiptId: string;
      eventType: string;
      userId: string;
    }>
  ): Record<string, unknown> {
    const byEventType: Record<string, number> = {};
    const byUserId: Record<string, number> = {};

    for (const r of receipts) {
      byEventType[r.eventType] = (byEventType[r.eventType] ?? 0) + 1;
      byUserId[r.userId] = (byUserId[r.userId] ?? 0) + 1;
    }

    return {
      totalEvents: receipts.length,
      byEventType,
      byUserId,
    };
  }

  /**
   * Evaluate epoch with draft echo evaluation.
   * Writes status='draft' via upsertDraftEvaluation (overwrites on each pass).
   */
  async function evaluateEpochDraft(
    input: EvaluateEpochDraftInput
  ): Promise<EvaluateEpochDraftOutput> {
    const epochId = BigInt(input.epochId);

    logger.info({ epochId: input.epochId }, "Evaluating epoch draft (echo)");

    const epoch = await attributionStore.getEpoch(epochId);
    if (!epoch) {
      throw new Error(`evaluateEpochDraft: epoch ${input.epochId} not found`);
    }

    const receipts =
      await attributionStore.getSelectedReceiptsWithMetadata(epochId);
    const attributionReceipts =
      await attributionStore.getSelectedReceiptsForAttribution(epochId);

    const payload = buildEchoPayload(receipts);
    const payloadHash = await sha256OfCanonicalJson(payload);
    const inputsHash = await computeEnricherInputsHash({
      epochId,
      receipts: receipts.map((r) => ({
        receiptId: r.receiptId,
        receiptPayloadHash: r.payloadHash,
      })),
    });

    await attributionStore.upsertDraftEvaluation({
      nodeId,
      epochId,
      evaluationRef: ECHO_EVALUATION_REF,
      status: "draft",
      algoRef: ECHO_ALGO_REF,
      inputsHash,
      payloadHash,
      payloadJson: payload,
    });

    const claimantSharesEvaluation = await buildClaimantSharesEvaluationData({
      epochId: input.epochId,
      weightConfig: epoch.weightConfig,
      receipts: attributionReceipts,
    });

    await attributionStore.upsertDraftEvaluation({
      nodeId,
      epochId,
      evaluationRef: CLAIMANT_SHARES_EVALUATION_REF,
      status: "draft",
      algoRef: CLAIMANT_SHARES_ALGO_REF,
      inputsHash: claimantSharesEvaluation.inputsHash,
      payloadHash: claimantSharesEvaluation.payloadHash,
      payloadJson: claimantSharesEvaluation.payloadJson,
    });

    logger.info(
      {
        epochId: input.epochId,
        evaluationRefs: [ECHO_EVALUATION_REF, CLAIMANT_SHARES_EVALUATION_REF],
        receiptCount: receipts.length,
      },
      "Draft evaluations written"
    );

    return {
      evaluationRefs: [ECHO_EVALUATION_REF, CLAIMANT_SHARES_EVALUATION_REF],
      receiptCount: receipts.length,
    };
  }

  /**
   * Build final (locked) evaluations for epoch close.
   * Returns evaluation params and artifactsHash — does NOT write to store.
   * The caller (autoCloseIngestion) writes via closeIngestionWithEvaluations atomically.
   */
  async function buildLockedEvaluations(
    input: BuildLockedEvaluationsInput
  ): Promise<BuildLockedEvaluationsOutput> {
    const epochId = BigInt(input.epochId);

    logger.info({ epochId: input.epochId }, "Building locked evaluations");

    const epoch = await attributionStore.getEpoch(epochId);
    if (!epoch) {
      throw new Error(
        `buildLockedEvaluations: epoch ${input.epochId} not found`
      );
    }

    const receipts =
      await attributionStore.getSelectedReceiptsWithMetadata(epochId);
    const attributionReceipts =
      await attributionStore.getSelectedReceiptsForAttribution(epochId);

    const payload = buildEchoPayload(receipts);
    const payloadHash = await sha256OfCanonicalJson(payload);
    const inputsHash = await computeEnricherInputsHash({
      epochId,
      receipts: receipts.map((r) => ({
        receiptId: r.receiptId,
        receiptPayloadHash: r.payloadHash,
      })),
    });

    const evaluation: UpsertEvaluationParamsWire = {
      nodeId,
      epochId: input.epochId, // keep as string for Temporal wire format
      evaluationRef: ECHO_EVALUATION_REF,
      status: "locked",
      algoRef: ECHO_ALGO_REF,
      inputsHash,
      payloadHash,
      payloadJson: payload,
    };

    const claimantSharesEvaluationData =
      await buildClaimantSharesEvaluationData({
        epochId: input.epochId,
        weightConfig: epoch.weightConfig,
        receipts: attributionReceipts,
      });

    const claimantSharesEvaluation: UpsertEvaluationParamsWire = {
      nodeId,
      epochId: input.epochId,
      evaluationRef: CLAIMANT_SHARES_EVALUATION_REF,
      status: "locked",
      algoRef: CLAIMANT_SHARES_ALGO_REF,
      inputsHash: claimantSharesEvaluationData.inputsHash,
      payloadHash: claimantSharesEvaluationData.payloadHash,
      payloadJson: claimantSharesEvaluationData.payloadJson,
    };

    const evaluations = [evaluation, claimantSharesEvaluation];
    const artifactsHash = await computeArtifactsHash(evaluations);

    logger.info(
      {
        epochId: input.epochId,
        evaluationCount: evaluations.length,
        artifactsHash: `${artifactsHash.slice(0, 12)}...`,
      },
      "Locked evaluations built"
    );

    return {
      evaluations,
      artifactsHash,
    };
  }

  return {
    evaluateEpochDraft,
    buildLockedEvaluations,
  };
}

/** Type alias for workflow proxy usage. */
export type EnrichmentActivities = ReturnType<
  typeof createEnrichmentActivities
>;
