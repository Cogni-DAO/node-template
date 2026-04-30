// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: tests/unit/bootstrap/auto-wrap.tick.test.ts
 * Purpose: Pure-tick coverage for the task.0429 auto-wrap loop. Exercises the
 *   four `wrapIdleUsdcE` outcomes the adapter can return + the tick's
 *   error-isolation invariant (TICK_IS_SELF_HEALING).
 * Scope: Unit. No DB, no Privy, no RPC. The wallet port + listEligible reader
 *   are stubbed at the boundary of `runAutoWrapTick`.
 * Invariants asserted:
 *   - SELF_HEALING — a thrown error on row N does not stop processing N+1.
 *   - DUST_GUARD — `below_floor` is propagated as a `skipped` metric label,
 *     not a `wrapped` one.
 *   - METRICS_TICKS_TOTAL — every tick increments `ticksTotal` exactly once.
 * Links: nodes/poly/app/src/bootstrap/jobs/auto-wrap.job.ts,
 *        work/items/task.0429.poly-auto-wrap-consent-loop.md
 */

import type { LoggerPort, MetricsPort } from "@cogni/poly-market-provider";
import type { WrapIdleUsdcEResult } from "@cogni/poly-wallet";
import { describe, expect, it, vi } from "vitest";
import {
  AUTO_WRAP_METRICS,
  type AutoWrapJobDeps,
  runAutoWrapTick,
} from "@/bootstrap/jobs/auto-wrap.job";

function makeLogger(): LoggerPort {
  const noop = () => {};
  const logger: Partial<LoggerPort> & { child: (..._a: unknown[]) => LoggerPort } = {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => logger as LoggerPort,
  };
  return logger as LoggerPort;
}

function makeMetrics(): MetricsPort & {
  calls: { name: string; labels: Record<string, string> }[];
} {
  const calls: { name: string; labels: Record<string, string> }[] = [];
  return {
    incr: (name: string, labels: Record<string, string>) => {
      calls.push({ name, labels });
    },
    observeDurationMs: () => {},
    calls,
  } as MetricsPort & typeof Object & {
    calls: { name: string; labels: Record<string, string> }[];
  };
}

function makeDeps(opts: {
  rows: { billingAccountId: string }[];
  wrapImpl: (id: string) => Promise<WrapIdleUsdcEResult>;
}): AutoWrapJobDeps & {
  metrics: ReturnType<typeof makeMetrics>;
} {
  const metrics = makeMetrics();
  return {
    walletPort: {
      wrapIdleUsdcE: vi.fn(opts.wrapImpl),
    },
    listEligible: vi.fn(async (_limit: number) => opts.rows),
    logger: makeLogger(),
    metrics,
  };
}

describe("runAutoWrapTick", () => {
  it("counts a wrapped outcome and emits one outcomesTotal{outcome=wrapped}", async () => {
    const deps = makeDeps({
      rows: [{ billingAccountId: "ba_1" }],
      wrapImpl: async () => ({
        outcome: "wrapped",
        txHash: "0xabc" as const,
        amountAtomic: 5_000_000n,
      }),
    });

    const summary = await runAutoWrapTick(deps);

    expect(summary).toEqual({
      scanned: 1,
      wrapped: 1,
      skipped: 0,
      errored: 0,
    });
    const outcomeCalls = deps.metrics.calls.filter(
      (c) => c.name === AUTO_WRAP_METRICS.outcomesTotal
    );
    expect(outcomeCalls).toHaveLength(1);
    expect(outcomeCalls[0]?.labels).toEqual({ outcome: "wrapped" });
  });

  it("propagates the structured skip reason as a metric label (DUST_GUARD)", async () => {
    const deps = makeDeps({
      rows: [{ billingAccountId: "ba_1" }],
      wrapImpl: async () => ({
        outcome: "skipped",
        reason: "below_floor",
        observedBalanceAtomic: 500_000n,
      }),
    });

    const summary = await runAutoWrapTick(deps);

    expect(summary.wrapped).toBe(0);
    expect(summary.skipped).toBe(1);
    const outcomeCalls = deps.metrics.calls.filter(
      (c) => c.name === AUTO_WRAP_METRICS.outcomesTotal
    );
    expect(outcomeCalls[0]?.labels).toEqual({
      outcome: "skipped",
      reason: "below_floor",
    });
  });

  it("isolates a thrown row error and continues to subsequent rows (SELF_HEALING)", async () => {
    const deps = makeDeps({
      rows: [
        { billingAccountId: "ba_1" },
        { billingAccountId: "ba_2_throws" },
        { billingAccountId: "ba_3" },
      ],
      wrapImpl: async (id) => {
        if (id === "ba_2_throws") {
          throw new Error("rpc_unreachable");
        }
        return {
          outcome: "skipped",
          reason: "no_balance",
          observedBalanceAtomic: 0n,
        };
      },
    });

    const summary = await runAutoWrapTick(deps);

    expect(summary).toEqual({
      scanned: 3,
      wrapped: 0,
      skipped: 2,
      errored: 1,
    });
    const erroredCalls = deps.metrics.calls.filter(
      (c) =>
        c.name === AUTO_WRAP_METRICS.outcomesTotal &&
        c.labels.outcome === "errored"
    );
    expect(erroredCalls).toHaveLength(1);
  });

  it("increments ticksTotal exactly once per tick, even when zero rows scanned", async () => {
    const deps = makeDeps({ rows: [], wrapImpl: vi.fn() });

    await runAutoWrapTick(deps);

    const tickCalls = deps.metrics.calls.filter(
      (c) => c.name === AUTO_WRAP_METRICS.ticksTotal
    );
    expect(tickCalls).toHaveLength(1);
    expect(deps.walletPort.wrapIdleUsdcE).not.toHaveBeenCalled();
  });

  it("differentiates the four skip reasons in metric labels", async () => {
    const reasons: WrapIdleUsdcEResult[] = [
      { outcome: "skipped", reason: "no_consent", observedBalanceAtomic: null },
      {
        outcome: "skipped",
        reason: "no_balance",
        observedBalanceAtomic: 0n,
      },
      {
        outcome: "skipped",
        reason: "below_floor",
        observedBalanceAtomic: 500_000n,
      },
      {
        outcome: "skipped",
        reason: "not_provisioned",
        observedBalanceAtomic: null,
      },
    ];
    const queue = [...reasons];
    const deps = makeDeps({
      rows: reasons.map((_, i) => ({ billingAccountId: `ba_${i}` })),
      wrapImpl: async () => {
        const next = queue.shift();
        if (!next) throw new Error("queue empty");
        return next;
      },
    });

    await runAutoWrapTick(deps);

    const labels = deps.metrics.calls
      .filter((c) => c.name === AUTO_WRAP_METRICS.outcomesTotal)
      .map((c) => c.labels);
    expect(labels).toEqual([
      { outcome: "skipped", reason: "no_consent" },
      { outcome: "skipped", reason: "no_balance" },
      { outcome: "skipped", reason: "below_floor" },
      { outcome: "skipped", reason: "not_provisioned" },
    ]);
  });
});
