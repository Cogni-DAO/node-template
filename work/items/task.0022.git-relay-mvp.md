---
id: task.0022
type: task
title: "Git relay MVP: host-side clone → agent commit → host push + PR"
status: In Progress
priority: 0
estimate: 3
summary: End-to-end git relay for sandbox coder agent — host clones repo into per-run workspace, agent modifies + commits locally, host detects commits and pushes branch + creates PR via GITHUB_TOKEN
outcome: User sends a coding task to sandbox:openclaw-coder, agent edits files and commits, host pushes sandbox/${runId} branch and creates a PR, PR URL returned in GraphFinal.content
spec_refs: openclaw-sandbox-controls-spec, openclaw-sandbox-spec, git-sync-repo-mount-spec
assignees: derekg1729
credit:
project: proj.openclaw-capabilities
branch: feat/task-0022-git-relay-mvp
pr:
reviewer:
created: 2026-02-11
updated: 2026-02-12
labels: [openclaw, sandbox, git-relay, p1]
external_refs:
  - docs/research/sandbox-git-write-permissions.md
---

# Git relay MVP: host-side clone → agent commit → host push + PR

## Requirements

- Host clones target repo into per-run workspace with unique `sandbox/${runId}` branch — agent gets a RW copy
- Agent modifies files and `git add`/`git commit` locally (no credentials needed)
- After container exits, host detects new commits (`git log baseBranch..HEAD`)
- If commits found: host pushes branch, creates PR (via `gh` CLI or GitHub REST API), returns PR URL in `GraphFinal.content`
- If no commits: skip push, clean up normally
- Workspace cleanup deferred until push completes (WORKSPACE_SURVIVES_FOR_PUSH)
- `GITHUB_TOKEN` env var on host only — never in container env
- Concurrent runs safe: unique workspace dir + unique branch name per runId

## Allowed Changes

- `src/adapters/server/sandbox/sandbox-graph.provider.ts` — git relay orchestration in gateway execution path (`createGatewayExecution`)
- `src/adapters/server/sandbox/git-relay.ts` (new) — extracted helper: `cloneForRun()`, `pushIfChanged()`, `createPr()`
- `services/sandbox-openclaw/Dockerfile` — ensure `git` is installed (may already be in `openclaw:local` base)
- `src/shared/env/server.ts` — optional: add `GITHUB_TOKEN` to env schema (or read directly from `process.env`)

## Plan

- [x] Verify `openclaw:local` base image has `git` installed (confirmed: cogni-sandbox-openclaw image has git)
- [x] Gateway workspace config: HOME=/workspace, OPENCLAW_STATE_DIR=/workspace/.openclaw-state, agent workspace→/workspace/current (docker-compose.dev.yml, docker-compose.yml, openclaw-gateway.json, openclaw-gateway.test.json)
- [x] Git identity env vars: GIT_AUTHOR_NAME/EMAIL, GIT_COMMITTER_NAME/EMAIL in gateway container
- [x] Test fixtures: `ensureGatewayWorkspace`, `createGatewayTestClone`, `cleanupGatewayDir` in tests/\_fixtures/sandbox/fixtures.ts
- [x] Smoke tests: workspace bootstrap + git commit tests in sandbox-openclaw-pnpm-smoke.stack.test.ts (pending validation with full stack)
- [x] AGENTS.md: ephemeral deprioritized, gateway-only active mode documented
- [ ] Create `src/adapters/server/sandbox/git-relay.ts` with:
  - `cloneForRun({ repoUrl, baseBranch, runId, workspaceDir })` — `git clone --depth=1 --branch=${baseBranch}`, then `git checkout -b sandbox/${runId}`
  - `pushIfChanged({ workspaceDir, baseBranch, runId, token })` — `git log ${baseBranch}..HEAD` to detect commits, `git push origin sandbox/${runId}` if found
  - `createPr({ owner, repo, head, base, title, body, token })` — GitHub REST API `POST /repos/{owner}/{repo}/pulls` with fetch (zero deps), or `gh pr create` if available
  - All use `child_process.execSync` (host-side, not in container)
- [ ] Wire post-run git relay into `createGatewayExecution()`:
  - After billing, call `pushIfChanged()` on the agent's workspace
  - If PR created, append PR URL to content in `GraphFinal`
  - Defer workspace cleanup until push completes (WORKSPACE_SURVIVES_FOR_PUSH)
- [ ] Add `sandbox:openclaw-coder` to `SandboxAgentCatalogProvider` descriptors so it appears in agent list
- [ ] Manual smoke test: send coding task → verify branch pushed + PR created

## Non-Goals (deferred to robustness phase)

- Stack tests with mock GH (separate task)
- Bare-mirror cache / git worktree optimization
- Max-parallel runs / disk threshold / queue
- `.cogni/pr.md` PR body file convention
- Docker-mode support (app image with git) — MVP targets `pnpm dev:stack` (host-mode)

## Validation

**Preconditions:** `GITHUB_TOKEN` set in host env, `cogni-sandbox-openclaw:latest` built locally, dev stack running.

**Command:**

```bash
pnpm check
```

**Expected:** Lint + type + format clean.

**Manual smoke test:**

1. Start `pnpm dev:stack`
2. Select `sandbox:openclaw-coder` in chat UI
3. Send: "Add a comment to the top of README.md saying 'Updated by sandbox agent'"
4. Verify: branch `sandbox/${runId}` pushed to remote, PR created, PR URL in chat response

## Review Checklist

- [ ] **Work Item:** task.0022 linked in PR body
- [ ] **Spec:** HOST_SIDE_GIT_RELAY, SECRETS_HOST_ONLY, WORKSPACE_SURVIVES_FOR_PUSH upheld
- [ ] **Tests:** `pnpm check` passes (automated tests deferred to robustness task)
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Handoff: [handoff](../handoffs/task.0022.handoff.md)

## Attribution

-
