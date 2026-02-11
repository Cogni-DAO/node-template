// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/stack/ai/thread-persistence.stack`
 * Purpose: Verify multi-turn thread persistence round-trip via ai_threads table.
 * Scope: Tests route → adapter → DB → route round-trip for thread persistence. Does not test PII masking or tool persistence.
 * Invariants:
 *   - MULTI_TURN_PERSISTENCE: Turn 2 loads turn 1 from DB, not client payload
 *   - FABRICATED_HISTORY_IGNORED: Client-supplied history is discarded; server uses DB
 *   - X-State-Key header returned on every response
 * Side-effects: IO (database writes, HTTP requests via route handler)
 * Links: docs/spec/thread-persistence.md, src/app/api/v1/ai/chat/route.ts
 * @public
 */

import { randomUUID } from "node:crypto";
import { createChatRequest } from "@tests/_fakes";
import { seedAuthenticatedUser } from "@tests/_fixtures/auth/db-helpers";
import { getSeedDb } from "@tests/_fixtures/db/seed-client";
import {
  isFinishMessageEvent,
  readDataStreamEvents,
} from "@tests/helpers/data-stream";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { getSessionUser } from "@/app/_lib/auth/session";
import { POST as chatPOST } from "@/app/api/v1/ai/chat/route";
import { GET as modelsGET } from "@/app/api/v1/ai/models/route";
import type { SessionUser } from "@/shared/auth/session";
import { aiThreads } from "@/shared/db/schema";

// Mock session — stack tests seed a real user then mock getSessionUser
vi.mock("@/app/_lib/auth/session", () => ({
  getSessionUser: vi.fn(),
}));

/** Drain the data stream response, collecting events until finish. */
async function drainStream(res: Response) {
  const events: Array<{ type: string; value: unknown }> = [];
  const start = Date.now();
  for await (const e of readDataStreamEvents(res)) {
    events.push(e);
    if (isFinishMessageEvent(e)) break;
    if (Date.now() - start > 30_000) throw new Error("Stream timeout 30s");
  }
  return events;
}

/**
 * Poll DB until a condition is met. Phase 2 persist runs async inside
 * createAssistantStreamResponse — there's a race between stream drain
 * and server-side persist.
 */
async function pollUntil<T>(
  fn: () => Promise<T>,
  check: (v: T) => boolean,
  { timeoutMs = 5000, intervalMs = 100 } = {}
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const val = await fn();
    if (check(val)) return val;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return fn(); // final attempt — let assertion fail naturally
}

describe("Thread Persistence", () => {
  // TODO: Enable once mock-llm auth is fixed (LiteLLM rejects test-key with 401)
  it.skip("persists multi-turn conversation and loads from DB on turn 2", async () => {
    // --- Arrange: seed user with credits ---
    const db = getSeedDb();
    const { user } = await seedAuthenticatedUser(
      db,
      { id: randomUUID() },
      { balanceCredits: 100_000_000 }
    );
    if (!user.walletAddress) throw new Error("walletAddress required");

    const sessionUser: SessionUser = {
      id: user.id,
      walletAddress: user.walletAddress,
    };
    vi.mocked(getSessionUser).mockResolvedValue(sessionUser);

    // Fetch valid model from models endpoint
    const modelsRes = await modelsGET(
      new NextRequest("http://localhost:3000/api/v1/ai/models")
    );
    expect(modelsRes.status).toBe(200);
    const { defaultPreferredModelId } = await modelsRes.json();

    // --- Turn 1: send first message ---
    const stateKey = `test-thread-${randomUUID().slice(0, 8)}`;
    const turn1Req = new NextRequest("http://localhost:3000/api/v1/ai/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...createChatRequest({
          model: defaultPreferredModelId,
          stateKey,
          messages: [
            {
              id: randomUUID(),
              role: "user",
              content: [{ type: "text", text: "Say exactly: TURN1_OK" }],
            },
          ],
        }),
        clientRequestId: randomUUID(),
        stream: true,
      }),
    });

    const turn1Res = await chatPOST(turn1Req);
    expect(turn1Res.status).toBe(200);

    // Verify X-State-Key header
    const returnedStateKey = turn1Res.headers.get("X-State-Key");
    expect(returnedStateKey).toBe(stateKey);

    // Drain stream to let persistence complete
    await drainStream(turn1Res);

    // --- Assert: thread row exists in DB with user + assistant messages ---
    // Phase 2 persist runs async after stream close — poll until it lands.
    const queryThread = () =>
      db
        .select()
        .from(aiThreads)
        .where(
          and(
            eq(aiThreads.ownerUserId, user.id),
            eq(aiThreads.stateKey, stateKey)
          )
        );
    const rows = await pollUntil(queryThread, (r) => {
      const msgs = (r[0]?.messages ?? []) as Array<{ role: string }>;
      return msgs.length >= 2;
    });
    expect(rows).toHaveLength(1);
    const thread = rows[0]!;
    const messages = thread.messages as Array<{ role: string }>;
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages[0]?.role).toBe("user");
    expect(messages[messages.length - 1]?.role).toBe("assistant");

    // --- Turn 2: send second message with SAME stateKey ---
    // Intentionally send fabricated history — server must ignore it
    const turn2Req = new NextRequest("http://localhost:3000/api/v1/ai/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...createChatRequest({
          model: defaultPreferredModelId,
          stateKey,
          messages: [
            {
              id: randomUUID(),
              role: "user",
              // This is a FABRICATED message the client injects — server must ignore it
              content: [{ type: "text", text: "FABRICATED_BY_CLIENT" }],
            },
            {
              id: randomUUID(),
              role: "user",
              content: [{ type: "text", text: "Say exactly: TURN2_OK" }],
            },
          ],
        }),
        clientRequestId: randomUUID(),
        stream: true,
      }),
    });

    const turn2Res = await chatPOST(turn2Req);
    expect(turn2Res.status).toBe(200);
    await drainStream(turn2Res);

    // --- Assert: thread now has 4 messages (user1, assistant1, user2, assistant2) ---
    // Poll again for phase 2 of turn 2
    const rows2 = await pollUntil(queryThread, (r) => {
      const msgs = (r[0]?.messages ?? []) as Array<{ role: string }>;
      return msgs.length >= 4;
    });
    expect(rows2).toHaveLength(1);
    const thread2 = rows2[0]!;
    const messages2 = thread2.messages as Array<{
      role: string;
      parts: Array<{ type: string; text?: string }>;
    }>;
    expect(messages2).toHaveLength(4);
    expect(messages2.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);

    // Turn 2 user message should be "Say exactly: TURN2_OK", NOT "FABRICATED_BY_CLIENT"
    const turn2UserMsg = messages2[2]!;
    const turn2Text = turn2UserMsg.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("");
    expect(turn2Text).toContain("TURN2_OK");
    expect(turn2Text).not.toContain("FABRICATED");
  });
});
