---
id: task.0371
type: task
title: "Kill PreSync migration hook + migrator image — step 1 hotfix"
status: needs_review
revision: 1
priority: 1
rank: 1
estimate: 2
created: 2026-04-25
updated: 2026-04-25
summary: "Finish the deletion tail PR #1041 designed but did not land: replace Argo PreSync `migrate-node-app` Job with a Deployment initContainer running `migrate.mjs` from the runtime image, retire the `cogni-template-migrate` GHCR build target, and prune all migrator-paired plumbing (image-tags lib, build/promote scripts, fingerprint script, wait-for-argocd hook babysitting). Eliminates the resy-stuck-hook failure class on candidate-a / preview / production simultaneously."
outcome: "One image build per node (no more `*-migrator` companions). Migrations run as Deployment initContainers, gated by `kubectl rollout status` — no Argo PreSync hook Jobs, no stuck-hook-Job operationState wedge class. `migration-job.yaml` deleted; `cogni-template-migrate` GHCR package retired."
spec_refs:
  - docs/spec/databases.md
  - docs/spec/ci-cd.md
assignees: []
project: proj.database-ops
branch: fix/task.0370-step1-init-container-cleanup
bugs:
  - bug.0368
---

# Task: Kill PreSync migration hook + migrator image — step 1 hotfix

PR #1041 landed the additive scope of task.0370 (per-node `migrate.mjs` + `FROM runner AS migrator` Dockerfile rebase) but the deletion tail was deferred. The dev review of the merged state confirmed: migrator image build target + PreSync hook Job manifests are still in tree, and the resy-stuck-hook failure class is still live on candidate-a / preview / production. This task ships the deletion.

## What changes

- **Runtime image bundles `migrate.mjs` + migrations**: each node Dockerfile moves the migration COPYs from the now-deleted `migrator` stage into the `runner` stage. One stage, one image, one digest.
- **Deployment gains an initContainer**: `infra/k8s/base/node-app/deployment.yaml` adds an `initContainers: [migrate]` block invoking `node /app/nodes/$(NODE_NAME)/app/migrate.mjs /app/nodes/$(NODE_NAME)/app/migrations`. Same image as the main `app` container; overlay's `images:` block patches both at once.
- **Poly Doltgres migrates inline too**: poly's overlay (candidate-a + preview only — production poly doesn't run Doltgres) appends a second initContainer `migrate-doltgres` with `DATABASE_URL` mapped to `DOLTGRES_URL_POLY`. `infra/k8s/base/poly-doltgres/` directory deleted.
- **`cogni-template-migrate` build target retired**: `scripts/ci/lib/image-tags.sh` drops `*-migrator` from `ALL_TARGETS`, drops `IMAGE_NAME_MIGRATOR`, collapses `image_name_for_target` to a single return. `build-and-push-images.sh` drops the migrator case arms. `detect-affected.sh` drops the paired-add lines. `merge-build-fragments.sh` drops migrator entries from `canonical_order`.
- **Promote chain simplified**: `promote-k8s-image.sh` drops `--migrator-digest`. `promote-build-payload.sh` + `promote-and-deploy.yml` + `resolve-digests-from-preview.sh` + `promote-preview-seed-main.sh` drop migrator-pairing logic — one digest per app, period.
- **`wait-for-argocd.sh` simplified**: `delete_stale_hook_jobs` and `clear_stale_missing_hook_operation` deleted (no more Argo hook Jobs to babysit). `patch_sync_operation` deleted. The kick is now a single `request_hard_refresh` annotation; `kubectl rollout status` (run after) is the real gate.
- **`compute_migrator_fingerprint.sh` deleted** along with its caller in `ci.yaml` (the `Compute migrator fingerprint and tag` step + the `Try pull migrator by fingerprint` + `Build migrator image` steps).
- **Compose `db-migrate` service** points at `${APP_IMAGE}` with `command: ["node", "/app/nodes/operator/app/migrate.mjs", "/app/nodes/operator/app/migrations"]`.
- **All 12 per-env per-node overlays** drop the `cogni-template-migrate` `images:` entry, drop the `migrate-node-app` Job patch, and add a Deployment patch replacing `initContainers/0/envFrom/1/secretRef/name` to the per-node secret.

## Invariants preserved

- **FORWARD_COMPAT_MIGRATIONS**: every migration must be backward-compatible with the prior code version. Rolling-update overlap means the old pod still serves traffic against the newly-migrated schema briefly. Same obligation as before; `DROP COLUMN` / non-default `NOT NULL` without a two-deploy plan = partial outage.
- **IDEMPOTENT_MIGRATIONS**: drizzle's journal-based migrator is safe on every pod start.
- **CREDENTIAL_SCOPING**: initContainer binds the same `{node}-node-app-secrets.DATABASE_URL` the main container binds (same as the prior Job did). Narrowing to a separate `app_migrator` role with DDL-only privileges remains future work in proj.database-ops P1.

## Validation

exercise: dispatch `candidate-flight.yml` for a PR touching all three nodes (operator + poly + resy).

observability:

- `verify-candidate > Wait for ArgoCD sync` completes with `kubectl rollout status` — no more "waiting for completion of hook batch/Job/X" messages in Argo controller logs.
- `kubectl -n cogni-candidate-a get jobs -l app.kubernetes.io/component=migration` returns **empty** — no PreSync hook Jobs.
- Loki: `{namespace="cogni-candidate-a", container="migrate"} |= "migrations applied"` shows three lines per flight (operator + poly + resy initContainer logs); poly also has a `migrate-doltgres` line with `dolt_commit stamped`.
- `/version.buildSha` on candidate-a-{operator,poly,resy} matches the flown SHA within 2 min of dispatch.
- Failure-path: a syntactically-broken migration leaves the pod in `Init:Error`; old ReplicaSet keeps serving; `kubectl rollout status` non-zero; `verify-buildsha` fails on the flown SHA.

## Out of scope

- Per-env per-node deploy branches (task.0320 redesign — a different dev's track).
- `infra/catalog/*.yaml` becoming the single source of truth for `NODE_TARGETS` / `wait-for-argocd APPS` / detect-affected paths (task.0371 follow-up — orthogonal multiplier).
- Runtime image bloat (~285 MB `@openai/codex` SDK) — `bug.0369` follow-up, not blocking.
