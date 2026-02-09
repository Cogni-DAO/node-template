---
id: task.0007
type: task
title: "Billing enforcement decorator at GraphExecutorPort level"
status: Todo
priority: 1
estimate: 2
summary: Create BillingGraphExecutorDecorator (same pattern as ObservabilityGraphExecutorDecorator) that intercepts usage_report events from the stream and calls commitUsageFact(). Applied at factory level so ALL execution paths get billing automatically.
outcome: Any code path through GraphExecutorPort gets billing enforcement. RunEventRelay drops billing responsibility. bug.0005 is properly fixed by architecture, not by patching each call site.
spec_refs: graph-execution, unified-graph-launch
assignees: derekg1729
credit:
project: proj.unified-graph-launch
branch:
pr:
reviewer:
created: 2026-02-09
updated: 2026-02-09
labels: [ai-graphs, billing]
external_refs:
---

## Problem

Billing enforcement lives in `RunEventRelay` (feature layer, `ai_runtime.ts`), which is only used by the UI chat path. Any code that calls `GraphExecutorPort.runGraph()` without wrapping in RunEventRelay gets zero billing — this is exactly what caused bug.0005 (scheduled runs bypass billing).

The pattern of "remember to wrap with billing" at every call site is error-prone. As new execution triggers are added (webhooks, API, Temporal workflows), each must independently discover and apply billing. This is the wrong level of abstraction.

## Design

Apply the **decorator pattern** at the `GraphExecutorPort` level — same approach already proven by `ObservabilityGraphExecutorDecorator`:

```
GraphExecutorPort
  └─ ObservabilityGraphExecutorDecorator (traces + Langfuse)
       └─ BillingGraphExecutorDecorator (intercepts usage_report → commitUsageFact)
            └─ NamespaceGraphRouter (routes by providerId)
                 └─ providers...
```

The `BillingGraphExecutorDecorator`:

1. Wraps the inner `GraphExecutorPort`
2. Calls `inner.runGraph(req)` to get the raw stream
3. Returns a **new stream** that transparently passes through all events but intercepts `usage_report` events and calls `commitUsageFact()`
4. The consumer sees the same `AsyncIterable<AiEvent>` — billing is invisible

### Context Resolution

`commitUsageFact()` needs `RunContext` (runId, attempt, ingressRequestId) and `AccountService`. Both are available:

- `RunContext` derivable from `GraphRunRequest` (has `runId`, `ingressRequestId`; attempt is 0 in P0)
- `AccountService` provided at construction time (same as observability decorator gets `LangfusePort`)

### Stream Wrapping

```typescript
class BillingGraphExecutorDecorator implements GraphExecutorPort {
  constructor(
    private inner: GraphExecutorPort,
    private accountServiceFactory: (userId: UserId) => AccountService,
    private log: Logger
  ) {}

  runGraph(req: GraphRunRequest): GraphRunResult {
    const result = this.inner.runGraph(req);
    return {
      stream: this.wrapStreamWithBilling(result.stream, req),
      final: result.final,
    };
  }

  private async *wrapStreamWithBilling(
    upstream: AsyncIterable<AiEvent>,
    req: GraphRunRequest
  ): AsyncIterable<AiEvent> {
    const context: RunContext = {
      runId: req.runId,
      attempt: 0, // P0: always 0
      ingressRequestId: req.ingressRequestId,
    };

    for await (const event of upstream) {
      if (event.type === "usage_report") {
        // Billing side-effect (non-blocking, errors logged not thrown)
        await commitUsageFact(event.fact, context, accountService, this.log);
        // Don't yield usage_report to consumer — internal event
        continue;
      }
      yield event;
    }
  }
}
```

### RunEventRelay Impact

Once the decorator handles billing, `RunEventRelay` can drop its billing subscriber:

- Keep: pump-to-completion (BILLING_INDEPENDENT_OF_CLIENT), UI stream filtering, error protocol
- Remove: `handleBilling()`, `commitUsageFact` import, billing validation logic
- `RunEventRelay` becomes a pure UI stream adapter (which is what its name should imply)

## Key Constraint

**BILLING_INDEPENDENT_OF_CLIENT** must still hold. The decorator's stream wrapper must run to completion even if the consumer disconnects. Two options:

1. The decorator itself doesn't need pump semantics — the consumer (RunEventRelay or direct drain) is responsible for completing the stream
2. The internal route handler already drains to completion (`for await`), so billing fires

Option 1 is correct: the decorator transparently processes events as they flow. The _caller_ is responsible for consuming the full stream. This is already true for both paths (UI chat: RunEventRelay pump; scheduled: for-await drain).

## Execution Plan

1. Create `BillingGraphExecutorDecorator` in `src/adapters/server/ai/`
2. Wire in `createGraphExecutor()` factory (between observability decorator and router)
3. Remove billing from `RunEventRelay.handleBilling()` — relay becomes UI-only
4. Verify: scheduled run path (`internal/graphs/.../runs/route.ts`) gets billing automatically with zero changes
5. Update tests

## Validation

- `pnpm check` — no type errors
- `pnpm test` — RunEventRelay tests updated (no billing assertions)
- `pnpm test:stack:dev` — billing stack tests pass
- New assertion: scheduled graph run produces `charge_receipts` row (bug.0005 resolved)
- New assertion: `AI_BILLING_COMMIT_COMPLETE` log event fires for scheduled runs
- Verify: `RunEventRelay` no longer imports `commitUsageFact`
