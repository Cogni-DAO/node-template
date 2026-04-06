---
id: bug.0300
type: bug
title: "Work items always empty in k8s deployments — MarkdownWorkItemAdapter reads /app which has no work/items/"
status: needs_triage
priority: 1
rank: 5
estimate: 2
summary: "MarkdownWorkItemAdapter in k8s reads COGNI_REPO_PATH=/app (baked Next.js output). work/items/ doesn't exist there — it's in the git repo, not the Docker image. All work item queries return empty. Dashboard shows 'no work items.' AI tools can't find or manage tasks."
outcome: "Work item queries return actual items in k8s deployments (canary, preview, production)."
spec_refs:
assignees: derekg1729
credit:
project:
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-06
updated: 2026-04-06
labels: [work-items, k8s, deployment, data]
external_refs:
---

# Work Items Always Empty in k8s Deployments

## Requirements

### Observed

`MarkdownWorkItemAdapter` is instantiated with `COGNI_REPO_ROOT` derived from `COGNI_REPO_PATH`. In k8s, the configmap sets:

```yaml
# infra/k8s/base/node-app/configmap.yaml:22
COGNI_REPO_PATH: "/app"
```

`/app` is the Next.js build output directory inside the Docker image. It contains `package.json` and `.cogni/repo-spec.yaml` (baked in at build time), so the env validation passes. But `work/items/` does NOT exist at `/app/work/items/` — work items are markdown files in the git repo, not shipped in the Docker image.

The adapter call chain:

1. `serverEnv()` resolves `COGNI_REPO_ROOT = "/app"` (`server-env.ts:~line 80`)
2. Container wires: `new MarkdownWorkItemAdapter(env.COGNI_REPO_ROOT ?? "/nonexistent")` (`container.ts:~line 540`)
3. Adapter scans: `path.join(workDir, "work", "items")` → `/app/work/items/` → empty directory → zero results

In docker-compose dev, this works because `COGNI_REPO_PATH` points to a git-sync volume (`/repo/current`) that contains the full repo including `work/items/`.

### Expected

Work item queries return actual items from the repository. The dashboard work items page shows real tasks. AI tools (`work_item_query`, `work_item_transition`) function correctly.

### Reproduction

```bash
# In any k8s-deployed pod (canary, preview, production):
kubectl exec -n cogni-canary deploy/operator -- ls /app/work/items/
# Expected: No such file or directory (or empty)

# Vs docker-compose dev:
docker exec app ls /repo/current/work/items/
# Expected: hundreds of .md files
```

Or via the API:

```bash
curl https://test.cognidao.org/api/v1/work/items
# Returns: { "items": [] }
```

### Impact

- **Dashboard**: Work items page shows empty list on all deployed environments
- **AI tools**: `work_item_query` and `work_item_transition` tools return nothing — brain agent can't manage tasks
- **Contributor CLI**: Works locally (reads filesystem), but any deployed API-based usage is broken

## Allowed Changes

- `infra/k8s/base/node-app/configmap.yaml` — fix COGNI_REPO_PATH or add git-sync volume
- `infra/k8s/base/node-app/deployment.yaml` — add git-sync sidecar/initContainer if needed
- `nodes/operator/app/src/bootstrap/container.ts` — adjust adapter wiring if path changes

## Plan

Two possible approaches:

### Option A: git-sync sidecar (matches docker-compose pattern)

Add a git-sync sidecar to the node-app deployment that clones the repo and keeps it updated. Set `COGNI_REPO_PATH` to the git-sync mount path. This is what docker-compose already does.

Pros: Full repo access (work items, docs, scripts). Cons: Extra container, storage, network.

### Option B: Bake work/items/ into Docker image

Add `work/` to the Dockerfile COPY step so work items are available at `/app/work/items/` at build time.

Pros: Simple, no sidecar. Cons: Work items are stale (frozen at build time, not updated on git push). Write operations (claim, transition) would modify container-local files that are lost on restart.

### Recommendation

**Option A** (git-sync) for full functionality. The k8s deployment already has a git-sync pattern established in docker-compose — port it to k8s as an initContainer + shared volume.

- [ ] Determine approach
- [ ] Implement fix
- [ ] Verify work items appear on canary dashboard

## Validation

```bash
curl https://test.cognidao.org/api/v1/work/items | jq '.items | length'
```

**Expected:** Non-zero count (currently ~300 active items).

## Review Checklist

- [ ] **Work Item:** `bug.0300` linked in PR body
- [ ] **Tests:** Work items API returns real data on canary
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Related: task.0299 (contributor quickstart — CLI uses same adapter locally)
- Related: `packages/work-items/src/adapters/markdown/adapter.ts` (the adapter)

## Attribution

-
