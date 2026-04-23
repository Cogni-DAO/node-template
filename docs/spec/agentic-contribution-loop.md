---
id: agentic-contribution-loop
type: spec
title: Agentic Contribution Loop
status: draft
spec_state: as-built
trust: draft
summary: As-built spec for how external AI agents discover the operator, authenticate, contribute code, request a candidate flight, and self-validate — the full closed loop without human involvement.
read_when: Building an agent that contributes to this repo, wiring Cogni git-manager to an external agent, or designing the next agentic workflow step.
owner: derekg1729
created: 2026-04-23
verified: 2026-04-23
tags: [agent-api, vcs, contribution, pr-manager, agentic]
---

# Agentic Contribution Loop

> Single source of truth for the as-built, machine-executable contribution lifecycle.  
> Human-focused development lifecycle lives in [development-lifecycle.md](./development-lifecycle.md).  
> Validation flow detail lives in [docs/guides/agent-api-validation.md](../guides/agent-api-validation.md).

## Goal

Define the complete, as-built lifecycle for an external AI agent to discover the operator, authenticate, push code, open a PR, request a candidate-a flight, and self-validate — with no human in the loop.

## Non-Goals

- Internal agent graph design (see [langgraph-patterns.md](./langgraph-patterns.md))
- Human developer workflow (see [development-lifecycle.md](./development-lifecycle.md))
- Branch creation server-side (agent pushes its own branch via standard git)
- PR merge or close (pr-manager handles post-flight lifecycle)

## Design

### Architecture

```
external agent
  │
  ├─ GET  /.well-known/agent.json          ← discover all endpoints
  ├─ POST /api/v1/agent/register           ← get Bearer token
  ├─ git push origin feat/my-branch        ← push branch (standard git, outside operator)
  ├─ POST /api/v1/vcs/pr                   ← open PR → prNumber
  ├─ POST /api/v1/chat/completions         ← pr-manager: "Flight PR #N"
  └─ GET  /api/v1/agent/runs/{id}/stream   ← stream flight result
```

`POST /api/v1/vcs/pr` is a **primitive action** (creates a PR, returns prNumber). `pr-manager` is the **policy layer** (decides when to flight, monitors rollout, verifies SHA). These are not interchangeable — do not add flight logic to the REST endpoint.

## Overview

The operator exposes a fully machine-readable contribution interface. No browser, no human in the loop. An external agent can go from zero to a flighted PR using only HTTP:

```
DISCOVER  →  AUTH  →  EXPLORE  →  PUSH BRANCH  →  OPEN PR  →  FLIGHT  →  STREAM  →  VALIDATE
```

All endpoints are advertised at:

```
GET /.well-known/agent.json
```

## The Loop — As Built

### Step 1 — Discover

```bash
curl https://test.cognidao.org/.well-known/agent.json
```

Returns:

```json
{
  "registrationUrl": "…/api/v1/agent/register",
  "auth": { "type": "bearer", "keyPrefix": "cogni_ag_sk_v1_" },
  "endpoints": {
    "completions": "…/api/v1/chat/completions",
    "graphs": "…/api/v1/ai/agents",
    "runs": "…/api/v1/agent/runs",
    "runStream": "…/api/v1/agent/runs/{runId}/stream",
    "contribute": "…/api/v1/vcs/pr"
  }
}
```

### Step 2 — Auth

```bash
CREDS=$(curl -s -X POST $BASE/api/v1/agent/register \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent"}')
API_KEY=$(echo $CREDS | jq -r .apiKey)
```

The `apiKey` is a signed Bearer token (`cogni_ag_sk_v1_…`). Include it in all subsequent requests:

```
Authorization: Bearer $API_KEY
```

### Step 3 — Explore (optional)

List available graphs:

```bash
curl -s $BASE/api/v1/ai/agents \
  -H "Authorization: Bearer $API_KEY" | jq '.agents[].agentId'
```

Key graphs for the contribution loop:
| Graph | Purpose |
| ----- | ------- |
| `pr-manager` | Requests a candidate-a flight for a PR; monitors rollout |
| `brain` | Code-aware assistant; reads repo, answers questions |
| `pr-review` | Reviews a PR against `.cogni/repo-spec.yaml` gates |

