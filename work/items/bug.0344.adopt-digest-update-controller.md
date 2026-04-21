---
id: bug.0344
type: bug
title: Hand-curated overlay digests drift on every unrelated flight — adopt a digest-update controller
status: needs_implement
priority: 0
rank: 1
estimate: 5
summary: "Main's `infra/k8s/overlays/*/<service>/kustomization.yaml` digest fields are hand-maintained seeds. Every flight runs `rsync -a --delete` of main's overlay onto the deploy branch, then `promote-k8s-image.sh` bumps digests only for apps in the affected-targets set (`scripts/ci/detect-affected.sh`). Services not touched by the flight's PR inherit main's seed — if the seed is stale, the deploy branch silently reverts to a pre-feature image on every unrelated flight. Produced #970 (poly-doltgres migrator with missing script → ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND), #971 (scheduler-worker pre-multi-queue → 30–40s silent chat hang on preview + candidate-a), #972 (operator + resy pre-BUILD_SHA → /readyz.version=0 → verify-buildsha fails every flight). Manual per-service bumps are sunk cost on a dying pattern and don't scale past v0."
outcome: "Git is eventually-consistent with GHCR. Argo CD Image Updater watches the `deploy/preview` Applications for new `preview-*` image tags and commits fresh digests back to `main`. Unrelated flights inherit a current seed and never regress a service's digest. `scripts/ci/promote-k8s-image.sh` + hand-bumps disappear from the routine flow. Zero new bespoke GitHub Actions workflows."
spec_refs:
  - ci-cd
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch: design/bug-0344-digest-updater
pr:
deploy_verified: false
reviewer:
revision: 0
blocked_by:
created: 2026-04-21
updated: 2026-04-21
labels: [cicd, infra, gitops, drift, argo]
external_refs:
  - scripts/ci/promote-k8s-image.sh
  - scripts/ci/detect-affected.sh
  - .github/workflows/candidate-flight.yml
  - .github/workflows/flight-preview.yml
  - infra/k8s/argocd/preview-applicationset.yaml
  - docs/spec/ci-cd.md
---

# Adopt a digest-update controller — retire manual overlay-digest maintenance

## Problem

Two sources of truth drift:

1. **The image in GHCR** — produced by `pr-build.yml` on every commit matching `scripts/ci/detect-affected.sh` rules, re-tagged `preview-{mainSHA}` by `flight-preview.yml` on merge.
2. **The digest reference in `infra/k8s/overlays/*/<service>/kustomization.yaml` on `main`** — hand-curated.

