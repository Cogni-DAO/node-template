---
id: agent-roles
type: spec
title: Agent Workforce — LangGraph Roles on Temporal Schedules
status: draft
trust: draft
summary: Multi-role agent workforce via three registries (GraphSpec, RoleSpec, WorkItem) and one reusable Temporal workflow
read_when: Adding a new agent role, understanding the agent workforce architecture
owner: derekg1729
created: 2026-03-26
verified: 2026-03-26
tags: [agents, governance, roles, langgraph, temporal]
---

# Agent Workforce — LangGraph Roles on Temporal Schedules

## Problem

One heartbeat loop, one global queue, no ownership. PR #562 sat 2 weeks because no agent owned the outcome. Adding a new agent should be config, not code.

## Three Registries

| Registry                                 | Concern      | What it defines                                    |
| ---------------------------------------- | ------------ | -------------------------------------------------- |
| **GraphSpec** (`LANGGRAPH_CATALOG`)      | How to think | Prompt + tools + factory                           |
| **RoleSpec** (constants in workflow pkg) | What to own  | graphId + queueFilter + model + schedule + metrics |
| **WorkItem** (`@cogni/work-items`)       | What to do   | Leased unit of work with lifecycle                 |

One generic `RoleHeartbeatWorkflow` orchestrates all roles. Adding an agent = 1 `RoleSpec` + 1 `CatalogEntry`. Never a new workflow.

## Design

### Change 1: Parameterize the Graph Factory

Add `systemPrompt` to `CreateReactAgentGraphOptions`. Wrap `createReactAgent` behind our own factory seam (`createOperatorGraph`) so the LangChain v1 migration (`createAgent` replaces `createReactAgent`) is a single-file change.

```typescript
// packages/langgraph-graphs/src/graphs/operator/graph.ts
export function createOperatorGraph(opts: CreateReactAgentGraphOptions) {
  if (!opts.systemPrompt)
    throw new Error("operator graph requires systemPrompt");
  return createReactAgent({
    llm: opts.llm,
    tools: [...opts.tools],
    messageModifier: opts.systemPrompt,
    stateSchema: MessagesAnnotation,
  });
}
```

Existing factories (poet, brain, etc.) unchanged. New `CatalogEntry` interface gains optional `systemPrompt`:

```typescript
interface CatalogEntry {
  readonly displayName: string;
  readonly description: string;
  readonly toolIds: readonly string[];
  readonly graphFactory: CreateGraphFn;
  readonly systemPrompt?: string; // NEW — passed to factory when present
}
```

### Change 2: RoleSpec (Separate from GraphSpec)

`RoleSpec` defines the operational contract. It references a graph by ID but does NOT live in the graph catalog — these are different concerns.

```typescript
// packages/temporal-workflows/src/domain/role-spec.ts
// Crawl: code constants. Walk: extract to shared package when dashboard needs it.

export interface RoleSpec {
  readonly roleId: string;
  readonly graphId: string; // references LANGGRAPH_CATALOG entry
  readonly model: string;
  readonly queueFilter: {
    readonly statuses?: readonly string[];
    readonly labels?: readonly string[];
    readonly types?: readonly string[];
  };
  readonly schedule: { readonly cron: string };
  readonly concurrency: number; // max leased items (crawl: always 1)
  readonly outcomeHandler: string; // handler ID for processOutcome dispatch
  readonly escalation?: {
    readonly staleAfterHours: number;
    readonly action: "notify" | "reassign";
  };
}

export const CEO_ROLE: RoleSpec = {
  roleId: "ceo-operator",
  graphId: "langgraph:ceo-operator",
  model: "openai/gpt-4o",
  queueFilter: {}, // sees everything
  schedule: { cron: "0 * * * *" }, // hourly
  concurrency: 1,
  outcomeHandler: "default", // update item status + Discord
};

export const GIT_REVIEWER_ROLE: RoleSpec = {
  roleId: "git-reviewer",
  graphId: "langgraph:git-reviewer",
  model: "openai/gpt-4o",
  queueFilter: { statuses: ["needs_merge"] },
  schedule: { cron: "0 */4 * * *" }, // every 4h
  concurrency: 1,
  outcomeHandler: "pr-lifecycle", // merge/reject + update item
  escalation: { staleAfterHours: 48, action: "notify" },
};
```

