// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/adapters/server/ai/billing-executor-decorator.spec`
 * Purpose: Unit tests for BillingGraphExecutorDecorator billing validation and stream wrapping.
 * Scope: Tests Zod validation (strict for inproc/sandbox, hints for external), commitFn invocation, usage_report consumption, and error propagation. Does not test actual DB writes.
 * Invariants: ONE_LEDGER_WRITER, USAGE_FACT_VALIDATED, BILLING_INDEPENDENT_OF_CLIENT
 * Side-effects: none
 * Links: src/adapters/server/ai/billing-executor.decorator.ts, GRAPH_EXECUTION.md
 * @internal
 */

import {
  buildExternalUsageFact,
  buildInprocUsageFact,
  buildSandboxUsageFact,
} from "@tests/_fakes";
import { describe, expect, it, vi } from "vitest";

import { BillingGraphExecutorDecorator } from "@/adapters/server/ai/billing-executor.decorator";
import type {
  GraphExecutorPort,
  GraphRunRequest,
  GraphRunResult,
} from "@/ports";
import { makeNoopLogger } from "@/shared/observability";
import type {
  AiEvent,
  DoneEvent,
  TextDeltaEvent,
  UsageReportEvent,
} from "@/types/ai-events";
import type { BillingCommitFn } from "@/types/billing";
import type { UsageFact } from "@/types/usage";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createFakeInnerExecutor(events: AiEvent[]): GraphExecutorPort {
  return {
    runGraph(_req: GraphRunRequest): GraphRunResult {
      async function* stream(): AsyncIterable<AiEvent> {
        for (const event of events) {
          yield event;
        }
      }
      return {
        stream: stream(),
        final: Promise.resolve({
          ok: true as const,
          runId: "run-123",
          requestId: "req-123",
        }),
      };
    },
  };
}

const fakeRequest: GraphRunRequest = {
  runId: "run-123",
  ingressRequestId: "req-123",
  messages: [{ role: "user", content: "test" }],
  model: "test-model",
  caller: {
    billingAccountId: "billing-123",
    virtualKeyId: "vk-123",
    requestId: "req-123",
    traceId: "00000000000000000000000000000000",
  },
  graphId: "langgraph:poet",
};

