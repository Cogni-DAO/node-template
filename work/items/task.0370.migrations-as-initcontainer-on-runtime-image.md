---
id: task.0370
type: task
title: "Migrations as initContainer on runtime image; delete migrator image + PreSync hook"
status: needs_design
revision: 2
priority: 1
rank: 1
estimate: 3
summary: "Collapse the migrator-image-per-node + Argo-PreSync-hook pattern into an initContainer on the app Deployment, reusing the runtime app image. Eliminates ~4min of image-pull-per-node from every candidate-flight and shrinks build surface by one image per node. Addresses bug.0368."
outcome: "One image per node (operator/poly/resy). No Argo hooks on node-app. `verify-candidate` wait drops to ~60s end-to-end on the zero-migrations path. `kubectl get jobs -l component=migration` returns empty on all envs."
spec_refs:
  - docs/spec/ci-cd.md
  - docs/spec/databases.md
assignees: []
credit:
project: proj.database-ops
branch: fix/candidate-flight-migrator-image-pull
bugs:
  - bug.0368
---

# Task: migrations as initContainer on runtime image

## Goal

Delete the migrator-image-per-node + Argo PreSync-hook pattern for `node-app`. Run migrations as an **initContainer on the node-app Deployment using the same image digest as the main container**. Rationale + evidence: `work/items/bug.0368`.

## Design (revision 2 — folds /review-design critique)

### The one idea

An initContainer on the main Deployment, sharing the main container's image, is the correct k8s-native expression of "migrations run before the app." Argo hooks + standalone migrator images are an accidental expansion of that single idea into two images, two Deployments-worth of lifecycle, and a separate Argo phase machine. Collapse.

### Hard invariants (load-bearing — code-gate these)

1. **FORWARD_COMPAT_MIGRATIONS** — every migration must be forward-compatible with the prior code version. With `strategy: RollingUpdate, replicas ≥ 1`, the old pod continues to serve traffic against the newly-migrated schema between the moment the new pod's initContainer commits and the moment the old pod is terminated. A `DROP COLUMN` or non-default `NOT NULL` during that window = partial outage. This invariant holds under today's PreSync-hook pattern equally; we are making it explicit, not weakening it. Follow-up (task.0371): CI lint that fails on destructive SQL without an explicit `-- needs_two_deploys: true` pragma.

2. **IDEMPOTENT_MIGRATIONS** — `drizzle-orm/postgres-js/migrator` reads `drizzle.__drizzle_migrations` journal, applies only new rows. Running twice (e.g. during PR A / PR B overlap where both hook + init are present) is safe — second run is a no-op.

3. **CREDENTIAL_SCOPING** (preserved) — initContainer binds the same `{node}-node-app-secrets.DATABASE_URL` the main container binds in each env overlay. No credential broadening. Separating into a migration-specific role with narrower DDL rights is deferred to the P1 work in proj.database-ops (credential convergence) — out of scope here.

4. **ONE_IMAGE_PER_NODE** — after PR B, each node ships exactly one image: `ghcr.io/cogni-dao/cogni-template[-{poly,resy}]:{sha}`. No more `-migrate` suffix.

### Scope split — three PRs

This task ships in three reviewable slices. PR B is irreversible (deletes GHCR build surface); gated behind PR A proving out on candidate-a for ≥ 1 day.

**PR A — additive (merge-safe, reversible)**
- Add `nodes/{operator,poly,resy}/app/src/adapters/server/db/migrate.mjs` — ~20-line script using `drizzle-orm/postgres-js/migrator` against `./migrations` resolved relative to the script path.
- Runtime Dockerfile `runner` stage: `COPY` migrations dir + `migrate.mjs` + ensure `drizzle-orm` + `postgres` resolve at runtime (both already `serverExternalPackages` in next.config.ts; verify standalone output includes them, else force via `outputFileTracingIncludes`).
- `base/node-app/deployment.yaml` gains `initContainers: [{ name: migrate, image: <same digest>, command: ["node", "/app/…/migrate.mjs"], envFrom: <same as main> }]`.
- Overlays unchanged in this PR (still list migrator image + still patch migration-job secret refs — dead-but-working).
- Overlap period: PreSync hook AND initContainer both run per sync. Both apply drizzle-orm migrator against the journal; second invocation no-ops. Safe by `IDEMPOTENT_MIGRATIONS`.

