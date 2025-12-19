// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/ai/ai.facade`
 * Purpose: Single AI entrypoint that decides graph vs direct LLM and emits UiEvents.
 * Scope: Generates graphRunId for graph executions; returns AsyncIterable<UiEvent>. Does not touch wire protocol encoding.
 * Invariants:
 *   - AI_FACADE_EMITS_UIEVENTS: Only emits UiEvents (text_delta, tool_call_start, tool_call_result, done)
 *   - FACADE_STREAMS_ASYNC_ITERABLE: Returns AsyncIterable<UiEvent>, no buffering
 *   - Route layer maps UiEvents to assistant-stream format
 * Side-effects: IO (via injected LlmService)
 * Notes: P1 supports direct LLM streaming; graph support added when graphs are implemented
 * Links: types.ts, tool-runner.ts, llm.port.ts, AI_SETUP_SPEC.md
 * @public
 */

import { randomUUID } from "node:crypto";

import type { Message } from "@/core";
import type { AccountService, LlmCaller, LlmService } from "@/ports";
import type { RequestContext } from "@/shared/observability";

import type { DoneEvent, TextDeltaEvent, UiEvent } from "./types";

/**
 * Input for AI facade operations.
 */
export interface AiFacadeInput {
  /** Conversation messages */
  readonly messages: Message[];
  /** Model identifier */
  readonly model: string;
  /** Caller info for billing and telemetry */
  readonly caller: LlmCaller;
  /** Abort signal for cancellation */
  readonly abortSignal?: AbortSignal;
}

/**
 * Dependencies for AI facade.
 * Injected at construction to enable testing and DI.
 */
export interface AiFacadeDeps {
  readonly llmService: LlmService;
  readonly accountService: AccountService;
}

/**
 * AI facade result with stream and completion promise.
 */
export interface AiFacadeResult {
  /** Stream of UI events for real-time rendering */
  readonly stream: AsyncIterable<UiEvent>;
  /** Promise resolving when stream completes (for billing/telemetry) */
  readonly final: Promise<{ requestId: string }>;
}

/**
 * Create an AI facade instance with injected dependencies.
 *
 * @param deps - Injected service dependencies
 * @returns Facade with streamChat method
 */
export function createAiFacade(deps: AiFacadeDeps) {
  const { llmService } = deps;

  /**
   * Stream a chat response as UiEvents.
   * P1: Direct LLM streaming only. Graph support in future.
   *
   * Per FACADE_STREAMS_ASYNC_ITERABLE: Returns immediately, streams via AsyncIterable.
   * Per AI_FACADE_EMITS_UIEVENTS: Only emits text_delta, tool_call_start, tool_call_result, done.
   *
   * @param input - Chat input (messages, model, caller)
   * @param ctx - Request context for logging/telemetry
   * @returns Stream of UiEvents and completion promise
   */
  async function streamChat(
    input: AiFacadeInput,
    ctx: RequestContext
  ): Promise<AiFacadeResult> {
    const { messages, model, caller, abortSignal } = input;
    const requestId = ctx.reqId;

    // P1: Direct LLM path only
    // Future: Check if this request should use a graph, generate graphRunId if so
    const { stream: llmStream, final: llmFinal } =
      await llmService.completionStream({
        messages,
        model,
        caller,
        ...(abortSignal ? { abortSignal } : {}),
      });

    // Transform LLM ChatDeltaEvents to UiEvents
    const uiEventStream = transformToUiEvents(llmStream);

    // Wrap final promise to return requestId
    const finalPromise = llmFinal.then(() => ({ requestId }));

    return {
      stream: uiEventStream,
      final: finalPromise,
    };
  }

  /**
   * Generate a graph run ID for graph executions.
   * Per AI_SETUP_SPEC.md: Facade is sole owner of graphRunId generation.
   *
   * @returns Unique graph run ID
   */
  function generateGraphRunId(): string {
    return randomUUID();
  }

  return {
    streamChat,
    generateGraphRunId,
  };
}

/**
 * Transform LLM ChatDeltaEvents to UiEvents.
 * Maps port-level events to feature-level UI events.
 */
async function* transformToUiEvents(
  llmStream: AsyncIterable<
    | { type: "text_delta"; delta: string }
    | { type: "error"; error: string }
    | { type: "done" }
  >
): AsyncIterable<UiEvent> {
  for await (const event of llmStream) {
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
        // Log error but don't emit to UI - the stream will complete with error
        // Errors are handled at route level
        break;
      case "done": {
        const doneEvent: DoneEvent = {
          type: "done",
        };
        yield doneEvent;
        break;
      }
    }
  }
}

/**
 * Type for the AI facade instance.
 */
export type AiFacade = ReturnType<typeof createAiFacade>;