### Step 4 — Push a Branch

The operator does not accept patches or diffs. The agent must push its own branch to the GitHub remote before opening a PR. This happens outside the operator API (standard `git push`).

### Step 5 — Open PR

```bash
curl -s -X POST $BASE/api/v1/vcs/pr \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "branch": "feat/my-agent-change",
    "title": "feat: my agent contribution",
    "body": "Opened by my-agent via POST /api/v1/vcs/pr",
    "base": "main"
  }'
```

Returns:

```json
{ "prNumber": 1042, "url": "https://github.com/…/pull/1042", "status": "open" }
```

**Invariants:**

- `OWNER_FROM_REPOSPEC` — the operator reads its own `owner/repo` from `repo-spec.yaml`; caller cannot target an arbitrary repo.
- `BRANCH_MUST_EXIST` — branch must already exist on the remote; the endpoint does not create branches.
- `409` if a PR from this branch already exists.
- `503` if the GitHub App credentials are not configured on this node.

### Step 6 — Request Flight

Hand `prNumber` to `pr-manager`:

```bash
RUN=$(curl -s -X POST $BASE/api/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"gpt-4o-mini\",
    \"graph_name\": \"pr-manager\",
    \"messages\": [{\"role\": \"user\", \"content\": \"Flight PR #1042\"}]
  }")
RUN_ID=$(echo $RUN | jq -r .id)
```

`pr-manager` handles: dispatch → wait for Argo rollout → report SHA match.

### Step 7 — Stream Result

```bash
curl -N $BASE/api/v1/agent/runs/$RUN_ID/stream \
  -H "Authorization: Bearer $API_KEY"
```

Stream events until the terminal event. The final message contains the flight outcome.

### Step 8 — Self-Validate

After a successful flight, hit your own feature endpoint on `test.cognidao.org` and confirm behavior. Post the result as a PR comment — this flips the human review signal.

---

## Responsibilities: REST Primitive vs pr-manager Graph

| Responsibility            | `POST /api/v1/vcs/pr` | `pr-manager` graph |
| ------------------------- | --------------------- | ------------------ |
| Create PR from branch     | ✅                    | ❌                 |
| Dispatch candidate-flight | ❌                    | ✅                 |
| Monitor Argo rollout      | ❌                    | ✅                 |
| Verify deployed SHA       | ❌                    | ✅                 |
| Merge when green          | ❌                    | ✅                 |

Use `/api/v1/vcs/pr` to open the PR. Use `pr-manager` for everything after.

---

## Auth Model

| Method       | Source                        | Scope                                      |
| ------------ | ----------------------------- | ------------------------------------------ |
| Bearer token | `POST /api/v1/agent/register` | Machine agent; read/write to own resources |
| SIWE session | Browser wallet sign-in        | Human operator; same route access          |

All `POST /api/v1/vcs/pr` calls require auth. The endpoint is not publicly writable.

---

## Contracts

| Contract                           | Location                                                    |
| ---------------------------------- | ----------------------------------------------------------- |
| `POST /api/v1/vcs/pr` input/output | `packages/node-contracts/src/vcs.create-pr.v1.contract.ts`  |
| Agent registration                 | `packages/node-contracts/src/agent-register.v1.contract.ts` |
| Chat completions                   | `packages/node-contracts/src/ai.chat.v1.contract.ts`        |

---

## Invariants

- `MACHINE_READABLE_ENTRY` — all endpoints discoverable via `/.well-known/agent.json`; no hardcoded URLs in agent code
- `AUTH_REQUIRED` — no contribution endpoint is publicly writable
- `OWNER_FROM_REPOSPEC` — PR target repo is config-driven, not caller-supplied
- `PRIMITIVE_OVER_POLICY` — `/api/v1/vcs/pr` is a primitive action; pr-manager is the policy layer; do not add flight logic to the REST endpoint
- `SELF_VALIDATE` — agents are expected to validate their own changes on candidate-a; `deploy_verified: true` is the real gate, not `status: done`
