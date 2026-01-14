// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/ai/langgraph/dev/stream-translator`
 * Purpose: Translates LangGraph SDK stream events to AiEvents.
 * Scope: Converts chunk.event + chunk.data from SDK to text_delta, assistant_final, usage_report, done. Does NOT emit tool events (P1).
 * Invariants:
 *   - SDK_CHUNK_SHAPE: SDK uses chunk.event + chunk.data (not event.type)
 *   - AI_CORE_IS_CANONICAL_OUTPUT: Emits only ai-core events
 *   - P0_NO_TOOL_EVENT_STREAMING: No tool events in MVP
 *   - GRAPH_FINALIZATION_ONCE: Exactly one done event per run
 * Side-effects: none
 * Links: LANGGRAPH_SERVER.md (MVP section)
 * @internal
 */

import type { LlmCaller } from "@/ports";
import { makeLogger } from "@/shared/observability";
import type {
  AiEvent,
  AssistantFinalEvent,
  DoneEvent,
  TextDeltaEvent,
  UsageReportEvent,
} from "@/types/ai-events";
import type { UsageFact } from "@/types/usage";

const log = makeLogger({ component: "langgraph-server-stream-translator" });

/**
 * SDK stream chunk shape.
 * Per SDK_CHUNK_SHAPE: uses event + data, not type.
 */
export interface SdkStreamChunk {
  readonly event: string;
  readonly data: unknown;
}

/**
 * Run context for usage reporting.
 */
export interface StreamRunContext {
  readonly runId: string;
  readonly attempt: number;
  readonly caller: LlmCaller;
}

/**
 * Extract text delta from SDK chunk data.
 * Handles messages-tuple stream mode.
 *
 * @param data - Chunk data from SDK
 * @returns Text delta if found, undefined otherwise
 */
function extractTextDelta(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;

  const obj = data as Record<string, unknown>;

  // messages-tuple mode: data is array or array-like with keys "0", "1"
  // SDK returns [messageChunk, metadata] tuple
  const messageChunk = Array.isArray(data) ? data[0] : obj["0"];

  if (messageChunk && typeof messageChunk === "object") {
    const chunk = messageChunk as Record<string, unknown>;

    // MVP: Only extract from AI messages (type === "ai")
    // TODO(P1): Properly handle all message types per LangGraph SDK specification
    if (chunk.type !== "ai") {
      log.warn(
        { messageType: chunk.type },
        "Dropping non-AI message chunk. MVP limitation: need to read LangGraph SDK docs for proper message type handling."
      );
      return undefined;
    }

    // AIMessageChunk has content field
    if (typeof chunk.content === "string" && chunk.content.length > 0) {
      return chunk.content;
    }
  }

  return undefined;
}

/**
 * Build usage report event.
 * Per MVP Known Limitations: no usageUnitId or costUsd available.
 *
 * @param ctx - Run context
 * @returns Usage report event
 */
function buildUsageReport(ctx: StreamRunContext): UsageReportEvent {
  const fact: UsageFact = {
    runId: ctx.runId,
    attempt: ctx.attempt,
    source: "litellm",
    executorType: "langgraph_server",
    billingAccountId: ctx.caller.billingAccountId,
    virtualKeyId: ctx.caller.virtualKeyId,
    // MVP: tokens unavailable from server path
    // These will be populated when billing parity is achieved in P1
  };

  return { type: "usage_report", fact };
}

/**
 * Translate LangGraph SDK stream to AiEvents.
 *
 * Per SDK_CHUNK_SHAPE: SDK uses chunk.event + chunk.data.
 * Per AI_CORE_IS_CANONICAL_OUTPUT: emits only ai-core events.
 * Per P0_NO_TOOL_EVENT_STREAMING: no tool events in MVP.
 *
 * Stream sequence: text_delta* → assistant_final → usage_report → done
 *
 * @param sdkStream - Async iterable from SDK runs.stream()
 * @param ctx - Run context for usage reporting
 * @yields AiEvent stream
 */
export async function* translateDevServerStream(
  sdkStream: AsyncIterable<SdkStreamChunk>,
  ctx: StreamRunContext
): AsyncIterable<AiEvent> {
  let accumulatedContent = "";

  for await (const chunk of sdkStream) {
    switch (chunk.event) {
      case "messages": {
        // messages-tuple mode: data is array-like with keys "0", "1"
        const delta = extractTextDelta(chunk.data);
        if (delta) {
          accumulatedContent += delta;
          const textEvent: TextDeltaEvent = { type: "text_delta", delta };
          yield textEvent;
        }
        break;
      }

      case "metadata":
        // Run metadata - ignore in MVP
        break;

      case "error": {
        // Error event - log and continue (error handling in final)
        // Per AI_CORE_IS_CANONICAL_OUTPUT: emit error event
        yield { type: "error", error: "internal" } as AiEvent;
        break;
      }

      // Other events (metadata, updates, etc.) - ignore in MVP
      default:
        break;
    }
  }

  // Always emit exactly one assistant_final on success
  const finalEvent: AssistantFinalEvent = {
    type: "assistant_final",
    content: accumulatedContent,
  };
  yield finalEvent;

  // Emit usage_report (best-effort in MVP)
  yield buildUsageReport(ctx);

  // Emit done event (GRAPH_FINALIZATION_ONCE)
  const doneEvent: DoneEvent = { type: "done" };
  yield doneEvent;
}