async function collectStream(
  stream: AsyncIterable<AiEvent>
): Promise<AiEvent[]> {
  const events: AiEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

// ============================================================================
// BillingGraphExecutorDecorator: Stream Wrapping
// ============================================================================

describe("BillingGraphExecutorDecorator stream wrapping", () => {
  it("passes through non-billing events and consumes usage_report", async () => {
    const fact = buildInprocUsageFact();
    const innerEvents: AiEvent[] = [
      { type: "text_delta", delta: "Hello" } satisfies TextDeltaEvent,
      { type: "usage_report", fact } satisfies UsageReportEvent,
      { type: "done" } satisfies DoneEvent,
    ];

    const commitFn = vi.fn<BillingCommitFn>().mockResolvedValue(undefined);
    const inner = createFakeInnerExecutor(innerEvents);
    const decorator = new BillingGraphExecutorDecorator(
      inner,
      commitFn,
      makeNoopLogger()
    );

    const result = decorator.runGraph(fakeRequest);
    const collected = await collectStream(result.stream);

    // usage_report consumed — not yielded to downstream
    expect(collected).toHaveLength(2);
    expect(collected.map((e) => e.type)).toEqual(["text_delta", "done"]);
  });

  it("delegates final promise from inner executor", async () => {
    const inner = createFakeInnerExecutor([
      { type: "done" } satisfies DoneEvent,
    ]);
    const commitFn = vi.fn<BillingCommitFn>().mockResolvedValue(undefined);
    const decorator = new BillingGraphExecutorDecorator(
      inner,
      commitFn,
      makeNoopLogger()
    );

    const result = decorator.runGraph(fakeRequest);
    // Drain stream first
    await collectStream(result.stream);
    const final = await result.final;

    expect(final.ok).toBe(true);
    expect(final.runId).toBe("run-123");
  });
});

// ============================================================================
// BillingGraphExecutorDecorator: Billing Validation
// ============================================================================

describe("BillingGraphExecutorDecorator billing validation", () => {
  it("valid inproc fact → commitFn called with correct args", async () => {
    const fact = buildInprocUsageFact();
    const innerEvents: AiEvent[] = [
      { type: "usage_report", fact } satisfies UsageReportEvent,
      { type: "done" } satisfies DoneEvent,
    ];

    const commitFn = vi.fn<BillingCommitFn>().mockResolvedValue(undefined);
    const inner = createFakeInnerExecutor(innerEvents);
    const decorator = new BillingGraphExecutorDecorator(
      inner,
      commitFn,
      makeNoopLogger()
    );

    const result = decorator.runGraph(fakeRequest);
    await collectStream(result.stream);

    expect(commitFn).toHaveBeenCalledTimes(1);
    const [calledFact, calledContext] = commitFn.mock.calls[0] ?? [];
    expect(calledFact.usageUnitId).toBe("litellm-call-id-456");
    expect(calledContext.runId).toBe("run-123");
    expect(calledContext.ingressRequestId).toBe("req-123");
    expect(calledContext.attempt).toBe(0);
  });

  it("valid sandbox fact → commitFn called", async () => {
    const fact = buildSandboxUsageFact();
    const innerEvents: AiEvent[] = [
      { type: "usage_report", fact } satisfies UsageReportEvent,
      { type: "done" } satisfies DoneEvent,
    ];

    const commitFn = vi.fn<BillingCommitFn>().mockResolvedValue(undefined);
    const inner = createFakeInnerExecutor(innerEvents);
    const decorator = new BillingGraphExecutorDecorator(
      inner,
      commitFn,
      makeNoopLogger()
    );

    await collectStream(decorator.runGraph(fakeRequest).stream);

    expect(commitFn).toHaveBeenCalledTimes(1);
  });

  it("inproc executor missing usageUnitId → throws billing failure", async () => {
    const { usageUnitId: _, ...factWithoutId } = buildInprocUsageFact();
    const innerEvents: AiEvent[] = [
      { type: "text_delta", delta: "Hello" } satisfies TextDeltaEvent,
      {
        type: "usage_report",
        fact: factWithoutId as unknown as UsageFact,
      } satisfies UsageReportEvent,
      { type: "done" } satisfies DoneEvent,
    ];

    const commitFn = vi.fn<BillingCommitFn>().mockResolvedValue(undefined);
    const inner = createFakeInnerExecutor(innerEvents);
    const decorator = new BillingGraphExecutorDecorator(
      inner,
      commitFn,
      makeNoopLogger()
    );

    const result = decorator.runGraph(fakeRequest);

    // Stream iteration should throw because of billing-authoritative hard failure
    await expect(collectStream(result.stream)).rejects.toThrow(
      "Billing failed"
    );
    // commitFn should NOT have been called
    expect(commitFn).not.toHaveBeenCalled();
  });

  it("sandbox executor missing usageUnitId → throws billing failure", async () => {
    const { usageUnitId: _, ...factWithoutId } = buildSandboxUsageFact();
    const innerEvents: AiEvent[] = [
      {
        type: "usage_report",
        fact: factWithoutId as unknown as UsageFact,
      } satisfies UsageReportEvent,
      { type: "done" } satisfies DoneEvent,
    ];

    const commitFn = vi.fn<BillingCommitFn>().mockResolvedValue(undefined);
    const inner = createFakeInnerExecutor(innerEvents);
    const decorator = new BillingGraphExecutorDecorator(
      inner,
      commitFn,
      makeNoopLogger()
    );

    await expect(
      collectStream(decorator.runGraph(fakeRequest).stream)
    ).rejects.toThrow("Billing failed");
    expect(commitFn).not.toHaveBeenCalled();
  });

  it("valid external fact (no usageUnitId) → commitFn called (hints schema passes)", async () => {
    const externalFact = buildExternalUsageFact();
    const innerEvents: AiEvent[] = [
      { type: "text_delta", delta: "Response" } satisfies TextDeltaEvent,
      { type: "usage_report", fact: externalFact } satisfies UsageReportEvent,
      { type: "done" } satisfies DoneEvent,
    ];

    const commitFn = vi.fn<BillingCommitFn>().mockResolvedValue(undefined);
    const inner = createFakeInnerExecutor(innerEvents);
    const decorator = new BillingGraphExecutorDecorator(
      inner,
      commitFn,
      makeNoopLogger()
    );

    const result = decorator.runGraph(fakeRequest);
    const collected = await collectStream(result.stream);

    // Hints schema passes (usageUnitId optional for external) → commitFn IS called
    expect(collected.map((e) => e.type)).toEqual(["text_delta", "done"]);
    expect(commitFn).toHaveBeenCalledTimes(1);
  });

  it("external executor with malformed data → soft skip, commitFn NOT called", async () => {
    // Remove runId to fail hints validation (runId is required even in hints schema)
    const { runId: _, ...factWithoutRunId } = buildExternalUsageFact();
    const innerEvents: AiEvent[] = [
      { type: "text_delta", delta: "Response" } satisfies TextDeltaEvent,
      {
        type: "usage_report",
        fact: factWithoutRunId as unknown as UsageFact,
      } satisfies UsageReportEvent,
      { type: "done" } satisfies DoneEvent,
    ];

    const commitFn = vi.fn<BillingCommitFn>().mockResolvedValue(undefined);
    const inner = createFakeInnerExecutor(innerEvents);
    const decorator = new BillingGraphExecutorDecorator(
      inner,
      commitFn,
      makeNoopLogger()
    );

    const result = decorator.runGraph(fakeRequest);
    const collected = await collectStream(result.stream);

    // No error — soft skip for malformed hints (non-authoritative)
    expect(collected.map((e) => e.type)).toEqual(["text_delta", "done"]);
    // commitFn NOT called because validation failed
    expect(commitFn).not.toHaveBeenCalled();
  });

  it("commitFn DB error → swallowed, stream continues", async () => {
    const fact = buildInprocUsageFact();
    const innerEvents: AiEvent[] = [
      { type: "usage_report", fact } satisfies UsageReportEvent,
      { type: "done" } satisfies DoneEvent,
    ];

    // commitFn throws a non-billing error (e.g., DB error)
    const commitFn = vi
      .fn<BillingCommitFn>()
      .mockRejectedValue(new Error("DB connection failed"));
    const inner = createFakeInnerExecutor(innerEvents);
    const decorator = new BillingGraphExecutorDecorator(
      inner,
      commitFn,
      makeNoopLogger()
    );

    const result = decorator.runGraph(fakeRequest);
    const collected = await collectStream(result.stream);

    // Error swallowed — stream continues
    expect(collected.map((e) => e.type)).toEqual(["done"]);
    expect(commitFn).toHaveBeenCalledTimes(1);
  });

  it("multiple usage_report events → commitFn called for each", async () => {
    const fact1 = buildInprocUsageFact({ usageUnitId: "call-1" });
    const fact2 = buildInprocUsageFact({ usageUnitId: "call-2" });
    const innerEvents: AiEvent[] = [
      { type: "usage_report", fact: fact1 } satisfies UsageReportEvent,
      { type: "usage_report", fact: fact2 } satisfies UsageReportEvent,
      { type: "done" } satisfies DoneEvent,
    ];

    const commitFn = vi.fn<BillingCommitFn>().mockResolvedValue(undefined);
    const inner = createFakeInnerExecutor(innerEvents);
    const decorator = new BillingGraphExecutorDecorator(
      inner,
      commitFn,
      makeNoopLogger()
    );

    await collectStream(decorator.runGraph(fakeRequest).stream);

    expect(commitFn).toHaveBeenCalledTimes(2);
    expect(commitFn.mock.calls[0]?.[0].usageUnitId).toBe("call-1");
    expect(commitFn.mock.calls[1]?.[0].usageUnitId).toBe("call-2");
  });
});
