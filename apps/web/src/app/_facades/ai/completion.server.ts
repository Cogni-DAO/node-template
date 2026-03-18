// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/_facades/ai/completion.server`
 * Purpose: App-layer coordinator for AI completion - session → billing account, delegates to feature layer.
 * Scope: Resolves session user to billing account + virtual key, creates LlmCaller, maps DTOs, normalizes errors. Does not contain business logic or HTTP concerns.
 * Invariants:
 *   - UNIFIED_GRAPH_EXECUTOR: Both chatCompletion() and completionStream() use GraphExecutorPort
 *   - Only app layer imports this; routes call this, not features/* directly
 *   - Must import features via public.ts ONLY (never import from services subdirectories)
 *   - NEVER import adapters (use bootstrap factories instead)
 *   - Per CREDITS_ENFORCED_AT_EXECUTION_PORT: preflight credit check handled by decorator (no facade-level call)
 *   - Validates billing account before delegation; propagates feature errors
 * Side-effects: IO (via resolved dependencies)
 * Notes: chatCompletion() delegates to completionStream() and collects response server-side.
 *   Returns OpenAI-compatible ChatCompletion format.
 * Links: Called by API routes, delegates to features/ai/public.ts, GRAPH_EXECUTION.md
 * @public
 */

import { createHash } from "node:crypto";
import { toUserId } from "@cogni/ids";
import { WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
import {
  getContainer,
  getTemporalWorkflowClient,
  resolveAiAdapterDeps,
} from "@/bootstrap/container";
import {
  createGraphExecutor,
  createScopedGraphExecutor,
} from "@/bootstrap/graph-executor.factory";
import type {
  ChatCompletionOutput,
  ChatMessage,
} from "@/contracts/ai.completions.v1.contract";
import { mapAccountsPortErrorToFeature } from "@/features/accounts/public";
// Types from client-safe barrel (types only, no runtime)
import type { AiEvent, StreamFinalResult } from "@/features/ai/public";
// Import from public.server.ts - never from services/* directly (dep-cruiser enforced)
import {
  createAiRuntime,
  executeStream,
  type MessageDto,
  preflightCreditCheck,
  toCoreMessages,
} from "@/features/ai/public.server";
import { getOrCreateBillingAccountForUser } from "@/lib/auth/mapping";
import type { BillingContext, PreflightCreditCheckFn } from "@/ports";
import {
  isBillingAccountNotFoundPortError,
  isInsufficientCreditsPortError,
  isVirtualKeyNotFoundPortError,
} from "@/ports";
import type { SessionUser } from "@/shared/auth";
import type { RequestContext } from "@/shared/observability";

// ─────────────────────────────────────────────────────────────────────────────
// Default graph for requests that don't specify one
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_GRAPH_NAME = "langgraph:default";

// ─────────────────────────────────────────────────────────────────────────────
// Message conversion: OpenAI → internal MessageDto
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert OpenAI ChatMessage array to internal MessageDto array.
 * Maps OpenAI field names (snake_case) to internal format (camelCase).
 */
export function chatMessagesToDtos(messages: ChatMessage[]): MessageDto[] {
  return messages.map((msg): MessageDto => {
    if (msg.role === "system") {
      return { role: "system", content: msg.content };
    }
    if (msg.role === "user") {
      return { role: "user", content: msg.content };
    }
    if (msg.role === "tool") {
      return {
        role: "tool",
        content: msg.content,
        toolCallId: msg.tool_call_id,
      };
    }
    // assistant
    return {
      role: "assistant",
      content: msg.content ?? "",
      ...(msg.tool_calls && msg.tool_calls.length > 0
        ? {
            toolCalls: msg.tool_calls.map((tc) => ({
              id: tc.id,
              name: tc.function.name,
              arguments: tc.function.arguments,
            })),
          }
        : {}),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared types
// ─────────────────────────────────────────────────────────────────────────────

export interface CompletionInput {
  messages: MessageDto[];
  model: string;
  sessionUser: SessionUser;
  /** Graph name or fully-qualified graphId to execute */
  graphName: string;
  /** Conversation state key for multi-turn conversations */
  stateKey?: string;
  /** Optional idempotency key for workflow deduplication. */
  idempotencyKey?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Finish reason mapping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map internal finish reason to OpenAI-compatible finish_reason.
 */
export function toOpenAiFinishReason(
  reason: string
): "stop" | "length" | "tool_calls" | "content_filter" {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "tool_calls":
      return "tool_calls";
    case "content_filter":
      return "content_filter";
    default:
      return "stop";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// chatCompletion: Non-streaming, returns OpenAI ChatCompletion format
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatCompletionInput {
  messages: ChatMessage[];
  model: string;
  sessionUser: SessionUser;
  /** Graph name or fully-qualified graphId to execute */
  graphName?: string;
  /** Conversation state key for multi-turn conversations */
  stateKey?: string;
}

/**
 * Non-streaming AI completion returning OpenAI ChatCompletion format.
 * Per UNIFIED_GRAPH_EXECUTOR: delegates to completionStream() and collects response server-side.
 * This ensures billing flows through GraphExecutorPort → RunEventRelay → commitUsageFact().
 */
export async function chatCompletion(
  input: ChatCompletionInput,
  ctx: RequestContext
): Promise<ChatCompletionOutput> {
  const messageDtos = chatMessagesToDtos(input.messages);
  const graphName = input.graphName ?? DEFAULT_GRAPH_NAME;

  // Delegate to streaming path (UNIFIED_GRAPH_EXECUTOR)
  const { stream, final } = await completionStream(
    {
      messages: messageDtos,
      model: input.model,
      sessionUser: input.sessionUser,
      graphName,
      ...(input.stateKey ? { stateKey: input.stateKey } : {}),
    },
    ctx
  );

  // Collect text deltas server-side
  const textParts: string[] = [];
  try {
    for await (const event of stream) {
      if (event.type === "text_delta") {
        textParts.push(event.delta);
      }
    }

    // Await final to ensure billing completed via RunEventRelay
    const result = await final;

    if (!result.ok) {
      throw new Error(`Completion failed: ${result.error}`);
    }

    const content = textParts.join("");
    const finishReason = toOpenAiFinishReason(result.finishReason);

    return {
      id: `chatcmpl-${result.requestId}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: input.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content,
            ...(finishReason === "tool_calls" &&
            result.ok &&
            "toolCalls" in result &&
            result.toolCalls
              ? {
                  tool_calls: result.toolCalls.map((tc) => ({
                    id: tc.id,
                    type: "function" as const,
                    function: {
                      name: tc.function.name,
                      arguments: tc.function.arguments,
                    },
                  })),
                }
              : {}),
          },
          finish_reason: finishReason,
        },
      ],
      usage: {
        prompt_tokens: result.usage.promptTokens,
        completion_tokens: result.usage.completionTokens,
        total_tokens: result.usage.promptTokens + result.usage.completionTokens,
      },
    };
  } catch (error) {
    // Map port-level errors to feature errors for route handler.
    if (
      isInsufficientCreditsPortError(error) ||
      isBillingAccountNotFoundPortError(error) ||
      isVirtualKeyNotFoundPortError(error)
    ) {
      throw mapAccountsPortErrorToFeature(error);
    }
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// chatCompletionStream: Streaming, returns AiEvent stream for SSE conversion
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatCompletionStreamInput {
  messages: ChatMessage[];
  model: string;
  sessionUser: SessionUser;
  /** Graph name or fully-qualified graphId to execute */
  graphName?: string;
  /** Conversation state key for multi-turn conversations */
  stateKey?: string;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
}

/**
 * Streaming AI completion. Returns an AiEvent stream and final promise.
 * The route handler converts AiEvents to OpenAI SSE chunk format.
 */
export async function chatCompletionStream(
  input: ChatCompletionStreamInput,
  ctx: RequestContext
): Promise<{
  stream: AsyncIterable<AiEvent>;
  final: Promise<StreamFinalResult>;
}> {
  const messageDtos = chatMessagesToDtos(input.messages);
  const graphName = input.graphName ?? DEFAULT_GRAPH_NAME;

  return completionStream(
    {
      messages: messageDtos,
      model: input.model,
      sessionUser: input.sessionUser,
      graphName,
      ...(input.stateKey ? { stateKey: input.stateKey } : {}),
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    },
    ctx
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// completionStream: shared core (used by chat route AND completions route)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stream chat completion via AI streaming service.
 * App facade responsibility: session → billing account, caller creation, error mapping.
 * NO business logic here - delegates to feature layer via public.ts.
 */
export async function completionStream(
  input: CompletionInput & { abortSignal?: AbortSignal },
  ctx: RequestContext
): Promise<{
  stream: AsyncIterable<AiEvent>;
  final: Promise<StreamFinalResult>;
}> {
  let useInProc = false;
  try {
    const env = getContainer().config;
    useInProc = env.rateLimitBypass.enabled;
  } catch {
    useInProc = true;
  }

  if (useInProc) {
    return completionStreamInProc(input, ctx);
  }

  const userId = toUserId(input.sessionUser.id);
  const { accountService, clock } = resolveAiAdapterDeps(userId);
  const billingAccount = await getOrCreateBillingAccountForUser(
    accountService,
    {
      userId: input.sessionUser.id,
      ...(input.sessionUser.walletAddress
        ? { walletAddress: input.sessionUser.walletAddress }
        : {}),
    }
  );

  const idempotencyKey = input.idempotencyKey?.trim() || `api:${ctx.reqId}`;
  const graphId = input.graphName.includes(":")
    ? input.graphName
    : `langgraph:${input.graphName}`;
  const runId = createHash("sha256")
    .update(`${billingAccount.id}:${idempotencyKey}`, "utf8")
    .digest("hex")
    .slice(0, 32)
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");

  const stateKey = input.stateKey ?? runId;
  const workflowId = `graph-run:${billingAccount.id}:${idempotencyKey}`;
  const coreMessages = toCoreMessages(input.messages, clock.now()).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const workflowClient = await getTemporalWorkflowClient();
  try {
    await workflowClient.workflow.start("GraphRunWorkflow", {
      taskQueue: "scheduler-tasks",
      workflowId,
      args: [
        {
          runId,
          graphId,
          executionGrantId: null,
          input: {
            messages: coreMessages,
            model: input.model,
            stateKey,
            actorUserId: input.sessionUser.id,
            ...(input.sessionUser.walletAddress
              ? { walletAddress: input.sessionUser.walletAddress }
              : {}),
          },
          runKind: "user_immediate" as const,
          triggerSource: "api",
          triggerRef: idempotencyKey,
          requestedBy: input.sessionUser.id,
        },
      ],
    });
  } catch (error) {
    if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  input.abortSignal?.addEventListener("abort", onAbort, { once: true });

  let resolveFinal: ((result: StreamFinalResult) => void) | undefined;
  const final = new Promise<StreamFinalResult>((resolve) => {
    resolveFinal = resolve;
  });
  const usage = { promptTokens: 0, completionTokens: 0 };

  const stream = (async function* (): AsyncIterable<AiEvent> {
    try {
      for await (const { event } of getContainer().runStream.subscribe(
        runId,
        controller.signal
      )) {
        if (event.type === "usage_report") {
          usage.promptTokens += event.fact.inputTokens ?? 0;
          usage.completionTokens += event.fact.outputTokens ?? 0;
          continue;
        }
        if (event.type === "error") {
          resolveFinal?.({ ok: false, requestId: runId, error: event.error });
          yield event;
          return;
        }
        if (event.type === "done") {
          resolveFinal?.({
            ok: true,
            requestId: runId,
            usage,
            finishReason: "stop",
          });
          yield event;
          return;
        }
        yield event;
      }
      resolveFinal?.({ ok: false, requestId: runId, error: "internal" });
    } catch {
      resolveFinal?.({ ok: false, requestId: runId, error: "internal" });
    } finally {
      input.abortSignal?.removeEventListener("abort", onAbort);
    }
  })();

  return { stream, final };
}

async function completionStreamInProc(
  input: CompletionInput & { abortSignal?: AbortSignal },
  ctx: RequestContext
): Promise<{
  stream: AsyncIterable<AiEvent>;
  final: Promise<StreamFinalResult>;
}> {
  const userId = toUserId(input.sessionUser.id);
  const { accountService, clock } = resolveAiAdapterDeps(userId);

  const preflightCheckFn: PreflightCreditCheckFn = (
    billingAccountId,
    model,
    messages
  ) =>
    preflightCreditCheck({
      billingAccountId,
      messages: [...messages],
      model,
      accountService,
    });

  const graphExecutor = createGraphExecutor(executeStream, userId);
  const billingAccount = await getOrCreateBillingAccountForUser(
    accountService,
    {
      userId: input.sessionUser.id,
      ...(input.sessionUser.walletAddress
        ? { walletAddress: input.sessionUser.walletAddress }
        : {}),
    }
  );

  const billing: BillingContext = {
    billingAccountId: billingAccount.id,
    virtualKeyId: billingAccount.defaultVirtualKeyId,
  };

  const enrichedCtx: RequestContext = {
    ...ctx,
    log: ctx.log.child({
      userId: input.sessionUser.id,
      billingAccountId: billingAccount.id,
    }),
  };

  const coreMessages = toCoreMessages(input.messages, clock.now());
  const scopedGraphExecutor = createScopedGraphExecutor({
    executor: graphExecutor,
    billing,
    preflightCheckFn,
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  });

  const aiRuntime = createAiRuntime({
    graphExecutor: scopedGraphExecutor,
  });

  return aiRuntime.runChatStream(
    {
      messages: coreMessages,
      model: input.model,
      graphName: input.graphName,
      ...(input.stateKey ? { stateKey: input.stateKey } : {}),
    },
    enrichedCtx
  );
}
