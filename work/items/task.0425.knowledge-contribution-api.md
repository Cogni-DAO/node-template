---
id: task.0425
type: task
title: "External-agent knowledge contribution API — Dolt branch-per-PR (poly + operator, v0)"
status: needs_design
priority: 0
rank: 5
estimate: 5
summary: "Let an external agent (registered via `/contribute-to-cogni`) submit schema-aligned knowledge entries that land on a `contrib/<agent>-<id>` Dolt branch (one branch per contribution = one PR-equivalent), reviewed via `dolt_diff`, and merged to `main` by an authorized operator. Internal `core__knowledge_write` keeps writing straight to `main` (no branching) — this PR adds the external contributor flow only. Both poly and operator nodes ship the `knowledge` table + identical routes in the same PR (no asymmetry)."
outcome: "An external agent can POST a knowledge contribution to poly OR operator, see it land on a Dolt branch, GET its diff, and (when authorized) POST a merge that fast-forwards `main`. Schema is enforced via shared Zod contract in `@cogni/node-contracts`. Dolt-native PR semantics for knowledge — first realization of `KnowledgeClass: experimental` from the data-plane spec."
spec_refs: [knowledge-data-plane-spec, agent-contributor-protocol]
assignees: []
credit:
project: proj.agentic-interop
branch: feat/task-0425-knowledge-contribution-api
pr:
reviewer:
revision: 0
blocked_by: [task.0424]
deploy_verified: false
created: 2026-04-29
updated: 2026-04-29
labels: [knowledge, doltgres, agents, interop, api, poly, operator]
external_refs:
---

# External-agent knowledge contribution API — Dolt branch-per-PR (poly + operator, v0)

## Problem

Per `docs/spec/knowledge-data-plane.md`, knowledge classes are `public/shared`, `node-private`, and `experimental` — and external promotion happens via "explicit promotion only." But the spec's current Non-Goals lock us to "single branch (`main`), no merge workflows," which means external agents have **no way to contribute knowledge** at all today. The current `core__knowledge_write` tool is agent-runtime-internal (LangGraph inside the node process); there is no inbound surface.

PR #1130 (`task.0424`) just stood up the doltgres-on-operator scaffold (drizzle schema package, migrator, adapter pattern, `AUTO_COMMIT_ON_WRITE`). This task uses that scaffold to add the inbound knowledge-contribution surface — modeled as Dolt branches that operator merges, mirroring our trunk-based git PR flow.

## Requirements

### Convergence: poly + operator ship the same thing

- **Operator gets `knowledge` table** in `knowledge_operator` (next to `work_items`). Same Drizzle schema as poly's existing `knowledge` table. No more "operator has work_items but no knowledge" asymmetry.
- **Both nodes mount identical routes** at `/api/v1/knowledge/contributions/*`. Single shared route handler factory wired per-node from each node's adapter.
- **Shared contract** in `packages/node-contracts/src/knowledge.contribute.v1.contract.ts` — `z.infer<>` everywhere; no shadow types.

### Surface (per-node)

| Method | Path                                              | Auth                                | Purpose                                                  |
| ------ | ------------------------------------------------- | ----------------------------------- | -------------------------------------------------------- |
| `POST` | `/api/v1/knowledge/contributions`                 | Bearer or session                   | Create branch `contrib/<agent>-<contribId>`, insert entries, commit |
| `GET`  | `/api/v1/knowledge/contributions`                 | Bearer or session                   | List open contributions (branches with `contrib/` prefix) |
| `GET`  | `/api/v1/knowledge/contributions/:id`             | Bearer or session                   | Show entries + commit metadata for one contribution     |
| `GET`  | `/api/v1/knowledge/contributions/:id/diff`        | Bearer or session                   | `dolt_diff('main', branch, 'knowledge')` against base   |
| `POST` | `/api/v1/knowledge/contributions/:id/merge`       | Session-user with `knowledge:merge` | `dolt_merge(branch)` then drop branch                    |
| `POST` | `/api/v1/knowledge/contributions/:id/close`       | Session-user with `knowledge:merge` | Drop branch without merging (reject)                    |

All shapes enforced via `knowledge.contribute.v1.contract.ts` Zod schemas (`CONTRACTS_ARE_TRUTH`).

### Branch-per-PR semantics

- **One contribution = one branch = one Dolt commit.** Atomic create. No long-lived per-agent branches in v0.
- Branch naming: `contrib/<agentSlug>-<shortid>` (e.g. `contrib/derek-claude-7f3a`). Server allocates `shortid`.
- Server-side flow on POST:
  1. `dolt_checkout('-b', '<branch>', 'main')` — branch from current `main` HEAD
  2. `INSERT INTO knowledge (...)` for each entry (server stamps `source_type`, `source_ref`, `created_at`)
  3. `dolt_commit('-Am', 'contrib(<agent>): <message>')`
  4. `dolt_checkout('main')` — return adapter to main; new branch persists in dolt
  5. Return `{ contributionId, branch, commitHash, entryCount }`
- Server-side flow on merge: `dolt_checkout('main')` → `dolt_merge('<branch>')` → `dolt_branch('-d', '<branch>')`. Conflict → 409, branch retained for retry.

### Schema-aligned input

Server stamps **non-overridable fields**:
- `source_type = 'external_agent'` (always)
- `source_ref = '<agentId>:<contributionId>'`
- `created_at = now()`
- `confidence_pct = 30` (Draft default per spec) unless caller is operator-role and provides a higher value

