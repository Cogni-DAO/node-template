---
id: agent-roles
type: spec
title: Agent Workforce Architecture
status: draft
trust: draft
summary: Capability × workflow-shape × domain-activities — the three axes of agent design
read_when: Adding a new agent, understanding agent architecture, choosing workflow shape
owner: derekg1729
created: 2026-03-26
verified: 2026-03-26
tags: [agents, governance, roles, langgraph, temporal]
---

# Agent Workforce Architecture

## Problem

PR #562 sat 2 weeks — no agent owned the outcome. Adding a new agent requires too much bespoke code. No standard for how agents are built, triggered, or measured.

## Three Axes

Every agent is the intersection of three independent concerns:

| Axis                  | Question                   | Layer                                             | Varies how?                   |
| --------------------- | -------------------------- | ------------------------------------------------- | ----------------------------- |
| **Capability**        | How does it think?         | LangGraph (prompt, tools, output schema)          | Many — one per agent type     |
| **Workflow shape**    | How is it invoked?         | Temporal (trigger, lifecycle, composition)        | Few — 2-3 reusable patterns   |
| **Domain activities** | What effects does it have? | Temporal activities (GitHub, work items, Discord) | By integration domain, shared |

New agent capability = always. New workflow shape = only when trigger/lifecycle materially differs. New activities = only when hitting a new external system.

## Capabilities (LangGraph)

A capability is a catalog entry: prompt + tools + optional output schema. It defines how an agent reasons. Adding a capability = adding config.

### Factory Seam

Wrap `createReactAgent` behind `createOperatorGraph` so LangChain v1 migration (`createAgent`) is a single-file change:

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

### Catalog Changes

Add optional `systemPrompt` to `CatalogEntry`. Existing graphs unchanged.

```typescript
interface CatalogEntry {
  readonly displayName: string;
  readonly description: string;
  readonly toolIds: readonly string[];
  readonly graphFactory: CreateGraphFn;
  readonly systemPrompt?: string; // NEW — passed to factory when present
}
```

### Crawl Capabilities

| Capability     | Graph                            | Tools                                                   | Purpose                      |
| -------------- | -------------------------------- | ------------------------------------------------------- | ---------------------------- |
| `ceo-operator` | `createOperatorGraph`            | work_item_query, metrics_query, discord_post            | Triage, prioritize, dispatch |
| `git-reviewer` | `createOperatorGraph`            | github_pr_read, github_pr_comment, work_item_transition | Drive PRs to merge/reject    |
| `pr-review`    | `createPrReviewGraph` (existing) | none (evidence pre-fetched)                             | Structured PR evaluation     |

Note: `git-reviewer` and `pr-review` are different capabilities. `pr-review` is a single-call evaluator (no tools, structured output). `git-reviewer` is a ReAct agent that can take actions (comment, fix CI, request merge). They may compose — the reviewer capability could invoke `pr-review` as a tool.

## Workflow Shapes (Temporal)

A workflow shape defines trigger, lifecycle, and composition. There are few shapes — most agents reuse one.

### Shape 1: Webhook Agent (exists — `PrReviewWorkflow`)

```
trigger → create UX feedback → fetch domain context → executeChild(GraphRunWorkflow) → write result
```

- **Trigger**: External event (GitHub webhook, Alchemy webhook)
- **Lifecycle**: One-shot. Event in → result out. No queue, no claim.
- **Idempotency**: `workflowId = {domain}:{business-key}` (e.g., `pr-review:owner/repo/pr/sha`)
- **Example**: `PrReviewWorkflow` — already working, deployed

This shape is right for any agent that **reacts to external events** with **domain-specific I/O**.

### Shape 2: Scheduled Sweep (new — `ScheduledSweepWorkflow`)

```
cron tick → claim item from queue → build context → executeChild(GraphRunWorkflow) → process outcome → release
```

- **Trigger**: Temporal Schedule (cron)
- **Lifecycle**: Per-tick. Claim one item, process it, release. Short-lived (~10 Temporal events).
- **Idempotency**: `workflowId = sweep:{roleId}:{itemId}`
- **Locking**: `WorkItemCommandPort.claim()` / `release()` — atomic lease
- **Example**: CEO Operator (hourly), PM Triage (hourly), Data Analyst (daily)

This shape is right for any agent that **sweeps a work queue** on a schedule.

