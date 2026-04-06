---
id: git-overseer-spec
type: spec
title: "Git Overseer: AI-Managed Development Pipeline"
status: draft
spec_state: proposed
trust: draft
summary: The git overseer is a LangGraph agent on the operator node that monitors and manages the development pipeline via GitHub App-authed tools. It sees all environments and repo activity. Authority is enforced at the adapter layer, not by prompt.
read_when: Designing git-manager agent behavior, configuring GitHub App permissions, adding branch protection logic, or understanding how the AI manages the development pipeline.
implements:
owner: derekg1729
created: 2026-04-06
verified:
tags: [agents, git-manager, vcs, github-app, ci-cd]
---

# Git Overseer: AI-Managed Development Pipeline

> The operator's git-manager agent sees the full development pipeline and acts on it via GitHub App tools. Authority lives in the adapter, not the prompt.

## Problem

The development pipeline involves multiple environments (canary → preview → production), multiple agent types (PR review, brain, future coding agents), and continuous GitHub activity (PRs, reviews, CI checks, deploys). Today no single agent has a coherent view of this pipeline, and the VCS tools have zero code-level guardrails — any agent can attempt to merge to any branch.

## Goal

A single git-manager agent on the production operator node that:

- Monitors the full pipeline (all environments, all branches, all CI)
- Takes scoped actions (create branches, merge to integration branches, dispatch other agents)
- Has authority enforced by the adapter, not by hoping the LLM follows instructions
- Consumes real-time VCS events from the node stream

## Design

### Deployment Model

The git-manager runs on the **production operator node** only. It has visibility into all environments because it accesses the same GitHub repo that all environments deploy from.

```
Production Operator (cognidao.org)
  └── git-manager agent (LangGraph, scheduled)
        ├── Reads: GitHub API (PRs, CI, branches) via cogni-node-template app
        ├── Reads: node:{nodeId}:events (VcsActivityEvent from webhooks)
        ├── Acts:  Create branches, merge integration PRs, dispatch agents
        └── Sees:  canary, preview, production branches + all PRs + all CI
```

v0: Single operator, single repo (`Cogni-DAO/node-template`).
vNext: Installed on multiple fork repos — git manager as shared infrastructure.

### GitHub App Architecture

Each environment has its own GitHub App installation for webhook isolation. All environments CAN share the same App ID + private key for API access (read PRs, merge, etc.), but separate apps give cleaner webhook routing.

| Environment | GitHub App                      | Webhook Target                                   | API Access          |
| ----------- | ------------------------------- | ------------------------------------------------ | ------------------- |
| Production  | `cogni-node-template`           | `cognidao.org/api/internal/webhooks/github`      | Full VCS capability |
| Canary      | `cogni-git-attribution-preview` | `test.cognidao.org/api/internal/webhooks/github` | Full VCS capability |
| Preview     | (future)                        | `preview.cognidao.org/...`                       | Full VCS capability |

**Credentials per environment:**

- `GH_REVIEW_APP_ID` — GitHub App numeric ID
- `GH_REVIEW_APP_PRIVATE_KEY_BASE64` — base64-encoded PEM private key
- `GH_WEBHOOK_SECRET` — webhook signature verification secret

**App permissions (minimum required):**

- `contents: write` — create branches, read code
- `pull_requests: write` — list/merge/create PRs
- `checks: read` — read CI check run status
- `issues: read` — read issue metadata
- `metadata: read` — required baseline

**Webhook events to subscribe:**

- `pull_request` — PR opened, closed, merged, reopened, labeled
- `pull_request_review` — review submitted
- `check_run` — CI check completed (for future CiStatusEvent publishing)
- `push` — branch updates

### Authority Model (ADAPTER_ENFORCED)

**The critical invariant: authority is enforced in the `VcsCapability` adapter, not in the prompt.**

The current adapter (`GitHubVcsAdapter`) has zero branch protection. `mergePr()` blindly calls the GitHub API. The only protection is GitHub's server-side branch protection rules (which return 405 if violated).

