---
id: openclaw-ui-alignment
type: research
title: "OpenClaw UI Alignment: Agent Creation, Scheduling, Model Config"
status: active
trust: draft
verified: 2026-02-10
summary: Simplest path to align Cogni UI with OpenClaw agent controls — config-as-code now, gateway CRUD later.
read_when: Planning OpenClaw agent management UI, model catalog sync, or scheduling integration.
owner: derekg1729
created: 2026-02-10
tags: [openclaw, ui, agents]
---

# Research: OpenClaw UI Alignment — Agent Creation, Scheduling, Model Config

> topic: proj.openclaw-capabilities | date: 2026-02-10

## Question

How do we align Cogni's UI to OpenClaw's agent controls (creating agents, scheduling, model configuration) while keeping our hexagonal ports? What's the minimum code to move forward cleanly?

## Context

**What exists today:**

| Layer              | Current State                                                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent discovery    | `GET /api/v1/ai/agents` works. `AgentCatalogPort` → `AggregatingAgentCatalog` → providers (LangGraph + Sandbox). Returns `AgentDescriptor[]`. |
| UI agent picker    | `ChatComposerExtras.tsx` has **hardcoded** `AVAILABLE_GRAPHS` (5 entries). TODO comment says replace with API fetch.                          |
| Model selection    | User picks model in `ModelPicker`. Flows as `model` field in chat request. LiteLLM config is source of truth. Works end-to-end.               |
| OpenClaw config    | `openclaw-gateway.json` bind-mounted. Has `agents.list` (1 agent: "main") and `models` array (2 models: test-model, nemotron-nano-30b).       |
| Gateway protocol   | OpenClaw gateway exposes full CRUD over WS: `agents.create/update/delete`, `agents.files.*`, `cron.add/list/remove`, `models.list`.           |
| Our gateway client | `OpenClawGatewayClient` speaks the WS protocol for `runAgent()`. No CRUD methods yet.                                                         |
| Scheduling         | OpenClaw cron disabled (invariant 14: OPENCLAW_CRON_DISABLED). No Temporal. No scheduling exists.                                             |

**Key insight:** The model the user selects in the UI already flows to OpenClaw via `GraphRunRequest.model` → gateway client → `outboundHeaders`. OpenClaw's per-agent model config is a default, but our proxy does the actual model routing. The user's UI selection wins.

## Findings

### Option A: Config-as-code (Recommended for now)

**What**: Agent definitions live in `openclaw-gateway.json` (already the case). Model catalog is synced from `litellm.config.yaml` at build/deploy time via a script. No runtime CRUD, no admin UI.

- **Pros**: Zero new code for agent management. Config changes go through git. Auditable. No new ports, no new API routes, no new UI pages.
- **Cons**: Adding an agent requires a deploy. Fine for a team of 1-5 with no external users.
- **Code needed**:
  1. Replace hardcoded `AVAILABLE_GRAPHS` with `useAgents()` hook (~20 lines)
  2. Script to sync LiteLLM models → `openclaw-gateway.json` models array (~50 lines)
- **Fit**: Perfect for current stage. No users, no multi-tenancy.

### Option B: Gateway CRUD proxy (When we need it)

**What**: Add thin API routes that proxy OpenClaw gateway CRUD calls. Admin page for agent management.

- **Pros**: Users can create/configure agents from the UI. Dynamic.
- **Cons**: New API routes, new port (`AgentManagementPort`), new UI page, auth/permissions needed.
- **Code needed**:
  1. Extend `OpenClawGatewayClient` with `createAgent()`, `updateAgent()`, `deleteAgent()`, `listModels()`
  2. `AgentManagementPort` interface (CRUD)
  3. API routes: `POST /api/v1/ai/agents`, `PATCH /api/v1/ai/agents/:id`, `DELETE /api/v1/ai/agents/:id`
  4. Settings page with agent list + create/edit form
- **Fit**: When we have external users who need to customize agents. Not now.