Flights preserve (1) but overwrite deploy branches from (2). Services whose source hasn't changed in a PR inherit main's stale digest. The failure mode is silent: `/readyz.version=0` (pre-BUILD_SHA images), chat hangs (pre-multi-queue scheduler-worker), migrator crashes (missing script). Every "one-line digest bump" PR (#970, #971, #972) is the same anti-pattern.

## Design

### Outcome

A dedicated controller makes `main`'s overlay digest seed **eventually-consistent with GHCR's `preview-*` tags** — the only tag class that represents merged, accepted code. Any flight that rsyncs main→deploy-branch now pulls a current seed; unrelated services never silently regress.

### Approach

**Solution**: Install **Argo CD Image Updater** (argoproj-labs, Apache-2.0) into the existing `argocd` namespace. Annotate each preview Application (generated from `preview-applicationset.yaml`) with an image-list + `write-back-method: git` + `git-branch: main`. The controller polls GHCR, finds new `preview-{sha}` digests, and commits digest updates back to `main`'s overlay kustomization files. Commits authored by a dedicated `cogni-image-updater[bot]` identity so `git blame` makes drift incidents traceable.

**Reuses**:

- **Argo CD Image Updater v0.18.x (annotation-based)** — 2K-star argoproj-labs project, latest Helm chart `1.1.5` published 2026-04-08, active maintainers (chengfang, dkarpele), aligned with our already-installed Argo CD v2.13.4 via the legacy `latest-annotation-based` image tag. We pin to a specific image digest for reproducibility.
- **Existing `preview-applicationset.yaml`** — annotated in place; no new AppSet.
- **Existing `infra/k8s/argocd/kustomization.yaml`** — the Image Updater install manifest slots in alongside `install.yaml` and `ksops-cmp.yaml`.
- **Existing per-service `kustomization.yaml` `images:` blocks** — controller writes the `digest:` field using the same syntax `promote-k8s-image.sh` already edits; no schema change.
- **Existing GHCR pull credentials** on Argo CD repo-server — reused for registry access.

### Why watch `deploy/preview`, not `deploy/candidate-a`

`candidate-a` flies arbitrary PR builds (including unmerged / failed ones) via `candidate-flight.yml` — bumping `main`'s seed off a candidate-a build would propagate unaccepted code to every other service's seed. `deploy/preview` only receives digests from `flight-preview.yml`, which re-tags `pr-{N}-{sha} → preview-{mainSHA}` exclusively on merge. Every `preview-*` tag therefore represents accepted code — the correct signal to promote into `main`'s seed.

### Why write to `main`, not to the Application's source branch

Image Updater's default is to write to the Application's source branch (`deploy/preview` in our case). That's wrong for us — `deploy/preview` is machine-managed state that gets rsynced from `main` on every promotion. Writing there creates a fight with `promote-k8s-image.sh` and would be clobbered on the next flight. The `argocd-image-updater.argoproj.io/git-branch: main` annotation (per-Application) redirects the write-back to `main`, where the seed actually lives. `promote-k8s-image.sh` stays the authoritative pinner for flight-specific digests on `deploy/*`; Image Updater stays the authoritative seed-keeper on `main`. No fight.

### Why it doesn't fight with the flight workflow

| Writer                              | Target                          | Trigger                            | Owns                                           |
| ----------------------------------- | ------------------------------- | ---------------------------------- | ---------------------------------------------- |
| `promote-k8s-image.sh` (candidate)  | `deploy/candidate-a` overlay    | PR flight                          | Pins the chosen PR's digest on the flight slot |
| `promote-k8s-image.sh` (preview)    | `deploy/preview` overlay        | merge-to-main flight               | Pins merged code's digest on the preview slot  |
| `promote-k8s-image.sh` (production) | `deploy/production` overlay     | manual `promote-to-production.yml` | Pins preview's validated digest on production  |
| **Argo CD Image Updater (new)**     | **`main` overlay (all 3 envs)** | continuous poll of GHCR            | Keeps `main`'s seed fresh for every app        |

Rsync (`INFRA_K8S_MAIN_DERIVED`, Axiom 17) still wins on deploy branches: `main → deploy/<env>` then `promote-k8s-image.sh` overrides affected apps. The controller's commits to `main` arrive asynchronously — if a flight rsyncs before Image Updater catches up, the next flight will catch it. That's the "eventually-consistent" in the outcome statement.

### Rejected alternatives

- **Flux `ImageUpdateAutomation`** — strong policy language, actively maintained. Rejected: running the full Flux controller stack alongside Argo CD doubles the CRD surface and operational burden for a single capability we can get from an Argo-native sibling project.
- **Renovate (digest-pinning mode)** — battle-tested, already common in npm workflows. Rejected: opens a PR per digest bump. With 7 targets (`operator`, `operator-migrator`, `poly`, `poly-migrator`, `resy`, `resy-migrator`, `scheduler-worker`) and one merge producing 7 PRs, the review noise exceeds the drift savings. Image Updater's direct-commit mode is strictly simpler for this workload.
- **Custom GitHub Actions workflow that commits digests to `main`** — explicitly forbidden by invariant `NO_BESPOKE_DIGEST_WORKFLOW`. This is the shape of the bug, not the fix.
- **Extend `promote-k8s-image.sh` to also commit to `main`** — same failure mode: a one-shot script owned by nobody, still driven by the flight workflow's affected-only logic (the exact source of drift).

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] **NO_BESPOKE_DIGEST_WORKFLOW** — solution is adoption of the existing Image Updater project, not a new `.github/workflows/*.yml` that commits digests. Fail if the PR adds a workflow whose purpose is "commit digest updates to main".
- [ ] **DIGEST_IMMUTABILITY_PRESERVED** — Image Updater is configured with `update-strategy: digest` (never `latest`). `IMAGE_IMMUTABILITY` axiom (`docs/spec/ci-cd.md`) untouched. Verify: the controller's `allow-tags` regex matches only `^preview-[0-9a-f]{40}$` (post-merge immutable tag class), never `latest` / `stable` / floating tags.
- [ ] **COMMIT_PROVENANCE_VISIBLE** — every digest-update commit on `main` is authored by the dedicated `cogni-image-updater[bot]` identity (distinct from `github-actions[bot]`) and its commit message includes the source image tag. `git log --author=cogni-image-updater -- infra/k8s/overlays/` returns a clean audit trail.
- [ ] **SCOPE_IS_MAIN_ONLY** — Image Updater writes to `main` only. Deploy branch digest promotion (`promote-k8s-image.sh` during candidate/preview/production flights) stays as-is. Verify: no Image Updater annotation points `git-branch` at a `deploy/*` branch.
- [ ] **PRODUCTION_NOT_AUTO_UPDATED** — production flights require explicit human dispatch via `promote-to-production.yml`. The controller watches only `deploy/preview`'s Applications; annotations on `production-applicationset.yaml` are **not** added. Verify: `infra/k8s/argocd/production-applicationset.yaml` has zero `argocd-image-updater.argoproj.io/*` annotations.
- [ ] **SIMPLE_SOLUTION** — leverages the upstream install manifest as a remote Kustomize resource (same pattern as `install.yaml: https://raw.githubusercontent.com/argoproj/argo-cd/v2.13.4/manifests/install.yaml`). No forking, no vendoring, no custom Helm values file beyond a minimal patch for registry + git credentials.
- [ ] **ARCHITECTURE_ALIGNMENT** — installs into the existing `argocd` namespace via the existing `infra/k8s/argocd/kustomization.yaml`. Credentials use existing GHCR pull-secret reference. No new namespace, no new secret management pattern.