### Change 3: RoleHeartbeatWorkflow (with claim/release)

Follows the proven `PrReviewWorkflow` pattern. Uses `claim()`/`release()` from `WorkItemCommandPort` for atomic work locking.

```typescript
// packages/temporal-workflows/src/workflows/role-heartbeat.workflow.ts

export interface RoleHeartbeatInput {
  roleId: string;
  graphId: string;
  model: string;
  queueFilter: { statuses?: string[]; labels?: string[]; types?: string[] };
  outcomeHandler: string;
}

export interface RoleHeartbeatResult {
  outcome: "success" | "error" | "no_op";
  roleId: string;
  itemId?: string;
  runId?: string;
}

export async function RoleHeartbeatWorkflow(
  input: RoleHeartbeatInput
): Promise<RoleHeartbeatResult> {
  const { roleId, graphId, model, queueFilter, outcomeHandler } = input;

  // Activity: filter queue → sort → claim first available (atomic lease)
  const claimed = await claimNextItemActivity({ roleId, queueFilter });
  if (!claimed) return { outcome: "no_op", roleId };

  const { itemId, runId } = claimed;

  try {
    // Activity: build context messages from item data (keep small — Temporal history limits)
    const contextMessages = await buildRoleContextActivity({ roleId, itemId });

    // Child workflow: reuse GraphRunWorkflow (billing, observability, error handling)
    const graphResult = await executeChild("GraphRunWorkflow", {
      workflowId: `graph-run:system:${roleId}:${itemId}`,
      args: [
        {
          graphId,
          executionGrantId: null,
          input: {
            messages: contextMessages,
            model,
            actorUserId: "cogni_system",
            billingAccountId: SYSTEM_BILLING_ACCOUNT,
            virtualKeyId: SYSTEM_VIRTUAL_KEY,
          },
          runKind: "system_scheduled" as const,
          triggerSource: `role:${roleId}`,
          triggerRef: `${roleId}:${itemId}`,
          requestedBy: "cogni_system",
          runId,
        },
      ],
    });

    // Activity: role-specific outcome processing (dispatched by outcomeHandler ID)
    await processOutcomeActivity({
      roleId,
      itemId,
      outcomeHandler,
      graphResult,
    });

    return {
      outcome: graphResult.ok ? "success" : "error",
      roleId,
      itemId,
      runId,
    };
  } finally {
    // Activity: always release the lease
    await releaseItemActivity({ itemId, runId });
  }
}
```

Key differences from previous version:

- **`claimNextItemActivity`** uses `WorkItemCommandPort.claim()` — atomic lease, not read
- **`releaseItemActivity`** in `finally` — always releases, even on error
- **`executeChild` args match real `GraphRunWorkflowInput`** — `messages`/`model` inside `input:`, plus `runKind`, `triggerSource`, `requestedBy`
- **`outcomeHandler`** — dispatches to handler by ID, no role-specific branches in workflow
- **Context kept small** — `buildRoleContextActivity` returns lean messages (Temporal history limits)

### Change 4: Outcome Handlers

Outcome processing is registry-driven, not a switch statement. Each handler is a function registered at worker startup.

```typescript
// packages/temporal-workflows/src/domain/outcome-handlers.ts

export type OutcomeHandler = (ctx: {
  roleId: string;
  itemId: string;
  graphResult: GraphRunResult;
}) => Promise<void>;

// Crawl: two handlers
export const OUTCOME_HANDLERS: Record<string, OutcomeHandler> = {
  default: async ({ itemId, graphResult }) => {
    // Transition work item status based on graph result
    // Post summary to Discord
  },
  "pr-lifecycle": async ({ itemId, graphResult }) => {
    // If graph says merge → merge PR
    // If graph says reject → close PR with rationale
    // Transition work item status
    // Post to Discord
  },
};
```

### Adding a New Agent (the whole process)

```
1. Write a system prompt           → graphs/operator/prompts.ts
2. Define tool IDs                 → graphs/operator/tools.ts
3. Add CatalogEntry                → catalog.ts (graphFactory: createOperatorGraph)
4. Add RoleSpec constant           → domain/role-spec.ts
5. (Optional) Add outcome handler  → domain/outcome-handlers.ts
```