### Option C: Full scheduling integration (Defer)

**What**: Re-enable OpenClaw cron, expose scheduling UI.

- **Cons**: Conflicts with invariant 14 (OPENCLAW_CRON_DISABLED). No clear use case yet. Adds complexity (schedule types, delivery targets, job state). Would need a `SchedulerPort` or similar.
- **Fit**: P2+ at earliest. Don't build what nobody's asking for.

## Recommendation

**Do Option A now. Option B when we have users. Skip C until there's demand.**

Concretely, the two changes needed right now:

### Change 1: Wire `useAgents()` hook (kill hardcoded list)

Replace the hardcoded `AVAILABLE_GRAPHS` in `ChatComposerExtras.tsx` with a fetch from `GET /api/v1/ai/agents`. The API already exists and returns the right shape. This is ~20 lines:

```typescript
// useAgents.ts
export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: async () => {
      const res = await fetch("/api/v1/ai/agents");
      const data = await res.json();
      return {
        agents: data.agents.map((a) => ({
          graphId: a.graphId,
          name: a.name,
          description: a.description,
        })),
        defaultAgentId: data.defaultAgentId,
      };
    },
    staleTime: 5 * 60_000,
  });
}
```

Then `ChatComposerExtras` uses `useAgents()` instead of `AVAILABLE_GRAPHS`. GraphPicker gets a loading state. Done.

### Change 2: Sync model catalog (script)

`openclaw-gateway.json` has a stale 2-model list. LiteLLM config has 16 models. Write a small script that reads `litellm.config.yaml` and patches the `models` array in `openclaw-gateway.json`:

```bash
# scripts/sync-openclaw-models.sh — run at build/deploy time
# Reads litellm.config.yaml model_name entries → writes openclaw-gateway.json models array
```

Each LiteLLM `model_name` becomes an OpenClaw model entry with `id`, `name`, costs zeroed (billing via LiteLLM, not OpenClaw).

### What about per-agent model config?

**It already works.** The user picks a model in ModelPicker → it flows as `model` in the chat request → `SandboxGraphProvider` passes it to the gateway client → gateway uses it. OpenClaw's config `agents.defaults.model.primary` is just the fallback if nothing is specified. Our UI always specifies.

### What about creating new agents?

**Config-as-code for now.** Edit `openclaw-gateway.json` → add entry to `agents.list` → add `AgentDescriptor` to `SandboxAgentCatalogProvider` → deploy. When we need dynamic creation, add Option B.

### What about scheduling?

**Not needed.** No use case. No users requesting it. Defer.

### Do we need new ports?

**No.** `AgentCatalogPort` (discovery) and `GraphExecutorPort` (execution) are sufficient. The model already flows through `GraphRunRequest.model`. No new abstractions needed until Option B.

## Open Questions

- Should the model catalog sync script run at CI time (generate → commit) or deploy time (generate → mount)? Leaning deploy-time to avoid config drift between envs.

## Proposed Layout

### Immediate (fits in existing task.0010 or a small new task)

| Change                                            | Type | Effort |
| ------------------------------------------------- | ---- | ------ |
| `useAgents()` hook + wire into ChatComposerExtras | task | 1      |
| `sync-openclaw-models` script + wire into deploy  | task | 1      |

### When needed (new project phase or tasks under proj.openclaw-capabilities Walk)

| Change                                           | Type        | Effort |
| ------------------------------------------------ | ----------- | ------ |
| `AgentManagementPort` + gateway CRUD proxy       | spec + task | 3      |
| Agent settings page (list + create/edit)         | task        | 3      |
| Per-agent behavior files UI (AGENTS.md, SOUL.md) | task        | 2      |

### Defer (P2+)

| Change                         | Type                 | Effort |
| ------------------------------ | -------------------- | ------ |
| Re-enable cron + scheduling UI | spec + project phase | 5+     |
| Sub-agent spawning from UI     | spec + task          | 3      |
