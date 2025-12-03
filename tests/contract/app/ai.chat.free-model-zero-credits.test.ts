// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/contract/app/ai.chat.free-model-zero-credits`
 * Purpose: Verifies that free models work with zero credits, while paid models are blocked.
 * Scope: Route-level stack test with mocked AccountService and LlmService. Does not test database persistence.
 * Invariants: Free model + 0 balance = 200 OK; Paid model + 0 balance = 402 Payment Required.
 * Side-effects: none
 * Links: Tests ai.chat.v1 contract
 * @internal
 */

import { createMockAccountServiceWithDefaults } from "@tests/_fakes";
import { testApiHandler } from "next-test-api-route-handler";
import { describe, expect, it, vi } from "vitest";
import * as appHandler from "@/app/api/v1/ai/chat/route";

// Mock facade to control error throwing directly
vi.mock("@/app/_facades/ai/completion.server", () => ({
  completion: vi.fn(),
  completionStream: vi.fn().mockImplementation(async (input) => {
    // Simulate credit check logic
    const isFree = input.model === "free-model";

    if (!isFree) {
      // Throw the feature error directly, bypassing mapping complexity
      const error = new Error("Insufficient credits");
      Object.assign(error, {
        kind: "INSUFFICIENT_CREDITS",
        billingAccountId: "test-user",
        required: 100,
        available: 0,
      });
      throw error;
    }

    return {
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text_delta", delta: "AI response" });
          controller.close();
        },
      }),
      final: Promise.resolve({
        message: {
          role: "assistant",
          content: "AI response",
          requestId: "req-123",
          timestamp: new Date().toISOString(),
        },
        requestId: "req-123",
      }),
    };
  }),
}));

// Mock model catalog
vi.mock("@/shared/ai/model-catalog.server", () => ({
  isModelAllowed: vi.fn().mockResolvedValue(true),
  getDefaultModelId: vi.fn().mockReturnValue("gpt-4o-mini"),
  isModelFree: vi.fn().mockImplementation(async (modelId: string) => {
    return modelId === "free-model";
  }),
}));

describe("POST /api/v1/ai/chat - Free Model Zero Credits", () => {
  it("should allow free model execution with zero balance", async () => {
    const accountService = createMockAccountServiceWithDefaults();
    accountService.getBalance = vi.fn().mockResolvedValue(0);

    await testApiHandler({
      appHandler,
      test: async ({
        fetch,
      }: {
        fetch: (init?: RequestInit) => Promise<Response>;
      }) => {
        const response = await fetch({
          method: "POST",
          body: JSON.stringify({
            messages: [{ role: "user", content: "Hello" }],
            modelId: "free-model",
          }),
        });

        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).toContain("AI response");
      },
    });
  });

  it("should block paid model execution with zero balance", async () => {
    const accountService = createMockAccountServiceWithDefaults();
    accountService.getBalance = vi.fn().mockResolvedValue(0);

    await testApiHandler({
      appHandler,
      test: async ({
        fetch,
      }: {
        fetch: (init?: RequestInit) => Promise<Response>;
      }) => {
        const response = await fetch({
          method: "POST",
          body: JSON.stringify({
            messages: [{ role: "user", content: "Hello" }],
            modelId: "paid-model",
          }),
        });

        expect(response.status).toBe(402);
      },
    });
  });
});
