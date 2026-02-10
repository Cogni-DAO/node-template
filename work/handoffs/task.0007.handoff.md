---
id: task.0007.handoff
type: handoff
work_item_id: task.0007
status: active
created: 2026-02-10
updated: 2026-02-10
branch: feat/concurrent-openclaw
last_commit: 2a168997
---

# Handoff: Billing Enforcement Decorator at GraphExecutorPort

## Context

- **Project:** [proj.unified-graph-launch](../projects/proj.unified-graph-launch.md) — unify all graph execution so billing/observability cannot be bypassed
- **The bug:** Scheduled graph runs produce zero billing records because the internal route handler drains the event stream without processing `usage_report` events ([bug.0005](../items/bug.0005.scheduled-runs-no-billing.md))
- **Root cause:** Billing lives in `RunEventRelay` (feature layer, UI chat path only). The internal route calls `GraphExecutorPort.runGraph()` directly, bypassing it
- **This task:** Move billing into a port-level decorator so ALL callers get billing automatically — same pattern as the existing `ObservabilityGraphExecutorDecorator`
- **Recommendation:** Skip the bug.0005 quick fix and implement this decorator directly. Close bug.0005 as superseded once this merges. Scheduled-run Activity stays broken until this lands.

## Current State

- **No implementation code written** — all three project items (bug.0005, task.0007, task.0006) are in Todo status
- Work items have been updated with full Requirements, Allowed Changes, Plan, and Review Checklist sections (see items below)
- Design review completed (2026-02-10) — approved with required amendments, all incorporated into the work items
- Branch `feat/concurrent-openclaw` carries unrelated OpenClaw work — **cut a clean branch from `staging`** for implementation
- The existing `ObservabilityGraphExecutorDecorator` is the proven pattern to copy

## Decisions Made

- **DI for layer boundaries:** Decorator takes `BillingCommitFn` via constructor injection. App layer creates the closure. Adapters/bootstrap never import from features. See [task.0007 Design section](../items/task.0007.billing-enforcement-decorator.md#architecture-dependency-injection-for-layer-boundaries)
- **Decorator stack order:** Observability (outer) → Billing → NamespaceRouter/Aggregator (inner). Observability doesn't need `usage_report` events — confirmed safe. See [graph-executor.factory.ts:82-93](../../src/bootstrap/graph-executor.factory.ts)
- **Caller-drain obligation:** Decorator billing fires only when consumer iterates stream. Safe for P0 (both callers drain fully). Enforced by grep test + JSDoc. See [task.0007 Caller-Drain section](../items/task.0007.billing-enforcement-decorator.md#caller-drain-obligation)
- **Do NOT implement Temporal unification** as part of this changeset — port-level enforcement must be in place first

## Next Actions

- [ ] Cut branch from `staging` (e.g., `fix/billing-enforcement-decorator`)
- [ ] Define `BillingCommitFn` type in `src/types/`
- [ ] Create `BillingGraphExecutorDecorator` in `src/adapters/server/ai/billing-executor.decorator.ts`
- [ ] Wire into `createGraphExecutor()` factory — add `billingCommitFn` parameter
- [ ] Update both call sites (facade + internal route) to create and pass the `commitFn` closure
- [ ] Remove billing from `RunEventRelay` (`handleBilling()`, `commitUsageFact` import, schema validation)
- [ ] Add JSDoc on `GraphExecutorPort.runGraph()` documenting drain obligation
- [ ] Add drain-enforcement grep test (`tests/stack/ai/stream-drain-enforcement.stack.test.ts`)
- [ ] Add decorator unit test + verify stack billing tests still pass
- [ ] Update bug.0005 status: `blocked-by: task.0007` or close as superseded after merge

## Risks / Gotchas

- **Architecture boundary is the #1 trap:** `src/adapters/` CANNOT import from `src/features/`. The decorator must use the injected `commitFn`, not a direct `commitUsageFact` import. `bootstrap/` also can't import features — the closure must be created in the `app` layer.
- **`RunEventRelay` billing removal is coupled:** Removing `handleBilling()` means the UI chat path also uses the decorator for billing. Test both paths (UI + scheduled) after removal.
- **`LazySandboxGraphProvider` imports `GraphProvider`:** When task.0006 lands, this type changes. Don't touch the lazy provider or routing in this PR — that's task.0006 scope.
- **`commitUsageFact` has Zod validation:** `RunEventRelay.handleBilling()` does `UsageFactStrictSchema`/`UsageFactHintsSchema` validation before calling `commitUsageFact`. Decide whether to move this validation into the decorator or rely on `commitUsageFact`'s own guards.

## Pointers

| File / Resource                                                            | Why it matters                                                                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [task.0007 work item](../items/task.0007.billing-enforcement-decorator.md) | Full requirements, plan, and DI design with pseudocode                                           |
| [bug.0005 work item](../items/bug.0005.scheduled-runs-no-billing.md)       | The regression this fixes — root cause analysis and key files                                    |
| [task.0006 work item](../items/task.0006.collapse-graph-provider.md)       | Next PR after this — do not touch GraphProvider/routing here                                     |
| `src/adapters/server/ai/observability-executor.decorator.ts`               | **Copy this pattern** — decorator wrapping `GraphExecutorPort`                                   |
| `src/bootstrap/graph-executor.factory.ts`                                  | Factory that wires decorators; add `billingCommitFn` param here                                  |
| `src/features/ai/services/ai_runtime.ts:184-394`                           | `RunEventRelay` — remove `handleBilling()` from here                                             |
| `src/features/ai/services/billing.ts:203-321`                              | `commitUsageFact()` — the function to bind into the closure                                      |
| `src/app/api/internal/graphs/[graphId]/runs/route.ts:336-355`              | Bug site — the `for await` drain that discards billing events                                    |
| `src/app/_facades/ai/completion.server.ts`                                 | UI chat call site — creates executor, needs `commitFn` param                                     |
| `src/ports/graph-executor.port.ts`                                         | Port interface — add JSDoc drain obligation here                                                 |
| [docs/spec/graph-execution.md](../../docs/spec/graph-execution.md)         | Governing spec — invariants ONE_LEDGER_WRITER, BILLING_INDEPENDENT_OF_CLIENT, IDEMPOTENT_CHARGES |
| [proj.unified-graph-launch](../projects/proj.unified-graph-launch.md)      | Project roadmap and design notes                                                                 |
