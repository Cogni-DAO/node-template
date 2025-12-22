// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/ai/inproc-graph`
 * Purpose: In-process graph executor adapter wrapping existing LLM completion flow.
 * Scope: Implements GraphExecutorPort for direct LLM calls. Does not handle multi-step graphs (P1).
 * Invariants:
 *   - UNIFIED_GRAPH_EXECUTOR: All execution flows through GraphExecutorPort
 *   - GRAPH_LLM_VIA_COMPLETION: Delegates to completion.executeStream for billing/telemetry
 *   - P0_ATTEMPT_FREEZE: attempt is always 0 (no run persistence)
 *   - GRAPH_FINALIZATION_ONCE: Exactly one done event and final resolution per run
 * Side-effects: IO (via injected completion function)
 * Links: ports/graph-executor.port.ts, features/ai/services/completion.ts, GRAPH_EXECUTION.md
 * @public
 */

import type { Logger } from "pino";

import type {
  AccountService,
  AiTelemetryPort,
  ChatDeltaEvent,
  Clock,
  GraphExecutorPort,
  GraphFinal,
  GraphRunRequest,
  GraphRunResult,
  LangfusePort,
  LlmService,
} from "@/ports";
import type { RequestContext } from "@/shared/observability";
import { makeLogger } from "@/shared/observability";
import type { AiEvent, DoneEvent, TextDeltaEvent } from "@/types/ai-events";

/**
 * Dependencies for InProcGraphExecutorAdapter.
 * All required for delegation to completion.executeStream.
 */
export interface InProcGraphExecutorDeps {
  readonly llmService: LlmService;
  readonly accountService: AccountService;
  readonly clock: Clock;
  readonly aiTelemetry: AiTelemetryPort;
  readonly langfuse: LangfusePort | undefined;
}

/**
 * Completion stream result shape.
 */
export interface CompletionStreamResult {
  stream: AsyncIterable<ChatDeltaEvent>;
  final: Promise<
    | {
        ok: true;
        requestId: string;
        usage: { promptTokens: number; completionTokens: number };
        finishReason: string;
      }
    | {
        ok: false;
        requestId: string;
        error: "timeout" | "aborted" | "internal";
      }
  >;
}

/**
 * Completion stream parameters.
 */
export interface CompletionStreamParams {
  messages: GraphRunRequest["messages"];
  model: string;
  llmService: LlmService;
  accountService: AccountService;
  clock: Clock;
  caller: GraphRunRequest["caller"];
  ctx: RequestContext;
  aiTelemetry: AiTelemetryPort;
  langfuse: LangfusePort | undefined;
  abortSignal?: AbortSignal;
}

/**
 * Completion function signature matching executeStream.
 * Defined here to avoid importing from features layer.
 */
export type CompletionStreamFn = (
  params: CompletionStreamParams
) => Promise<CompletionStreamResult>;

/**
 * In-process graph executor adapter.
 * Wraps existing completion flow behind GraphExecutorPort interface.
 *
 * P0: Single-node "graphs" (direct LLM calls). Multi-step graphs in P1.
 */
export class InProcGraphExecutorAdapter implements GraphExecutorPort {
  private readonly log: Logger;

  constructor(
    private readonly deps: InProcGraphExecutorDeps,
    private readonly completionStream: CompletionStreamFn
  ) {
    this.log = makeLogger({ component: "InProcGraphExecutorAdapter" });
  }

