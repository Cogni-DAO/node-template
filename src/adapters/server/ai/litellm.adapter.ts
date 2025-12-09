// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/ai/litellm`
 * Purpose: LiteLLM service implementation for AI completion and streaming with cost extraction and runtime secret validation.
 * Scope: Implements LlmService port (completion + stream), extracts cost from headers, validates secrets at adapter boundary. Does not handle auth or rate-limiting.
 * Invariants: Never logs prompts/keys/chunks; 30s timeout (completion), 15s connect timeout (stream); settles once; model required.
 * Side-effects: IO (HTTP calls to LiteLLM)
 * Notes: SSE via eventsource-parser; assertRuntimeSecrets() before fetch; logs only bounded metadata (no content).
 * Links: LlmService port, serverEnv, assertRuntimeSecrets, defer<T>() for promise settlement
 * @internal
 */

import {
  createParser,
  type EventSourceMessage,
  type EventSourceParser,
} from "eventsource-parser";
import type { ChatDeltaEvent, LlmService } from "@/ports";
import { serverEnv } from "@/shared/env";
import { assertRuntimeSecrets } from "@/shared/env/invariants";
import { makeLogger } from "@/shared/observability";

const logger = makeLogger({ component: "LiteLlmAdapter" });

/**
 * Create a deferred promise with resolve/reject callbacks.
 * Ensures promise settles exactly once.
 */
function defer<T>() {
  let settled = false;
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = (value) => {
      if (!settled) {
        settled = true;
        res(value);
      }
    };
    reject = (reason) => {
      if (!settled) {
        settled = true;
        rej(reason);
      }
    };
  });
  return { promise, resolve, reject };
}

/**
 * Extract provider cost from LiteLLM response headers.
 * Quarantines null at the boundary and returns number | undefined.
 */