This spec requires the adapter to enforce a branch allowlist:

```typescript
// In GitHubVcsAdapter.mergePr():
const MERGE_ALLOWED_PATTERNS = [
  /^feat\/.+-integration$/, // integration branches
  /^feat\//, // feature branches
];
const MERGE_BLOCKED_BRANCHES = new Set([
  "main",
  "canary",
  "staging",
  "deploy/canary",
  "deploy/preview",
  "deploy/production",
]);

// Before calling GitHub API:
const pr = await this.getPr(owner, repo, prNumber);
if (MERGE_BLOCKED_BRANCHES.has(pr.base.ref)) {
  return {
    merged: false,
    message: `Merge to ${pr.base.ref} is blocked by policy`,
  };
}
if (!MERGE_ALLOWED_PATTERNS.some((p) => p.test(pr.base.ref))) {
  return {
    merged: false,
    message: `Target branch ${pr.base.ref} not in allowlist`,
  };
}
```

**Why adapter, not prompt:**

- Prompts are suggestions. Adapters are contracts.
- An LLM can misinterpret or ignore a prompt rule. An adapter throws or returns `merged: false`.
- GitHub's 405 protection is a fallback, not a primary defense.
- The adapter check is O(1) and doesn't require a GitHub API call.

### Data Sources

The git-manager consumes data from three layers:

```
┌─────────────────────────────────────────────────┐
│ Layer 1: Real-time Webhooks → Node Stream        │
│                                                   │
│ GitHub sends webhook → operator ingests           │
│ → VcsActivityEvent on node:{nodeId}:events        │
│ → SSE endpoint delivers to dashboard + agent      │
│                                                   │
│ Events: PR opened/merged/reviewed, push, CI       │
│ Latency: <1s from GitHub to Redis                 │
│ Agent access: core__node_stream_read (task.0297)  │
└─────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│ Layer 2: On-Demand VCS Tool Queries              │
│                                                   │
│ Agent calls VcsCapability methods at runtime       │
│ → GitHub REST API via App installation token       │
│                                                   │
│ Tools:                                            │
│   core__vcs_list_prs      → all open PRs          │
│   core__vcs_get_ci_status → checks + reviews      │
│   core__vcs_merge_pr      → squash merge          │
│   core__vcs_create_branch → new branch from ref   │
│                                                   │
│ Latency: 200-500ms per API call                   │
│ Agent access: direct tool invocation              │
└─────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│ Layer 3: Ingestion Pipeline (Temporal)           │
│                                                   │
│ CollectEpochWorkflow → PollAdapter.collect()      │
│ → ingestion_receipts (Postgres, durable)          │
│ → streams:vcs:github (Redis, future)              │
│                                                   │
│ Data: merged PRs, reviews, closed issues          │
│ Frequency: scheduled (daily or on-demand)         │
│ Purpose: attribution + historical record          │
└─────────────────────────────────────────────────┘
```

### Action Scope

| Action            | Mechanism                    | Guardrail                                            |
| ----------------- | ---------------------------- | ---------------------------------------------------- |
| List open PRs     | `core__vcs_list_prs`         | Read-only, no restriction                            |
| Check CI status   | `core__vcs_get_ci_status`    | Read-only, no restriction                            |
| Create branch     | `core__vcs_create_branch`    | Adapter: prefix validation (must start with `feat/`) |
| Merge PR          | `core__vcs_merge_pr`         | Adapter: MERGE_BLOCKED_BRANCHES + allowlist pattern  |
| Schedule agent    | `core__schedule_manage`      | Temporal: task queue isolation                       |
| Manage work items | `core__work_item_transition` | Port: status machine validation                      |

### KPIs

The git-manager evaluates these at each scheduled run:

1. **CI Health on Canary** — are all checks green on PRs targeting canary?
2. **Review Coverage** — are open PRs reviewed within 2h?
3. **Integration Branch Health** — are sub-PRs merging cleanly via squash?
4. **Dev Agent Throughput** — are `needs_implement` items being dispatched to agents?