Caller provides: `domain` (required), `entity_id?`, `title` (required), `content` (required), `tags?`, `confidence_pct?` (capped per role).

### Auth

- Same `getSessionUser` resolver as #1130 (Bearer-first, session fallback).
- `POST /contributions` (create) — any registered principal (agent or user).
- `merge` / `close` — gated on principal having `knowledge:merge` capability. v0 implementation: hardcoded list of operator session-user IDs OR `principal.kind === 'user' && principal.role === 'admin'`. **No RBAC table** — we're explicit that real RBAC + per-user-knowledge RLS is vFuture.
- No row-level access control on `knowledge` reads — full table is readable by any registered principal in v0.

### Spec edits (`docs/spec/knowledge-data-plane.md`)

- Lift Non-Goal "Branching, remotes, or cross-node sharing — single branch (`main`) only" → revise to: "Long-lived feature branches, remotes, cross-node sharing." External-contribution branches are now in scope; internal writes still single-trunk.
- Add invariant `EXTERNAL_CONTRIB_VIA_BRANCH`: external-agent writes to `knowledge` go through `contrib/*` branches; only authorized operators merge to `main`.
- Add invariant `KNOWLEDGE_TABLE_ON_EVERY_NODE`: every node with a knowledge database has the `knowledge` table — no per-node table omissions.
- Document the `KnowledgeClass: experimental` flow concretely (was hand-wave-y).

## Out of scope (v1+)

- Web UI for diff review (curl-only in v0)
- Per-row conflict resolution UI (second-merge gets 409, agent retries)
- Long-lived per-agent branches with multi-commit PRs
- Cross-node fan-out (one contribution targets one node's database)
- Knowledge-class taxonomy enforcement (`public/shared` vs `node-private` columns)
- Real RBAC table + per-user knowledge RLS
- MCP tool for external knowledge-contribute
- Resy and other future nodes (poly + operator only in v0)
- Auto-promotion based on outcome-validation / repeated-pattern criteria from spec

## Allowed Changes

- `packages/knowledge-store/` — extend port + adapter with branch ops
- `packages/node-contracts/src/knowledge.contribute.v1.contract.ts` (new)
- `nodes/poly/packages/doltgres-schema/` — re-exports `knowledge` (already there); no schema change
- `nodes/operator/packages/doltgres-schema/` — add `knowledge` table + migration `0001_add_knowledge.sql`
- `nodes/{poly,operator}/app/src/app/api/v1/knowledge/contributions/` (new routes)
- `nodes/{poly,operator}/app/src/bootstrap/container.ts` — wire contribution port
- `nodes/{poly,operator}/app/src/app/_facades/knowledge/contributions.server.ts` (new)
- `docs/spec/knowledge-data-plane.md` — spec edits per above
- `docs/design/knowledge-contribution-api.md` (new — this PR's design doc)
- `work/items/task.0425.knowledge-contribution-api.md` (this file)

## Validation

```yaml
exercise: |
  # Discover + register (existing flow)
  curl -fsSL https://test.cognidao.org/.well-known/agent.json
  API_KEY=$(curl -fsSL -X POST https://test.cognidao.org/api/v1/agent/register \
    -H 'content-type: application/json' \
    -d '{"name":"task-0425-validator"}' | jq -r .apiKey)

  # Contribute to poly knowledge
  CONTRIB=$(curl -fsSL -X POST https://test.cognidao.org/api/v1/knowledge/contributions \
    -H "authorization: Bearer $API_KEY" \
    -H "content-type: application/json" \
    -d '{
      "node": "poly",
      "message": "task.0425 e2e: base-rate fact for prediction-market domain",
      "entries": [
        {
          "domain": "prediction-market",
          "title": "Election-year Fed rate-cut base rate",
          "content": "Historical frequency of Fed rate cuts in election years is ~35%",
          "tags": ["base-rate","fed","macro"]
        }
      ]
    }')
  CONTRIB_ID=$(echo "$CONTRIB" | jq -r .contributionId)
  BRANCH=$(echo "$CONTRIB" | jq -r .branch)

  # Read it back
  curl -fsSL "https://test.cognidao.org/api/v1/knowledge/contributions/$CONTRIB_ID" \
    -H "authorization: Bearer $API_KEY"

  # Diff vs main
  curl -fsSL "https://test.cognidao.org/api/v1/knowledge/contributions/$CONTRIB_ID/diff" \
    -H "authorization: Bearer $API_KEY"

  # Merge (requires operator-role session — Derek runs this with session cookie, not API key)
  curl -fsSL -X POST "https://test.cognidao.org/api/v1/knowledge/contributions/$CONTRIB_ID/merge" \
    -H "cookie: $OPERATOR_SESSION_COOKIE"

observability: |
  # Loki query — agent's own contribute request landed at deployed SHA
  {app="poly", env="candidate-a"} |~ "knowledge.contributions" |~ "task-0425-validator"
  # And the dolt_commit was emitted
  {app="poly"} |~ "dolt_commit" |~ "contrib/" |~ "task-0425"
```

**Pass criteria:**
- Branch `contrib/task-0425-validator-*` exists in `knowledge_poly` after POST (verify via `dolt_log` or admin endpoint)
- GET returns the inserted entries with server-stamped `source_type='external_agent'` and `confidence_pct=30`
- Diff shows the new rows as `added` against `main`
- Merge by Derek (session cookie) succeeds; subsequent `core__knowledge_search` from poly agent finds the merged entry
- 401 for unregistered token, 403 for merge-by-non-operator-principal