function getProviderCostFromHeaders(response: Response): number | undefined {
  const raw = response.headers.get("x-litellm-response-cost");
  if (!raw || raw.trim().length === 0) return undefined;

  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Extract LiteLLM call ID from response headers for forensic correlation.
 * Returns undefined if header is absent or empty.
 */
function getLitellmCallIdFromHeaders(response: Response): string | undefined {
  const raw = response.headers.get("x-litellm-call-id");
  if (!raw || raw.trim().length === 0) return undefined;
  return raw.trim();
}

export class LiteLlmAdapter implements LlmService {
  async completion(
    params: Parameters<LlmService["completion"]>[0]
  ): ReturnType<LlmService["completion"]> {
    // Model must be provided by caller (route validates via contract)
    if (!params.model) {
      throw new Error("LiteLLM completion requires model parameter");
    }
    const model = params.model;
    const temperature = params.temperature ?? 0.7;
    const maxTokens = params.maxTokens ?? 2048;

    // Extract caller data for user attribution (cost tracking in LiteLLM)
    const { billingAccountId } = params.caller;

    // Convert core Messages to LiteLLM format
    const liteLlmMessages = params.messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    const requestBody = {
      model,
      messages: liteLlmMessages,
      temperature,
      max_tokens: maxTokens,
      user: billingAccountId, // LiteLLM user tracking for cost attribution
      metadata: {
        cogni_billing_account_id: billingAccountId,
      },
    };

    try {
      const env = serverEnv();
      // Validate runtime secrets at adapter boundary (not in serverEnv to avoid breaking Next.js build)
      assertRuntimeSecrets(env);

      // HTTP call to LiteLLM with timeout enforcement
      // Uses LITELLM_MASTER_KEY (server-only secret) - never expose per-user virtual keys
      const response = await fetch(
        `${env.LITELLM_BASE_URL}/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.LITELLM_MASTER_KEY}`,
          },
          body: JSON.stringify(requestBody),
          /** 30 second timeout */
          signal: AbortSignal.timeout(30000),
        }
      );

      if (!response.ok) {
        throw new Error(
          `LiteLLM API error: ${response.status} ${response.statusText}`
        );
      }

      // Read cost and call ID from response headers
      const providerCostFromHeader = getProviderCostFromHeaders(response);
      const litellmCallId = getLitellmCallIdFromHeaders(response);

      const data = (await response.json()) as {
        id?: string;
        choices: { message: { content: string }; finish_reason?: string }[];
        usage: {
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens?: number;
        };
      };

      if (
        !data.choices ||
        data.choices.length === 0 ||
        !data.choices[0]?.message ||
        typeof data.choices[0].message.content !== "string"
      ) {
        throw new Error("Invalid response from LiteLLM");
      }

      // Build result object conditionally to satisfy exactOptionalPropertyTypes
      const promptTokens = Number(data.usage?.prompt_tokens) || 0;
      const completionTokens = Number(data.usage?.completion_tokens) || 0;
      const totalTokens = data.usage?.total_tokens
        ? Number(data.usage.total_tokens)
        : promptTokens + completionTokens;

      const result: Awaited<ReturnType<LlmService["completion"]>> = {
        message: {
          role: "assistant",
          content: data.choices[0].message.content,
        },
        usage: {
          promptTokens,
          completionTokens,
          totalTokens,
        },
        providerMeta: data as unknown as Record<string, unknown>,
      };

      // Add optional fields only when present
      if (data.choices[0].finish_reason) {
        result.finishReason = data.choices[0].finish_reason;
      }

      if (typeof providerCostFromHeader === "number") {
        result.providerCostUsd = providerCostFromHeader;
      }

      // Prefer response body id (gen-...) for join with /spend/logs
      if (data.id) {
        result.litellmCallId = data.id;
      } else if (litellmCallId) {
        result.litellmCallId = litellmCallId;
      }

      // Sanitized adapter log (no content, bounded fields only)
      logger.info(
        {
          model,
          tokensUsed: totalTokens,
          finishReason: result.finishReason,
          hasCost: typeof providerCostFromHeader === "number",
          hasCallId: !!litellmCallId,
          contentLength: data.choices[0].message.content.length,
        },
        "adapter.litellm.completion_result"
      );

      return result;
    } catch (error) {
      // Map provider errors to typed errors (no stack leaks)
      if (error instanceof Error) {
        throw new Error(`LiteLLM completion failed: ${error.message}`);
      }
      throw new Error("LiteLLM completion failed: Unknown error");
    }
  }

  async completionStream(
    params: Parameters<LlmService["completionStream"]>[0]
  ): ReturnType<LlmService["completionStream"]> {
    // Model must be provided by caller (route validates via contract)
    if (!params.model) {
      throw new Error("LiteLLM completionStream requires model parameter");
    }
    const model = params.model;
    const temperature = params.temperature ?? 0.7;
    const maxTokens = params.maxTokens ?? 2048;
    const { billingAccountId } = params.caller;

    const liteLlmMessages = params.messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    const requestBody = {
      model,
      messages: liteLlmMessages,
      temperature,
      max_tokens: maxTokens,
      user: billingAccountId, // LiteLLM user tracking for cost attribution
      metadata: {
        cogni_billing_account_id: billingAccountId,
      },
      stream: true,
      stream_options: { include_usage: true }, // Request usage in stream if supported
    };

    let response: Response;
    // Use short timeout for connection/TTFB only (not entire stream duration)
    const connectCtl = new AbortController();
    const connectTimer = setTimeout(() => connectCtl.abort(), 15000);
    const env = serverEnv();
    // Validate runtime secrets at adapter boundary
    assertRuntimeSecrets(env);

    try {
      const signal = params.abortSignal
        ? AbortSignal.any([connectCtl.signal, params.abortSignal])
        : connectCtl.signal;

      // Uses LITELLM_MASTER_KEY (server-only secret) - never expose per-user virtual keys
      response = await fetch(`${env.LITELLM_BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.LITELLM_MASTER_KEY}`,
        },
        body: JSON.stringify(requestBody),
        signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw error; // Propagate abort immediately
      }
      throw new Error(
        `LiteLLM stream init failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    } finally {
      clearTimeout(connectTimer);
    }

    if (!response.ok) {
      throw new Error(
        `LiteLLM API error: ${response.status} ${response.statusText}`
      );
    }

    // Capture response.body to prove non-null to TypeScript
    const body = response.body;
    if (!body) {
      throw new Error("LiteLLM response body is empty");
    }

    // Capture cost and call ID from headers if available immediately (unlikely for stream)
    const providerCostUsd = getProviderCostFromHeaders(response);
    const litellmCallId = getLitellmCallIdFromHeaders(response);

    // Create a deferred promise for the final result (matches completion() return type)
    type CompletionResult = Awaited<ReturnType<LlmService["completion"]>>;
    const deferred = defer<CompletionResult>();

    const stream: AsyncIterable<ChatDeltaEvent> =
      (async function* (): AsyncGenerator<ChatDeltaEvent> {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let fullContent = "";
        let finalUsage:
          | {
              promptTokens: number;
              completionTokens: number;
              totalTokens: number;
            }
          | undefined;
        let finishReason: string | undefined;
        let usageCost: number | undefined; // Cost from stream usage event
        let litellmRequestId: string | undefined; // LiteLLM's gen-... ID from response

        // Queue for parsed events from eventsource-parser
        const eventQueue: EventSourceMessage[] = [];

        const parser: EventSourceParser = createParser({
          onEvent(event: EventSourceMessage) {
            eventQueue.push(event);
          },
        });

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // Feed decoded chunk to eventsource-parser
            const chunk = decoder.decode(value, { stream: true });
            parser.feed(chunk);

            // Process all queued events
            while (eventQueue.length > 0) {
              const event = eventQueue.shift();
              if (!event) break;
              const data = event.data;

              if (data === "[DONE]") {
                yield { type: "done" } as const;
                continue;
              }

              try {
                const json = JSON.parse(data);

                // Capture LiteLLM request ID (gen-...) from first chunk for join with /spend/logs
                if (json.id && !litellmRequestId) {
                  litellmRequestId = json.id;
                }

                // Check for provider error in response
                if (json.error) {
                  const errorMsg =
                    typeof json.error === "string"
                      ? json.error
                      : json.error.message || "Provider error";
                  const errorText = `LiteLLM stream error: ${errorMsg}`;
                  yield { type: "error", error: errorText } as const;
                  deferred.reject(new Error(errorText));
                  return;
                }

                if (json.usage) {
                  finalUsage = {
                    promptTokens: json.usage.prompt_tokens,
                    completionTokens: json.usage.completion_tokens,
                    totalTokens: json.usage.total_tokens,
                  };
                  // Extract cost from usage event (stream_options: { include_usage: true })
                  if (
                    typeof json.usage.cost === "number" &&
                    Number.isFinite(json.usage.cost)
                  ) {
                    usageCost = json.usage.cost;
                  }
                }

                const choice = json.choices?.[0];
                if (choice) {
                  if (choice.finish_reason) {
                    finishReason = choice.finish_reason;
                  }

                  const content = choice.delta?.content;
                  if (content) {
                    fullContent += content;
                    yield { type: "text_delta", delta: content } as const;
                  }
                }
              } catch (parseError) {
                // Log malformed JSON but continue streaming (transient SSE noise)
                const errorMessage =
                  parseError instanceof Error
                    ? parseError.message
                    : "JSON parse error";
                logger.warn(
                  { dataLength: data.length },
                  `Malformed SSE data: ${errorMessage}`
                );
                // Do not yield error - continue processing remaining events
              }
            }
          }
        } catch (error: unknown) {
          if (error instanceof Error && error.name === "AbortError") {
            // Stream aborted - resolve final with partial content, no error yield
          } else {
            // Real stream failure
            deferred.reject(error);
            return;
          }
        } finally {
          reader.releaseLock();
          // Build result object conditionally to satisfy exactOptionalPropertyTypes
          const result: CompletionResult = {
            message: { role: "assistant", content: fullContent },
          };
          if (finalUsage) {
            result.usage = finalUsage;
          }
          if (finishReason) {
            result.finishReason = finishReason;
          }

          // Cost derivation priority (ACTIVITY_METRICS.md §3):
          // 1. Header (providerCostUsd from x-litellm-response-cost)
          // 2. Usage event (usageCost from stream usage.cost)
          // 3. Neither → undefined (will log CRITICAL in completion.ts)
          const derivedCost =
            typeof providerCostUsd === "number" ? providerCostUsd : usageCost;

          if (typeof derivedCost === "number") {
            result.providerCostUsd = derivedCost;
          }

          // Prefer response body id (gen-...) for join with /spend/logs
          // Fall back to header UUID if response id not available
          if (litellmRequestId) {
            result.litellmCallId = litellmRequestId;
          } else if (litellmCallId) {
            result.litellmCallId = litellmCallId;
          }

          // ALWAYS include providerMeta with model (SSE doesn't return this, use request param)
          result.providerMeta = {
            model,
            provider: "litellm",
          };

          // Invariant enforcement: model must be set
          if (!result.providerMeta.model) {
            logger.warn(
              { model, hasUsage: !!finalUsage },
              "inv_stream_missing_provider_meta: Stream result missing providerMeta.model"
            );
          }

          // Sanitized adapter log (no content, bounded fields only)
          logger.info(
            {
              model: result.providerMeta.model,
              provider: result.providerMeta.provider,
              tokensUsed: finalUsage?.totalTokens,
              finishReason,
              hasCost: typeof derivedCost === "number",
              hasCallId: !!litellmCallId,
              contentLength: fullContent.length,
            },
            "adapter.litellm.stream_result"
          );
          deferred.resolve(result);
        }
      })();

    return {
      stream,
      final: deferred.promise,
    };
  }
}