```typescript
// packages/temporal-workflows/src/workflows/scheduled-sweep.workflow.ts

export interface ScheduledSweepInput {
  roleId: string;
  graphId: string;
  model: string;
  queueFilter: { statuses?: string[]; labels?: string[]; types?: string[] };
}

export interface ScheduledSweepResult {
  outcome: "success" | "error" | "no_op";
  roleId: string;
  itemId?: string;
  runId?: string;
}

export async function ScheduledSweepWorkflow(
  input: ScheduledSweepInput
): Promise<ScheduledSweepResult> {
  const { roleId, graphId, model, queueFilter } = input;

  // Activity: filter queue → sort → claim first available (atomic lease)
  const claimed = await claimNextItemActivity({ roleId, queueFilter });
  if (!claimed) return { outcome: "no_op", roleId };

  const { itemId, runId } = claimed;

  try {
    // Activity: build context messages (keep lean — Temporal history limits)
    const contextMessages = await buildSweepContextActivity({ roleId, itemId });

    // Child workflow: reuse GraphRunWorkflow
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

    // Activity: process outcome (transition item, post to Discord)
    await processSweepOutcomeActivity({ roleId, itemId, graphResult });

    return {
      outcome: graphResult.ok ? "success" : "error",
      roleId,
      itemId,
      runId,
    };
  } finally {
    await releaseItemActivity({ itemId, runId });
  }
}
```

### Shape 3: Long-Running Approval (future — not crawl)

For agents that propose an action and wait for human approval before executing. Uses Temporal signals.

### When to Create a New Shape

Only when trigger, lifecycle, or composition pattern materially differs:

- Different trigger type (webhook vs cron vs user request vs signal)
- Different lifecycle (one-shot vs claim/release vs long-running)
- Different composition (child workflows vs sequential activities)

If the agent fits an existing shape, use it. Adding a shape is rare — maybe 1-2 per year.

## Domain Activities (Shared)

Activities are organized by integration domain, not per-agent. Any workflow shape can use any activity.

| Domain            | Activities                                                      | Used by                 |
| ----------------- | --------------------------------------------------------------- | ----------------------- |
| **GitHub**        | createCheckRun, fetchPrContext, postReviewResult, mergePr       | PR Review, Git Reviewer |
| **Work Items**    | claimNextItem, releaseItem, transitionStatus, buildSweepContext | Scheduled Sweep agents  |
| **Communication** | postToDiscord                                                   | All agents              |
| **Metrics**       | queryHealthMetrics                                              | CEO, Data Analyst       |

New activity = new external integration. Not new agent.

## RoleSpec (Binding)

`RoleSpec` binds a capability to a workflow shape with operational config. It's the glue.

```typescript
// packages/temporal-workflows/src/domain/role-spec.ts

export interface RoleSpec {
  readonly roleId: string;
  readonly graphId: string; // → capability (catalog entry)
  readonly workflowShape: "webhook" | "scheduled-sweep";
  readonly model: string;
  readonly schedule?: { readonly cron: string };
  readonly queueFilter?: {
    // only for scheduled-sweep shape
    readonly statuses?: readonly string[];
    readonly labels?: readonly string[];
    readonly types?: readonly string[];
  };
  readonly concurrency: number;
  readonly kpis: readonly RoleKPI[];
}

/** What this role is measured on. Dashboard shows these per role. */
export interface RoleKPI {
  readonly metric: string; // machine-readable key
  readonly name: string; // human-readable label
  readonly target?: number; // target value (e.g., < 24 hours, > 0.9)
  readonly unit: string; // "hours" | "ratio" | "count" | "usd"
  readonly direction: "lower_is_better" | "higher_is_better";
}

export const CEO_ROLE: RoleSpec = {
  roleId: "ceo-operator",
  graphId: "langgraph:ceo-operator",
  workflowShape: "scheduled-sweep",
  model: "openai/gpt-4o",
  schedule: { cron: "0 * * * *" },
  queueFilter: {},
  concurrency: 1,
  kpis: [
    {
      metric: "backlog_count",
      name: "Backlog size",
      unit: "count",
      direction: "lower_is_better",
    },
    {
      metric: "avg_item_age_hours",
      name: "Avg item age",
      target: 48,
      unit: "hours",
      direction: "lower_is_better",
    },
    {
      metric: "items_completed_24h",
      name: "Items completed (24h)",
      unit: "count",
      direction: "higher_is_better",
    },
    {
      metric: "spend_24h_usd",
      name: "LLM spend (24h)",
      target: 5,
      unit: "usd",
      direction: "lower_is_better",
    },
    {
      metric: "success_rate",
      name: "Success rate",
      target: 0.8,
      unit: "ratio",
      direction: "higher_is_better",
    },
  ],
};

export const GIT_REVIEWER_ROLE: RoleSpec = {
  roleId: "git-reviewer",
  graphId: "langgraph:git-reviewer",
  workflowShape: "scheduled-sweep",
  model: "openai/gpt-4o",
  schedule: { cron: "0 */4 * * *" },
  queueFilter: { statuses: ["needs_merge"] },
  concurrency: 1,
  kpis: [
    {
      metric: "open_prs",
      name: "Open PRs",
      unit: "count",
      direction: "lower_is_better",
    },
    {
      metric: "stale_prs_48h",
      name: "PRs stale > 48h",
      target: 0,
      unit: "count",
      direction: "lower_is_better",
    },
    {
      metric: "median_pr_age_hours",
      name: "Median PR age",
      target: 24,
      unit: "hours",
      direction: "lower_is_better",
    },
    {
      metric: "merge_rate_7d",
      name: "Merge rate (7d)",
      target: 0.7,
      unit: "ratio",
      direction: "higher_is_better",
    },
    {
      metric: "spend_per_review_usd",
      name: "Cost per review",
      target: 0.5,
      unit: "usd",
      direction: "lower_is_better",
    },
  ],
};
```

