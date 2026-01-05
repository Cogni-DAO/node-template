// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/inproc/runner`
 * Purpose: InProc graph execution runner for Next.js server runtime.
 * Scope: Creates queue, wires dependencies, executes graph, emits events. Does NOT import from src/.
 * Invariants:
 *   - SINGLE_QUEUE_PER_RUN: Runner creates queue, passes emit to createToolExecFn
 *   - ASSISTANT_FINAL_REQUIRED: Emits exactly one assistant_final event on success; none on error
 *   - NO_AWAIT_IN_TOKEN_PATH: tokenSink.push() is synchronous
 *   - RESULT_REFLECTS_OUTCOME: final.ok matches stream success/failure
 * Side-effects: IO (executes graph, emits events)
 * Links: LANGGRAPH_AI.md
 * @public
 */

import type { AiEvent } from "@cogni/ai-core";
import type { BaseMessage } from "@langchain/core/messages";

import { createChatGraph } from "../graphs/chat/graph";
import { AsyncQueue } from "../runtime/async-queue";
import { CompletionUnitLLM } from "../runtime/completion-unit-llm";
import { toLangChainTools } from "../runtime/langchain-tools";
import { toBaseMessage } from "../runtime/message-converters";

import type { GraphResult, InProcRunnerOptions } from "./types";

/**
 * Extract text content from final assistant message.
 * LangGraph returns messages array; last message is assistant response.
 */
function extractAssistantContent(messages: BaseMessage[]): string {
  if (messages.length === 0) return "";

  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) return "";

  if (typeof lastMessage.content === "string") {
    return lastMessage.content;
  }

  if (Array.isArray(lastMessage.content)) {
    return lastMessage.content
      .filter(
        (part): part is { type: "text"; text: string } =>
          typeof part === "object" &&
          part !== null &&
          "type" in part &&
          part.type === "text"
      )
      .map((part) => part.text)
      .join("");
  }

  return "";
}

/**
 * Create InProc chat runner.
 *
 * Per SINGLE_QUEUE_PER_RUN: Runner creates queue internally.
 * Per ASSISTANT_FINAL_REQUIRED: Emits exactly one assistant_final event.
 *
 * @param opts - Runner options
 * @returns { stream, final } - AsyncIterable of events and Promise of result
 */
export function createInProcChatRunner(opts: InProcRunnerOptions): {
  stream: AsyncIterable<AiEvent>;
  final: Promise<GraphResult>;
} {
  const { completionFn, createToolExecFn, toolContracts, request } = opts;

  // SINGLE_QUEUE_PER_RUN: Runner creates queue, all events flow here
  const queue = new AsyncQueue<AiEvent>();

  const emit = (e: AiEvent): void => {
    queue.push(e);
  };

  const tokenSink = { push: emit };
  const toolExecFn = createToolExecFn(emit);
  const llm = new CompletionUnitLLM(completionFn, request.model, tokenSink);
  const tools = toLangChainTools({
    contracts: toolContracts,
    exec: toolExecFn,
  });
  const graph = createChatGraph({ llm, tools });

  const final = (async (): Promise<GraphResult> => {
    try {
      const messages = request.messages.map(toBaseMessage);
      const result = await graph.invoke(
        { messages },
        { signal: request.abortSignal }
      );

      const assistantContent = extractAssistantContent(result.messages);
      const usage = llm.getCollectedUsage();

      // ASSISTANT_FINAL_REQUIRED: exactly one per run
      emit({ type: "assistant_final", content: assistantContent });
      emit({ type: "done" });

      return { ok: true, usage, finishReason: "stop" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const isAbort = error instanceof Error && error.name === "AbortError";

      emit({ type: "error", error: isAbort ? "aborted" : message });

      return { ok: false, error: isAbort ? "aborted" : message };
    } finally {
      queue.close();
    }
  })();

  return { stream: queue, final };
}