### Wiring (concrete)

```text
pr-build.yml (per PR)
  └─ builds pr-{N}-{sha} in GHCR

flight-preview.yml (on merge to main)
  ├─ re-tags pr-{N}-{sha} → preview-{mainSHA} in GHCR   ← ✅ stable tag published
  └─ writes deploy/preview overlay digest via promote-k8s-image.sh

Argo CD Image Updater (continuous, every 2m default poll)
  ├─ watches: Applications generated from preview-applicationset.yaml (candidate-a and production intentionally excluded)
  ├─ registry: ghcr.io/cogni-dao/* with tag filter ^preview-[0-9a-f]{40}$, update-strategy: digest
  └─ on new digest:
        write-back-method: git
        git-branch: main                                 ← ✅ writes to main, not deploy/preview
        write-back-target: kustomization:./infra/k8s/overlays/<env>/<app>/
        commit-author: cogni-image-updater[bot]          ← ✅ provenance
        → updates digest: "sha256:..." in all 3 env overlays on main

next flight (candidate-a or preview)
  └─ rsync main → deploy/<env>  (Axiom 17)              ← ✅ picks up fresh seed
     └─ promote-k8s-image.sh bumps affected apps only   ← ✅ non-affected apps now have CURRENT seed, not stale one
```

### Files

**Create:**

- `infra/k8s/argocd/image-updater/kustomization.yaml` — references upstream install manifest pinned by version (e.g. `https://raw.githubusercontent.com/argoproj-labs/argocd-image-updater/v0.18.0/manifests/install.yaml`) plus local patches.
- `infra/k8s/argocd/image-updater/registry-secret-patch.yaml` — patches the controller's ConfigMap to mount GHCR pull credentials for registry scanning (reuses existing `ghcr-pull-secret` reference).
- `infra/k8s/argocd/image-updater/git-credentials-patch.yaml` — mounts a secret containing a GitHub App private key (or PAT) with push access to `main` for `infra/k8s/overlays/**`. Secret itself delivered by the existing ksops CMP (same pattern as every other cluster secret today).
- `docs/runbooks/image-updater-bootstrap.md` — one-page runbook: generating the GitHub App, installing its private key via ksops, validating the first auto-commit, rolling back if the controller misbehaves.

**Modify:**