**PR B — cleanup (irreversible, single atomic switchover)**
- Delete `infra/k8s/base/node-app/migration-job.yaml` + its entry in `base/node-app/kustomization.yaml:resources`.
- Delete migrator stage (`FROM base AS migrator`) from `nodes/{operator,poly,resy}/app/Dockerfile`.
- Delete migrator target entries in `scripts/ci/lib/image-tags.sh` + every caller that hand-iterates migrator tags.
- Delete migrator digest lines from the 12 overlay files (enumerated below).
- Delete `scripts/ci/compute_migrator_fingerprint.sh` + its caller in `ci.yaml`.
- Delete hook-Job machinery from `scripts/ci/wait-for-argocd.sh`: `delete_stale_hook_jobs`, `clear_stale_missing_hook_operation`, `patch_sync_operation` hook-sync payload. Keep `request_hard_refresh` (still useful for non-hook slow-poll speedup).
- Update `docs/spec/databases.md` §2 + §4.1 + §5 + §6.4 to describe the post-cleanup state (done in this task's same PR-A if spec stays ahead of code, or folded into PR B — pick one; see Staging).

**PR C — poly-doltgres (separate validation surface)**
- Validate `drizzle-orm/postgres-js/migrator` against Doltgres's non-compliant extended-protocol implementation before applying the same pattern. Memory: postgres.js extended protocol is broken on Doltgres; adapter uses `sql.unsafe()`. If the migrator wedges, fall back to (a) keeping the Doltgres Job as-is, or (b) a bespoke migrate script that issues raw SQL via `sql.unsafe`.
- Same initContainer shape, applied to `base/poly-doltgres/` Deployment (or whichever Deployment talks to Doltgres).
- Separate task id; not blocking PR A or PR B.

### Overlay enumeration (PR B must update all 12)

```
infra/k8s/overlays/canary/operator/kustomization.yaml
infra/k8s/overlays/canary/poly/kustomization.yaml
infra/k8s/overlays/canary/resy/kustomization.yaml
infra/k8s/overlays/candidate-a/operator/kustomization.yaml
infra/k8s/overlays/candidate-a/poly/kustomization.yaml
infra/k8s/overlays/candidate-a/resy/kustomization.yaml
infra/k8s/overlays/preview/operator/kustomization.yaml
infra/k8s/overlays/preview/poly/kustomization.yaml
infra/k8s/overlays/preview/resy/kustomization.yaml
infra/k8s/overlays/production/operator/kustomization.yaml
infra/k8s/overlays/production/poly/kustomization.yaml
infra/k8s/overlays/production/resy/kustomization.yaml
```

Per overlay, PR B deletes:
- The `ghcr.io/cogni-dao/cogni-template-migrate` entry in the `images:` block
- The `Job / migrate-node-app` patch target (and for poly, `Job / migrate-poly-doltgres` — **preserved** until PR C)

Post-`canary` retirement (memory: canary branch is dead), the canary overlay dir is separately retirable — not this task.

### Surface changes

**Delete** (PR B):

| Surface | Delete | Reason |
| --- | --- | --- |
| `infra/k8s/base/node-app/migration-job.yaml` | 43 lines | PreSync hook itself |
| Migrator stage in each of 3 node Dockerfiles | ~12 lines each | Stage no longer built |
| Migrator entries in `scripts/ci/lib/image-tags.sh` | per-node `*-migrate` | Target gone |
| Migrator build legs in `.github/workflows/pr-build.yml` | matrix entries (via lib/image-tags.sh) | Follows |
| Migrator digest resolution in `resolve-pr-build-images.sh` | per-node migrator tag lookups | Follows |
| Migrator digest writes in `promote-build-payload.sh` | per-node migrator promotion | Follows |
| `scripts/ci/compute_migrator_fingerprint.sh` | whole file | No caller |
| Fingerprint step in `.github/workflows/ci.yaml` | the `FINGERPRINT=$(...)` block | Dead |
| Hook-Job machinery in `scripts/ci/wait-for-argocd.sh` | ~80 lines of the 443 | No hooks to babysit |

**Add** (PR A):

| Surface | Add | Size |
| --- | --- | --- |
| `nodes/{operator,poly,resy}/app/src/adapters/server/db/migrate.mjs` | programmatic-migrator script | ~20 lines each |
| `nodes/{operator,poly,resy}/app/Dockerfile` `runner` stage | `COPY migrations + migrate.mjs`; conditionally `outputFileTracingIncludes` pattern in next.config.ts | 3–5 lines per Dockerfile + 1 next.config adjustment |
| `infra/k8s/base/node-app/deployment.yaml` | `initContainers:` block using `envFrom` = same as main container | ~12 lines |

**Net after PR A + PR B**: ~150 LOC deleted, ~60 added, 3 fewer files, 3 fewer image builds per PR (one per node).

### Template — migrate.mjs (per-node; example: operator)

```mjs
// nodes/operator/app/src/adapters/server/db/migrate.mjs
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url = process.env.DATABASE_URL?.trim();
if (!url) { console.error("FATAL: DATABASE_URL required"); process.exit(2); }

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "migrations");
const sql = postgres(url, { max: 1 });
try {
  const t0 = Date.now();
  await migrate(drizzle(sql), { migrationsFolder });
  console.log(`✅ operator migrations applied in ${Date.now() - t0}ms`);
} finally {
  await sql.end({ timeout: 5 });
}
```

Three identical files differing only in the log-line node name and the migrations dir location (if any node uses a different path). Trade-off accepted vs. one shared script: per-node script ships with that node's image and points at that node's migration dir literally — no env var, no indirection, dead simple.

### Template — Deployment initContainer

```yaml
# infra/k8s/base/node-app/deployment.yaml (partial)
spec:
  template:
    spec:
      initContainers:
        - name: migrate
          image: placeholder  # overlay images: block patches this to same digest as main
          command:
            - node
            - /app/nodes/node-app/src/adapters/server/db/migrate.mjs  # overlay patches 'node-app' path segment per node
          envFrom:
            - secretRef:
                name: node-app-secrets  # overlay patches to {node}-node-app-secrets
          resources:
            requests: { memory: "256Mi", cpu: "100m" }
            limits:   { memory: "512Mi", cpu: "500m" }
      containers:
        - name: node-app
          image: placeholder  # same digest (kustomize images: block patches both)
          envFrom:
            - secretRef:
                name: node-app-secrets
          ...
```

The overlay's existing `images:` block already patches every container reference to `ghcr.io/cogni-dao/cogni-template` to the same digest — extending that to the initContainer image is free (kustomize `images:` by name matches all references).

## Staging (PR order, gates between)

1. **PR A merges.** Flight to candidate-a once. Verify: both PreSync hook Job **and** initContainer run per sync, both complete; `/version.buildSha` correct; app serves traffic. Let it bake ≥ 24h on candidate-a.
2. **docs/spec/databases.md pre-update.** Same PR as B, or a tiny doc-only PR between A and B. Preferred: fold into PR B so spec + code land together (the rule in `docs/spec/docs-work-system.md#content-boundaries`: specs describe as-built, not aspirational).
3. **PR B merges.** Flight to candidate-a. Verify: `kubectl -n cogni-candidate-a get jobs -l app.kubernetes.io/component=migration` returns empty; single image per node; `/version.buildSha` correct.
4. **Promote-forward to preview** via normal `flight-preview.yml`. Verify preview identically.
5. **Promote-forward to production** via normal dispatch.
6. **PR C (poly-doltgres)** opens after PR B proves out.

## Validation

exercise: Dispatch `candidate-flight.yml` for a PR that touches all three nodes.

observability (PR A baseline):
- `verify-candidate > Wait for ArgoCD sync` still 4–9 min (hooks still running). Unchanged by PR A alone.
- `kubectl -n cogni-candidate-a get pods -l app.kubernetes.io/component=migration` shows hook-Job pods (existing).
- New: `kubectl -n cogni-candidate-a get pods -l app.kubernetes.io/name=node-app -o jsonpath='{.items[*].spec.initContainers[*].name}'` shows `migrate migrate migrate`.
- Loki: `{namespace="cogni-candidate-a"} |~ "migrations applied"` shows two parallel applies per promoted node (hook + init) per sync, each < 15s.

observability (PR B, the actual win):
- `verify-candidate > Wait for ArgoCD sync` ≤ 90s.
- `kubectl get jobs -l app.kubernetes.io/component=migration` returns empty.
- `/version.buildSha` on candidate-a-{operator,poly,resy} matches flown SHA within 2min.
- Failure-path: intentionally-broken SQL migration → new pod `Init:Error`; old ReplicaSet keeps serving; `kubectl rollout status` non-zero; `verify-buildsha.sh` hard-fails (same surface as a failed hook today).

## Out of scope

- poly-doltgres → PR C (validated separately).
- Removing Argo Image Updater (redundant with `promote-build-payload.sh`; separate follow-up).
- Parallelizing the per-app wait loop in `wait-for-argocd.sh` (unnecessary after hook removal).
- Propagating candidate-a's 30s Argo reconciliation poll to preview/production (different throughput posture; not the bottleneck).
- Splitting migration credentials to a narrower DDL role — deferred to proj.database-ops P1 credential convergence work, where the wider role-hardening design lives.
- Consolidating three per-node Dockerfiles into one templated Dockerfile (tempting; orthogonal).
- Atlas / dbmate evaluation — tracked in task.0325 (proj.database-ops roadmap).
- CI lint for destructive SQL without `needs_two_deploys` pragma — follow-up task.0371.

## Risks (residual, after mitigations)

| Risk | Mitigation in this task | Residual |
| --- | --- | --- |
| Drizzle `postgres-js/migrator` subpath pruned by Next.js standalone tracing | Both `drizzle-orm` + `postgres` are already in `serverExternalPackages`; subpath should resolve. Verify with `node -e "import('drizzle-orm/postgres-js/migrator').then(...)"` against the built standalone image before PR A merge. Fallback: `outputFileTracingIncludes` pattern. | Low — verifiable in CI locally on built image |
| Migration pod OOMs with new resource limits | Mirror existing migration-job.yaml limits (`1Gi` limit, `384Mi` request) on the initContainer, not the smaller template shown above | Low — drop-in match |
| Next pod cold-start + 1–3s of no-op migration on every restart (drizzle reads journal even when there's nothing to apply) | Acceptable; pod restarts are rare | Low |
| Overlay edits in PR B miss an env, digest promotion breaks | Grep-verify `grep -rn "cogni-template-migrate" infra/k8s/overlays/` returns empty after PR B; CI job `check-gitops-manifests.sh` + `check-image-updater-scope.sh` catch dangling references | Low |
| Forward-compat invariant gets violated in the future | Follow-up task.0371 CI lint; for now, code review | Medium (convention-only until task.0371) |

## Links

- bug.0368 — diagnosis + evidence
- docs/spec/databases.md — updated in PR B (§2 Migration Strategy + §4.1 Docker Image Architecture + §5 Trade-offs + §6.4 removed)
- work/projects/proj.database-ops.md — new roadmap row in Crawl-phase
- task.0322 — introduced per-node migrator image split (this task partially reverses — the per-node *migrations ownership* invariant stays; only the *per-node migrator image* goes)
- task.0325 — Atlas evaluation (preserved, unchanged)
- task.0371 (follow-up) — CI lint for destructive SQL without `needs_two_deploys` pragma