No new workflow. No new activity. No new package. Config only.

### Architecture Diagram

```
repo-spec.yaml schedule
  │
  ▼ Temporal Schedule fires
  │
  ▼ RoleHeartbeatWorkflow(RoleSpec fields)
  │
  ├─ claimNextItemActivity ──── WorkItemCommandPort.claim() (atomic lease)
  │
  ├─ buildRoleContextActivity ── format item as lean messages
  │
  ├─ executeChild(GraphRunWorkflow) ── GraphExecutorPort (existing)
  │   └─ LANGGRAPH_CATALOG[graphId] → createOperatorGraph(systemPrompt)
  │
  ├─ processOutcomeActivity ──── OUTCOME_HANDLERS[outcomeHandler]
  │
  └─ releaseItemActivity ─────── WorkItemCommandPort.release() (always, via finally)
```

## Invariants

- `THREE_REGISTRIES`: GraphSpec = how to think. RoleSpec = what to own. WorkItem = what to do. Never collapse.
- `CLAIM_NOT_READ`: `claimNextItemActivity` uses `WorkItemCommandPort.claim()` for atomic lease. No read-then-act.
- `ALWAYS_RELEASE`: `releaseItemActivity` runs in `finally` block. Leases never orphaned.
- `ONE_WORKFLOW_ALL_ROLES`: `RoleHeartbeatWorkflow` is parameterized. Adding a role never creates a new workflow.
- `OUTCOME_HANDLERS_DISPATCHED`: `processOutcomeActivity` dispatches by `outcomeHandler` ID. No role-specific branches in workflow code.
- `REAL_GRAPHRUNINPUT`: `executeChild(GraphRunWorkflow)` passes the real `GraphRunWorkflowInput` shape — `messages`/`model` inside `input:`, plus `runKind`, `triggerSource`, `triggerRef`, `requestedBy`.
- `CONTEXT_STAYS_LEAN`: `buildRoleContextActivity` returns minimal messages. Temporal stores activity inputs in history (payload limits).
- `FACTORY_SEAM`: `createOperatorGraph` wraps `createReactAgent`. LangChain v1 migration = single-file change.
- `EXISTING_GRAPHS_UNCHANGED`: Poet, brain, ponderer, research, pr-review keep their hardcoded prompts and factories.
- `IDEMPOTENT_OUTCOMES`: Outcome handlers use stable business keys (`roleId:itemId`) for side effects. Safe to retry.

## Crawl / Walk / Run

### Crawl

- `systemPrompt` on `CreateReactAgentGraphOptions` + `CatalogEntry`
- `createOperatorGraph` factory (behind seam)
- 2 catalog entries (ceo-operator, git-reviewer) + prompts
- `RoleSpec` type + 2 constants in temporal-workflows
- `RoleHeartbeatWorkflow` + 4 activities (claim, context, outcome, release)
- 2 outcome handlers (default, pr-lifecycle)
- Operator tools: `work_item_query`, `work_item_transition`

### Walk

- Role-level metrics dashboard: backlog by role, lease age, SLA breach, success rate, spend, unowned items
- Webhook triggers for Git Reviewer (GitHub PR events → Temporal signal)
- PM and Data Analyst roles (new RoleSpec + CatalogEntry each)
- Outcome logging for feedback loop
- Extract `RoleSpec` to shared package for dashboard consumption

### Run

- Self-improving prompts (metaprompt reviews outcome logs)
- Cross-role escalation via work item creation
- Role performance benchmarking

## Non-Goals

- New graph types — ReAct via `createOperatorGraph` is sufficient for operator roles
- Agent-to-agent communication — escalation = new work item, not message passing
- Dynamic role creation — roles are code constants (crawl) or config (walk)
- RoleSpec as a port/adapter — it's configuration, not application state

## Related

- [Temporal Patterns](temporal-patterns.md) — Workflow/activity invariants, history limits
- [Development Lifecycle](development-lifecycle.md) — Status → command mapping
- [Work Items Port](work-items-port.md) — `claim()`/`release()` interface