  /**
   * Execute a graph with the given request.
   * Returns immediately with stream handle; execution happens on consumption.
   *
   * Per GRAPH_EXECUTION.md:
   * - P0_ATTEMPT_FREEZE: attempt is always 0
   * - GRAPH_LLM_VIA_COMPLETION: delegates to completion.executeStream
   *
   * TODO(P0): When completion.ts stops calling recordBilling(), this adapter must
   * emit UsageReportEvent on stream for billing subscriber. See GRAPH_EXECUTION.md
   * checklist item: "Refactor completion.ts: emit usage_report event only".
   */
  runGraph(req: GraphRunRequest): GraphRunResult {
    const { runId, ingressRequestId, messages, model, caller, abortSignal } =
      req;
    const attempt = 0; // P0_ATTEMPT_FREEZE

    // Create RequestContext for completion layer
    // Per RUNID_IS_CANONICAL: reqId = ingressRequestId (delivery correlation), not runId
    const ctx = this.createRequestContext(ingressRequestId);

    this.log.debug(
      { runId, attempt, model, messageCount: messages.length },
      "InProcGraphExecutorAdapter.runGraph starting"
    );

    // Start completion asynchronously
    // The completion promise is created lazily when the stream is consumed
    const completionPromiseHolder: {
      promise?: ReturnType<CompletionStreamFn>;
    } = {};

    const getCompletionPromise = async () => {
      if (!completionPromiseHolder.promise) {
        completionPromiseHolder.promise = this.completionStream({
          messages,
          model,
          llmService: this.deps.llmService,
          accountService: this.deps.accountService,
          clock: this.deps.clock,
          caller,
          ctx,
          aiTelemetry: this.deps.aiTelemetry,
          langfuse: this.deps.langfuse,
          ...(abortSignal && { abortSignal }),
        });
      }
      return completionPromiseHolder.promise;
    };

    // Create transformed stream (lazy execution)
    const stream = this.createTransformedStream(getCompletionPromise, runId);

    // Create wrapped final promise
    const final = this.createFinalPromise(getCompletionPromise, runId);

    return { stream, final };
  }

  /**
   * Create RequestContext for completion layer.
   * Uses ingressRequestId as reqId (delivery-layer correlation).
   */
  private createRequestContext(ingressRequestId: string): RequestContext {
    return {
      log: this.log.child({ ingressRequestId }),
      reqId: ingressRequestId,
      traceId: this.generateTraceId(),
      routeId: "graph.inproc",
      clock: this.deps.clock,
    };
  }

  /**
   * Generate a trace ID for distributed tracing.
   * Format: 32 hex chars (128 bits) per W3C Trace Context.
   */
  private generateTraceId(): string {
    // Simple random trace ID for P0; production would use OTel SDK
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  /**
   * Transform ChatDeltaEvents to AiEvents.
   * Adds done event at stream end per GRAPH_FINALIZATION_ONCE.
   */
  private async *createTransformedStream(
    getCompletionPromise: () => Promise<
      Awaited<ReturnType<CompletionStreamFn>>
    >,
    runId: string
  ): AsyncIterable<AiEvent> {
    const { stream } = await getCompletionPromise();

    for await (const event of stream) {
      switch (event.type) {
        case "text_delta": {
          const textEvent: TextDeltaEvent = {
            type: "text_delta",
            delta: event.delta,
          };
          yield textEvent;
          break;
        }
        case "error":
          // Errors handled via final promise, not stream events
          this.log.warn({ runId, error: event }, "Stream error event");
          break;
        case "done": {
          // Emit done event per GRAPH_FINALIZATION_ONCE
          const doneEvent: DoneEvent = { type: "done" };
          yield doneEvent;
          return;
        }
      }
    }

    // If stream ends without done event, emit one
    const doneEvent: DoneEvent = { type: "done" };
    yield doneEvent;
  }

  /**
   * Wrap completion final promise to GraphFinal format.
   */
  private async createFinalPromise(
    getCompletionPromise: () => Promise<
      Awaited<ReturnType<CompletionStreamFn>>
    >,
    runId: string
  ): Promise<GraphFinal> {
    const { final } = await getCompletionPromise();
    const result = await final;

    if (result.ok) {
      return {
        ok: true,
        runId,
        requestId: result.requestId,
        usage: {
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
        },
        finishReason: result.finishReason,
      };
    }

    return {
      ok: false,
      runId,
      requestId: result.requestId,
      error: result.error,
    };
  }
}