- `infra/k8s/argocd/kustomization.yaml` — add `image-updater/` to `resources:` so the controller is installed alongside the existing `install.yaml`.
- `infra/k8s/argocd/preview-applicationset.yaml` — add the seven `argocd-image-updater.argoproj.io/*` annotations on the `template.metadata.annotations` block: `image-list`, `<alias>.update-strategy`, `<alias>.allow-tags`, `<alias>.pull-secret`, `write-back-method`, `git-branch`, `write-back-target`. Per-service `image-list` per the target catalog (`operator`, `operator-migrator`, `poly`, `poly-migrator`, `resy`, `resy-migrator`, `scheduler-worker`).
- `docs/spec/ci-cd.md` § Deploy Branch Rules — replace the current "⚠️ Known anti-pattern: main's overlay digests are hand-curated seeds." callout with a description of the controller's role (seed-keeper on `main`) and a pointer to this bug's PR and the bootstrap runbook.
- `work/projects/proj.cicd-services-gitops.md` row 21 (Active Blockers) — flip status once controller is in steady-state across `preview-{sha}` bumps for at least 3 consecutive merges.

**Test / Validation:**

- `docs/runbooks/image-updater-bootstrap.md` includes the explicit test: push a trivial change to `nodes/resy/app/...`, merge, observe `flight-preview.yml` re-tag to `preview-<merge-sha>` in GHCR, observe within 5 minutes a bot-authored commit on `main` updating `infra/k8s/overlays/{candidate-a,preview,production}/resy/kustomization.yaml` to the new `sha256:...`.

## Validation

**exercise:**

1. On `main`, capture current digest for any one service (e.g. `resy` in `infra/k8s/overlays/preview/resy/kustomization.yaml`): `D0`.
2. Merge a no-op change that touches `nodes/resy/**` (triggers `pr-build` → `flight-preview` → new `preview-{mergeSHA}` tag). Capture new GHCR digest: `D1`.
3. Wait ≤ 5 minutes.
4. Expect: a bot-authored commit on `main` has landed with author `cogni-image-updater[bot]`, touching all three overlay files (`candidate-a/resy`, `preview/resy`, `production/resy`) and setting `digest: "D1"`.
5. Trigger a `candidate-flight.yml` for an **unrelated** PR (e.g. one touching only `nodes/poly/**`). After flight success, inspect `deploy/candidate-a:infra/k8s/overlays/candidate-a/resy/kustomization.yaml`: resy's digest must equal `D1` (fresh seed inherited), not `D0` (the stale pre-Image-Updater value).

**observability:**

- `{app="argocd-image-updater"}` in Loki shows `level=info msg="Successfully updated image"` for each processed Application, with the target digest in the payload.
- `git log --author="cogni-image-updater" --since="1 hour ago" -- infra/k8s/overlays/ infra/k8s/overlays/preview/resy/kustomization.yaml` returns at least one commit for the resy change.
- `argocd app get candidate-a-resy -o json | jq '.status.summary.images'` at rest matches the latest `main` seed for resy.

## Blocked by / prerequisites

- **GitHub App registration** for the `cogni-image-updater[bot]` identity with `contents: write` scope on the repo. Write via ksops-encrypted secret in-cluster, not via GitHub Actions secrets (which are CI-only).
- **Branch protection carve-out on `main`** — the bot must be able to push commits touching `infra/k8s/overlays/**/kustomization.yaml` (digest fields only) without requiring PR review. Simplest path: GitHub ruleset bypass for the App identity, scoped to that path. Alternative (higher-latency, lower-risk): Image Updater's `write-back-method: git-pull-request` mode + a narrow auto-merge workflow. MVP picks direct-commit; the PR-mode fallback is noted in the runbook if branch protection ends up unworkable.
- **Argo CD v2.13.4 ↔ Image Updater v0.18.x compatibility smoke test** — upstream v0.18.0 was built against Argo CD v3.x but the annotation-based API surface used here is stable back to Argo CD v2.10+. First install: watch controller logs for 5 minutes to confirm it reconciles the existing preview Applications without API errors. If incompatible, pin to v0.15.2 (last known v2.13-compatible release) as the fallback.

## Related

- **Predecessor bandaids** (all manual overlay-digest bumps — the anti-pattern this bug retires):
  - #970 / bug.0343 — poly-doltgres migrator
  - #971 — scheduler-worker multi-queue
  - #972 — operator + resy BUILD_SHA injection
- **Sibling bug not retired by this work:** rollout-status health check (Argo reporting Healthy before old ReplicaSet drains) — tracked as bug.0345 / `proj.cicd-services-gitops.md` row 22.
- **Anti-pattern description:** `docs/spec/ci-cd.md` § Deploy Branch Rules (to be updated by this PR).
- **Upstream project:** https://github.com/argoproj-labs/argocd-image-updater (2K ★, Apache-2.0, active 2026).
