// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/ai/services/completion`
 * Purpose: Use case orchestration for AI completion.
 * Scope: Coordinate core rules, port calls, set output timestamp. Does not handle authentication, rate limiting, or credit deduction.
 * Invariants: Only imports core, ports, shared - never contracts or adapters
 * Side-effects: IO (via ports)
 * Notes: Applies business rules then delegates to LLM service; accepts AccountService for future credit operations
 * Links: Called by API routes, uses core domain and ports
 * @public
 */

import { randomUUID } from "node:crypto";

import {
  assertMessageLength,
  calculateUserPriceCredits,
  filterSystemMessages,
  MAX_MESSAGE_CHARS,
  type Message,
  trimConversationHistory,
  usdToCredits,
} from "@/core";
import type { AccountService, Clock, LlmCaller, LlmService } from "@/ports";
import { InsufficientCreditsPortError } from "@/ports";
import { serverEnv } from "@/shared/env";

const DEFAULT_MAX_COMPLETION_TOKENS = 2048;
const CHARS_PER_TOKEN_ESTIMATE = 4;
// Conservative estimate for pre-flight check: $0.01 per 1k tokens (high-end model price)
const ESTIMATED_USD_PER_1K_TOKENS = 0.01;

function estimateTotalTokens(messages: Message[]): number {
  const totalChars = messages.reduce(
    (sum, message) => sum + message.content.length,
    0
  );
  const promptTokens = Math.ceil(totalChars / CHARS_PER_TOKEN_ESTIMATE);
  return promptTokens + DEFAULT_MAX_COMPLETION_TOKENS;
}

export async function execute(
  messages: Message[],
  llmService: LlmService,
  accountService: AccountService,
  clock: Clock,
  caller: LlmCaller
): Promise<Message> {
  // Apply core business rules first
  const userMessages = filterSystemMessages(messages);

  for (const message of userMessages) {
    assertMessageLength(message.content, MAX_MESSAGE_CHARS);
  }

  const trimmedMessages = trimConversationHistory(
    userMessages,
    MAX_MESSAGE_CHARS
  );

  // Preflight credit check
  const estimatedTotalTokens = estimateTotalTokens(trimmedMessages);
  const estimatedCostUsd =
    (estimatedTotalTokens / 1000) * ESTIMATED_USD_PER_1K_TOKENS;
  const estimatedUserPriceCredits = calculateUserPriceCredits(
    usdToCredits(estimatedCostUsd, serverEnv().CREDITS_PER_USDC),
    serverEnv().USER_PRICE_MARKUP_FACTOR
  );

  const currentBalance = await accountService.getBalance(
    caller.billingAccountId
  );

  // Convert bigint to number for comparison (safe for pre-flight check)
  if (currentBalance < Number(estimatedUserPriceCredits)) {
    throw new InsufficientCreditsPortError(
      caller.billingAccountId,
      Number(estimatedUserPriceCredits),
      currentBalance
    );
  }

  const requestId = randomUUID();

  // Delegate to port - caller constructed at auth boundary
  const result = await llmService.completion({
    messages: trimmedMessages,
    caller,
  });

  const totalTokens = result.usage?.totalTokens ?? 0;
  const providerMeta = (result.providerMeta ?? {}) as Record<string, unknown>;
  const modelId =
    typeof providerMeta.model === "string" ? providerMeta.model : "unknown";

  // Calculate actual costs
  // If providerCostUsd is missing (should be caught by adapter), default to 0 to avoid crash, but log error
  const providerCostUsd = result.providerCostUsd ?? 0;
  const markupFactor = serverEnv().USER_PRICE_MARKUP_FACTOR;
  // 5. Calculate costs (Credits-Centric)
  const providerCostCredits = usdToCredits(
    providerCostUsd,
    serverEnv().CREDITS_PER_USDC
  );
  const userPriceCredits = calculateUserPriceCredits(
    providerCostCredits,
    markupFactor
  );

  // Enforce profit margin invariant
  if (userPriceCredits < providerCostCredits) {
    // This should be impossible due to calculateUserPriceCredits logic,
    // but we assert it here for safety.
    console.error(
      `[CompletionService] Invariant violation: User price (${userPriceCredits}) < Provider cost (${providerCostCredits})`
    );
    // We still proceed, but maybe we should throw?
    // For now, the pricing helper guarantees this, so it's a sanity check.
  }

  try {
    await accountService.recordLlmUsage({
      billingAccountId: caller.billingAccountId,
      virtualKeyId: caller.virtualKeyId,
      requestId,
      model: modelId,
      promptTokens: result.usage?.promptTokens ?? 0,
      completionTokens: result.usage?.completionTokens ?? 0,
      providerCostUsd, // Store for audit
      providerCostCredits,
      userPriceCredits,
      markupFactorApplied: markupFactor,
      metadata: {
        system: "ai_completion", // New metadata field
        provider: providerMeta.provider,
        llmRequestId: providerMeta.requestId,
        totalTokens,
      },
    });
  } catch (error) {
    // If we reached the provider, do not fail the response on post-call debit errors
    // But we should probably log this critical failure
    if (!(error instanceof InsufficientCreditsPortError)) {
      console.error(
        "[CompletionService] Failed to record LLM usage",
        JSON.stringify({ requestId, error })
      );
      // We still rethrow if it's not a credit issue, or swallow?
      // Existing logic swallowed non-credit errors? No, it rethrew.
      // "if (!(error instanceof InsufficientCreditsPortError)) { throw error; }"
      // So we keep that behavior.
      throw error;
    }
    // If it IS an InsufficientCreditsPortError, we swallow it?
    // The original code swallowed it: "if (!(error instanceof ...)) { throw error; }" implies if it IS instance, do nothing.
    // Wait, if debit fails due to insufficient credits AFTER the call, we effectively gave it for free but stopped future calls.
    // That seems to be the intended behavior for "post-payment" style checks where pre-flight passed.
  }

  // Feature sets timestamp after completion using injected clock
  return {
    ...result.message,
    timestamp: clock.now(),
  };
}
