---
id: task.0122
type: task
title: "Operator: fetch and parse repo-spec from installed Node repos via GitHub API"
status: needs_implement
priority: 1
rank: 2
estimate: 2
summary: "Add a GitHub API-based repo-spec fetcher to the operator plane so that when external projects install our GitHub App, we can read their `.cogni/repo-spec.yaml` and configure their tenant accordingly."
outcome: "The operator can fetch, validate, and cache a parsed `RepoSpec` for any repo where the GitHub App is installed. Individual Nodes continue reading their own repo-spec from disk — this is operator-only infrastructure."
spec_refs: node-operator-contract-spec
assignees: derekg1729
credit:
project: proj.operator-plane
branch:
pr:
reviewer:
revision: 0
blocked_by: task.0120
deploy_verified: false
created: 2026-03-01
updated: 2026-03-01
labels: [operator, github-app, config, multi-tenant]
external_refs:
---

# Operator: Fetch and Parse Repo-Spec from Installed Node Repos via GitHub API

## Context

Our GitHub App is installed into external repos (Node deployments). Each Node authors its own `.cogni/repo-spec.yaml` declaring identity, payment rails, approvers, and governance config. Per **REPO_SPEC_AUTHORITY**: "Node authors `.cogni/repo-spec.yml`; Operator consumes snapshot+hash; Operator never invents policy."

Today the app only reads repo-spec from **local disk** (`fs.readFileSync` at `process.cwd()/.cogni/repo-spec.yaml`). The GitHub App has installation tokens for each repo but **never fetches file contents** — it only queries activity metadata (PRs, reviews, issues) via GraphQL.

For the operator plane (multi-tenant gateway, story.0116), we need to read repo-specs from _installed_ repos so we can:

- Onboard tenants by reading their declared config (DAO wallet, payment rails, approvers)
- Validate their repo-spec against our schemas before provisioning
- Periodically sync config changes (repo-spec is governance-managed, may change over time)

**This is operator-only infrastructure.** Individual Nodes continue reading their own repo-spec from disk via `src/shared/config/repoSpec.server.ts`. This task adds a _new_ code path used exclusively by the operator when servicing external Node installations.

## Requirements

### GitHub App permissions

- [ ] Verify the GitHub App has `contents: read` permission. If not, document the required permission update (configured in GitHub's app settings UI, not in code).

### Remote repo-spec fetcher

- [ ] New module (likely in `services/scheduler-worker/src/adapters/` or a new operator-scoped location) that fetches `.cogni/repo-spec.yaml` from a repo via `octokit.repos.getContent({ owner, repo, path: ".cogni/repo-spec.yaml" })`
- [ ] Uses existing GitHub App installation token infrastructure (`github-auth.ts` → `VcsTokenProvider`) — no new auth setup needed
- [ ] Decodes the base64 content returned by GitHub API
- [ ] Passes the raw YAML string to `parseRepoSpec()` from `@cogni/repo-spec` (task.0120)
- [ ] Returns the validated, typed `RepoSpec` or a structured error (missing file, invalid YAML, schema validation failure)

### Error handling

- [ ] **Missing file** (404 from GitHub) — clear error: "No .cogni/repo-spec.yaml found in {owner}/{repo}"
- [ ] **Invalid YAML** — surface Zod validation errors so the Node operator can fix their config
- [ ] **Permission denied** (403) — clear error: "GitHub App lacks contents:read permission for {owner}/{repo}"

### Tests

- [ ] Unit test with mocked Octokit — happy path (valid repo-spec), 404, 403, invalid YAML
- [ ] Integration note: can be tested against a real repo with `pnpm test:external` if desired (not required)

## Allowed Changes

- `services/scheduler-worker/src/adapters/` — new fetcher module (or new operator-scoped directory)
- `services/scheduler-worker/package.json` — add `@cogni/repo-spec` workspace dep (if not already added by task.0120)
- `services/scheduler-worker/tests/` — new unit tests for remote fetcher
- GitHub App settings (external, documented only) — `contents: read` permission if missing

## Plan

- [ ] Step 1: Verify GitHub App permissions — check if `contents: read` is already configured. Document finding.
- [ ] Step 2: Create remote repo-spec fetcher module — uses existing Octokit client + installation tokens, calls `repos.getContent`, decodes base64, pipes to `parseRepoSpec()`.
- [ ] Step 3: Write unit tests — mock Octokit responses for happy path, 404, 403, malformed YAML.
- [ ] Step 4: `pnpm check`, file headers, update work item status.

## Design Notes

### Node vs Operator boundary

This is a clean operator-only concern. The fetch path is:

```
Operator receives GitHub App installation event
  → resolves installation token (existing infra)
  → fetches .cogni/repo-spec.yaml via GitHub Contents API
  → parseRepoSpec(yamlString) via @cogni/repo-spec package
  → provisions tenant config from validated RepoSpec
```

Nodes never use this path. They read from disk. The `@cogni/repo-spec` package (task.0120) is the shared layer — same Zod schemas, same types, different I/O.

### Why `repos.getContent` and not a git clone

- We need one file, not a full checkout
- `getContent` returns base64-encoded file contents for files up to 1MB — more than sufficient for a YAML config
- Uses the same installation token we already have — no additional auth
- No disk I/O on the operator side

## Validation

**Command:**

```bash
pnpm check && pnpm test services/scheduler-worker/tests/<fetcher-test>.ts
```

**Expected:** All tests pass. Fetcher correctly parses valid repo-specs and surfaces clear errors for missing/invalid configs.

## Review Checklist

- [ ] **Work Item:** `task.0122` linked in PR body
- [ ] **Spec:** REPO_SPEC_AUTHORITY upheld — operator consumes, never invents policy
- [ ] **Tests:** mocked Octokit tests for all error cases
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