Note: `pr-review` doesn't need a RoleSpec — it's triggered by webhook, not by role config. It's wired directly from the GitHub webhook handler to `PrReviewWorkflow`. RoleSpec is for agents that run on schedules.

## Adding a New Agent

### Case 1: New capability, existing workflow shape (common)

1. Write system prompt → `graphs/operator/prompts.ts`
2. Add catalog entry → `catalog.ts`
3. Add RoleSpec constant → `domain/role-spec.ts`
4. Add Temporal schedule → `repo-spec.yaml`

No new workflow. No new activities (unless new external integration).

### Case 2: New capability, new trigger/lifecycle (rare)

1. Steps 1-2 from above (capability)
2. New workflow file (~40 lines) with domain-specific activities
3. Wire trigger (webhook handler, schedule, etc.)

This is the `PrReviewWorkflow` pattern. It happens maybe 1-2 times per year.

### The Existing PR Review Agent

`PrReviewWorkflow` + `pr-review` graph is already the right pattern. It stays as-is. It will evolve by:

- Adding tools to the `pr-review` graph (currently tool-less structured output)
- Adding activities to the workflow (e.g., `mergePrActivity` when auto-merge lands)
- The workflow shape stays webhook-triggered

The new `git-reviewer` capability is complementary — it sweeps for stale PRs that webhooks missed, using the scheduled-sweep shape.

## Invariants

- `CAPABILITY_IS_CONFIG`: Adding a capability = catalog entry. Prompt + tools + optional output schema.
- `SHAPES_ARE_FEW`: Workflow shapes are reusable patterns (2-3 total). New shape only when trigger/lifecycle materially differs.
- `ACTIVITIES_BY_DOMAIN`: Activities organized by external integration (GitHub, work items, Discord), not per-agent.
- `CLAIM_NOT_READ`: Scheduled sweep uses `WorkItemCommandPort.claim()` for atomic lease. `release()` in finally.
- `REAL_GRAPHRUNINPUT`: `executeChild(GraphRunWorkflow)` passes the real interface — messages/model inside `input:`.
- `FACTORY_SEAM`: `createOperatorGraph` wraps `createReactAgent`. LangChain v1 migration = single file.
- `EXISTING_AGENTS_UNCHANGED`: `PrReviewWorkflow` + `pr-review` graph stay as-is.
- `CONTEXT_STAYS_LEAN`: Activity inputs stored in Temporal history. Keep messages minimal.
- `KPIS_PER_ROLE`: Every RoleSpec declares its KPIs. Dashboard shows actuals vs targets. An unmeasured agent is an unmanaged agent.

## Crawl / Walk / Run

### Crawl

- `systemPrompt` on `CreateReactAgentGraphOptions` + `CatalogEntry`
- `createOperatorGraph` factory behind seam
- 2 capabilities: `ceo-operator`, `git-reviewer` (catalog entries + prompts)
- `ScheduledSweepWorkflow` + activities (claim, context, outcome, release)
- `RoleSpec` type + 2 constants
- Operator tools: `work_item_query`, `work_item_transition`
- Temporal schedules for both roles

### Walk

- Role-level metrics: backlog, SLA breach, success rate, spend, unowned items
- Webhook triggers for Git Reviewer (GitHub PR events → `PrReviewWorkflow` evolution or new webhook shape)
- PM + Data Analyst roles (new capabilities + RoleSpecs, same sweep shape)
- Outcome logging for prompt improvement

### Run

- Self-improving prompts via outcome analysis
- Cross-role escalation via work item creation
- Long-running approval workflow shape

## Related

- [Temporal Patterns](temporal-patterns.md) — Workflow/activity invariants, history limits
- [Development Lifecycle](development-lifecycle.md) — Status → command mapping
- [Work Items Port](work-items-port.md) — `claim()`/`release()` interface
