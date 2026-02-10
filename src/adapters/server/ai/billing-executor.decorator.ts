// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/ai/billing-executor.decorator`
 * Purpose: Decorator that wraps GraphExecutorPort with billing enforcement.
 * Scope: Intercepts usage_report events from the stream, validates via Zod schemas, calls injected BillingCommitFn. Does not execute graphs directly (delegates to inner).
 * Invariants:
 *   - ONE_LEDGER_WRITER: billing commit goes through injected commitFn (features/billing.ts)
 *   - IDEMPOTENT_CHARGES: no change to idempotency key computation (handled by commitFn)
 *   - BILLING_INDEPENDENT_OF_CLIENT: billing fires during stream iteration, not on client connection
 *   - USAGE_FACT_VALIDATED: Zod validation at ingestion boundary (strict for inproc/sandbox, hints for external)
 *   - NO_FEATURES_IMPORT: adapters layer uses DI'd commitFn, never imports from features
 * Side-effects: IO (via injected commitFn → accountService.recordChargeReceipt)
 * Links: GRAPH_EXECUTION.md, ObservabilityGraphExecutorDecorator, RunEventRelay (billing removed), billing.ts
 * @public
 */

import { UsageFactHintsSchema, UsageFactStrictSchema } from "@cogni/ai-core";
import type { Logger } from "pino";
import type {
  GraphExecutorPort,
  GraphRunRequest,
  GraphRunResult,
} from "@/ports";
import type { AiEvent } from "@/types/ai-events";
import type { BillingCommitFn } from "@/types/billing";
import type { RunContext } from "@/types/run-context";
import type { UsageFact } from "@/types/usage";

/**
 * Decorator that wraps GraphExecutorPort with billing enforcement.
 *
 * Intercepts `usage_report` events from the upstream stream, validates the
 * UsageFact via Zod (strict for billing-authoritative executors, hints for
 * external), and calls the injected `commitFn` for each valid fact.
 *
 * `usage_report` events are consumed by the decorator and NOT yielded to
 * the downstream consumer — billing is invisible to callers.
 *
 * Caller MUST consume `stream` to completion for billing side-effects to fire.
 */
export class BillingGraphExecutorDecorator implements GraphExecutorPort {
  constructor(
    private readonly inner: GraphExecutorPort,
    private readonly commitFn: BillingCommitFn,
    private readonly log: Logger
  ) {}

  runGraph(req: GraphRunRequest): GraphRunResult {
    const result = this.inner.runGraph(req);
    return {
      stream: this.wrapStreamWithBilling(result.stream, req),
      final: result.final,
    };
  }

  private async *wrapStreamWithBilling(
    upstream: AsyncIterable<AiEvent>,
    req: GraphRunRequest
  ): AsyncIterable<AiEvent> {
    const context: RunContext = {
      runId: req.runId,
      attempt: 0, // P0: always 0
      ingressRequestId: req.ingressRequestId,
    };

    for await (const event of upstream) {
      if (event.type === "usage_report") {
        await this.handleBilling(event.fact, context);
        continue; // Don't yield usage_report to consumer
      }
      yield event;
    }
  }

  /**
   * Validate and commit a UsageFact from a usage_report event.
   *
   * Per USAGE_FACT_VALIDATED: validates at ingestion boundary.
   * - Billing-authoritative (inproc/sandbox): strict schema, hard failure on invalid
   * - External (langgraph_server/claude_sdk): hints schema, soft skip on invalid
   */
  private async handleBilling(
    fact: UsageFact,
    context: RunContext
  ): Promise<void> {
    const { runId, ingressRequestId } = context;

    try {
      const isBillingAuthoritative =
        fact.executorType === "inproc" || fact.executorType === "sandbox";

      const schema = isBillingAuthoritative
        ? UsageFactStrictSchema
        : UsageFactHintsSchema;

      const validationResult = schema.safeParse(fact);

      if (!validationResult.success) {
        const errors = validationResult.error.format();

        if (isBillingAuthoritative) {
          this.log.error(
            {
              runId,
              ingressRequestId,
              executorType: fact.executorType,
              validationErrors: errors,
              fact,
            },
            "CRITICAL: Invalid UsageFact from billing-authoritative executor - BILLING FAILED"
          );
          throw new Error(
            `Billing failed: invalid UsageFact from ${fact.executorType} (missing usageUnitId or malformed fields)`
          );
        } else {
          this.log.warn(
            {
              runId,
              ingressRequestId,
              executorType: fact.executorType,
              validationErrors: errors,
              fact,
            },
            "External executor emitted invalid UsageFact (telemetry hint only, not authoritative)"
          );
          return; // Skip billing for malformed hints
        }
      }

      await this.commitFn(validationResult.data as UsageFact, context);
    } catch (error) {
      // Propagate validation errors (billing-authoritative hard failures)
      if (error instanceof Error && error.message.includes("Billing failed")) {
        throw error;
      }

      // Log other billing errors but don't propagate (non-blocking)
      this.log.error(
        { err: error, runId },
        "BillingGraphExecutorDecorator: billing commit error swallowed"
      );
    }
  }
}