### Scheduling

The git-manager runs on a Temporal schedule (configurable cron). Default: every 30 minutes. Each run:

1. Query open PRs (`core__vcs_list_prs`)
2. Check CI status on actionable PRs (`core__vcs_get_ci_status`)
3. Read recent VCS activity from node stream (when `core__node_stream_read` is available)
4. Evaluate KPIs
5. Take actions (merge green integration PRs, dispatch review agents, flag blocked items)
6. Output structured report

## Non-Goals

- Committing code, pushing files, or editing source (agent manages branches/PRs, doesn't write code)
- Managing deploy branches (`deploy/canary`, `deploy/preview`, `deploy/production`) — CI bot only
- Replacing human approval for release/\* → main merges
- Multi-repo management in v0 (single repo: `Cogni-DAO/node-template`)
- Running on canary or preview — production operator only

## Invariants

| Rule                   | Constraint                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADAPTER_ENFORCED       | Merge authority enforced in VcsCapability adapter, not prompt. Blocked branches return `merged: false` without calling GitHub API.                 |
| PRODUCTION_OVERSEER    | Git-manager runs on production operator only. Canary/preview do not run their own.                                                                 |
| SINGLE_REPO_V0         | v0 manages one repo (`Cogni-DAO/node-template`). vNext supports multiple fork repos.                                                               |
| WEBHOOK_PER_ENV        | Each environment has its own GitHub App for webhook isolation. API credentials may be shared.                                                      |
| MERGE_INTEGRATION_ONLY | Agent merges to `feat/*-integration` and `feat/*` branches only. canary, main, staging, deploy/\* are hard-blocked in the adapter.                 |
| NEVER_PUSH_CODE        | Git-manager creates branches and merges PRs. It does not commit code, push files, or modify source.                                                |
| DATA_LAYER_SEPARATION  | Real-time events from webhooks (Layer 1), on-demand queries via tools (Layer 2), durable records via Temporal (Layer 3). Agent consumes all three. |

## Relationship to Existing Specs

| Spec                               | Relationship                                                                                                               |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `data-streams.md`                  | Git-manager consumes VcsActivityEvent from the SSE transport layer. Webhook → Redis → SSE → agent.                         |
| `ci-cd.md`                         | Branch model (canary → release → main) and deploy branches are the context the agent operates in.                          |
| `attribution-pipeline-overview.md` | GitHub PollAdapter in the ingestion pipeline feeds Layer 3 (durable records). Separate from the agent's real-time Layer 1. |

## Implementation Phases

### Phase 0 (current): Agent + tools, prompt-only guardrails

- Git-manager graph exists (packages/langgraph-graphs/src/graphs/git-manager/)
- VCS tools exist (listPrs, getCiStatus, mergePr, createBranch)
- No adapter-level branch protection
- No real-time stream consumption

### Phase 1: Adapter-enforced authority

- Add MERGE_BLOCKED_BRANCHES + allowlist to `GitHubVcsAdapter.mergePr()`
- Add branch prefix validation to `createBranch()`
- No prompt changes needed — adapter rejects silently

### Phase 2: Real-time stream consumption

- `core__node_stream_read` tool (task.0297) gives agent access to recent VcsActivityEvents
- Agent reads stream at start of run for situational awareness
- Replaces or augments initial `core__vcs_list_prs` queries

### Phase 3 (vNext): Multi-repo, multi-node

- Git-manager installed on multiple fork repos
- Each fork has its own GitHub App installation
- Operator aggregates VCS events from all managed repos

## Open Questions

- [ ] Should the adapter allowlist be configurable (via repo-spec.yaml) or hardcoded? Leaning hardcoded for v0 — fewer moving parts.
- [ ] Should `createBranch` enforce a prefix? (e.g., only `feat/` branches). Currently no restriction.
- [ ] How does the git-manager interact with the PR Manager agent? Same schedule? Separate? Does git-manager replace PR Manager?
- [ ] Should the git-manager have a `core__vcs_close_pr` capability? Not currently in VcsCapability.
