---
id: bug.0344
type: bug
title: Hand-curated overlay digests drift on every unrelated flight — adopt a digest-update controller
status: needs_review
priority: 0
rank: 1
estimate: 5
summary: "Main's `infra/k8s/overlays/*/<service>/kustomization.yaml` digest fields are hand-maintained seeds. Every flight runs `rsync -a --delete` of main's overlay onto the deploy branch, then `promote-k8s-image.sh` bumps digests only for apps in the affected-targets set (`scripts/ci/detect-affected.sh`). Services not touched by the flight's PR inherit main's seed — if the seed is stale, the deploy branch silently reverts to a pre-feature image on every unrelated flight. Produced #970 (poly-doltgres migrator with missing script → ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND), #971 (scheduler-worker pre-multi-queue → 30–40s silent chat hang on preview + candidate-a), #972 (operator + resy pre-BUILD_SHA → /readyz.version=0 → verify-buildsha fails every flight). Manual per-service bumps are sunk cost on a dying pattern and don't scale past v0."
outcome: "Git is eventually-consistent with GHCR. Argo CD Image Updater (pinned v0.15.2 — last version tested against Argo CD v2.13.x) watches the `deploy/preview` Applications for new `preview-*` image tags and commits fresh digests back to `main`'s `preview/` overlays under the existing `Cogni-1729` PAT identity used by every other automated commit in this repo. Scope is deliberately narrow for MVP; candidate-a and production overlays on main plus migrator images are follow-up work (see _MVP scope boundaries_ below). `scripts/ci/promote-k8s-image.sh` stays in place as the deploy-branch digest pinner — only the bit that previously required humans to copy digests back to main is automated here. Zero new bespoke GitHub Actions workflows, zero new GitHub App registrations, zero new branch-protection carve-outs."
spec_refs:
  - ci-cd
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch: design/bug-0344-digest-updater
pr:
deploy_verified: false
reviewer:
revision: 2
blocked_by:
created: 2026-04-20
updated: 2026-04-20
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

**Solution**: Install **Argo CD Image Updater v0.15.2** (argoproj-labs, Apache-2.0) into the existing `argocd` namespace. Annotate each preview Application (generated from `preview-applicationset.yaml`) with an image-list + `write-back-method: git` + `git-branch: main`. The controller polls GHCR, finds new `preview-{sha}` digests, and commits digest updates back to `main`'s overlay kustomization files, authenticated as the existing **`Cogni-1729`** bot account via the already-provisioned `ACTIONS_AUTOMATION_BOT_PAT`. Provenance is established via stable commit-message prefix (`chore(deps): argocd-image-updater ...`) — the same mechanism `promote-k8s-image.sh`, `flight-preview.yml`, and `promote-to-production.yml` commits already rely on.

**Reuses**:

- **Argo CD Image Updater v0.15.2** — last upstream release explicitly tested against Argo CD v2.13.4 (`chore(deps): bump argo-cd from 2.13.2 to 2.13.4`, release 0.15.1 PR#925). We stay on this pin until the Argo CD server itself is upgraded to v2.14+ / v3.x, at which point an Image Updater upgrade can be earned (tracked as a follow-up, not a prerequisite).
- **`ACTIONS_AUTOMATION_BOT_PAT` + `Cogni-1729` identity** — already authoring every automated commit on `main` and `deploy/*` today (`release.yml`, `promote-to-production.yml`, `promote-and-deploy.yml`, `flight-preview.yml`). Image Updater's git write-back is the same trust envelope as those workflows. No new GitHub App, no new branch-protection carve-out.
- **Existing `preview-applicationset.yaml`** — annotated in place; no new AppSet.
- **Existing `infra/k8s/argocd/kustomization.yaml`** — the Image Updater install manifest slots in alongside `install.yaml` and `ksops-cmp.yaml`.
- **Existing per-service `kustomization.yaml` `images:` blocks** — controller writes the `digest:` field using the same syntax `promote-k8s-image.sh` already edits; no schema change.
- **Existing ksops CMP (`ksops-cmp.yaml`)** — the git-credentials secret and GHCR registry secret are delivered through the established SOPS/age encrypted-at-rest pattern. Same secret-management story as every other in-cluster secret today.

### Why watch `deploy/preview`, not `deploy/candidate-a`

`candidate-a` flies arbitrary PR builds (including unmerged / failed ones) via `candidate-flight.yml` — bumping `main`'s seed off a candidate-a build would propagate unaccepted code to every other service's seed. `deploy/preview` only receives digests from `flight-preview.yml`, which re-tags `pr-{N}-{sha} → preview-{mainSHA}` exclusively on merge. Every `preview-*` tag therefore represents accepted code — the correct signal to promote into `main`'s seed.

### Why write to `main`, not to the Application's source branch

Image Updater's default is to write to the Application's source branch (`deploy/preview` in our case). That's wrong for us — `deploy/preview` is machine-managed state that gets rsynced from `main` on every promotion. Writing there creates a fight with `promote-k8s-image.sh` and would be clobbered on the next flight. The `argocd-image-updater.argoproj.io/git-branch: main` annotation (per-Application) redirects the write-back to `main`, where the seed actually lives. `promote-k8s-image.sh` stays the authoritative pinner for flight-specific digests on `deploy/*`; Image Updater stays the authoritative seed-keeper on `main`. No fight.

### Why it doesn't fight with the flight workflow

| Writer                              | Target                                     | Trigger                            | Owns                                            |
| ----------------------------------- | ------------------------------------------ | ---------------------------------- | ----------------------------------------------- |
| `promote-k8s-image.sh` (candidate)  | `deploy/candidate-a` overlay               | PR flight                          | Pins the chosen PR's digest on the flight slot  |
| `promote-k8s-image.sh` (preview)    | `deploy/preview` overlay                   | merge-to-main flight               | Pins merged code's digest on the preview slot   |
| `promote-k8s-image.sh` (production) | `deploy/production` overlay                | manual `promote-to-production.yml` | Pins preview's validated digest on production   |
| **Argo CD Image Updater (new)**     | **`main` overlay (preview env only, MVP)** | continuous poll of GHCR            | Keeps `main`'s preview seed fresh for every app |

Rsync (`INFRA_K8S_MAIN_DERIVED`, Axiom 17) still wins on deploy branches: `main → deploy/<env>` then `promote-k8s-image.sh` overrides affected apps. The controller's commits to `main` arrive asynchronously — if a flight rsyncs before Image Updater catches up, the next flight will catch it. That's the "eventually-consistent" in the outcome statement.

### Rejected alternatives

- **Flux `ImageUpdateAutomation`** — strong policy language, actively maintained. Rejected: running the full Flux controller stack alongside Argo CD doubles the CRD surface and operational burden for a single capability we can get from an Argo-native sibling project.
- **Renovate (digest-pinning mode)** — battle-tested, already common in npm workflows. Rejected: opens a PR per digest bump. With 7 targets (`operator`, `operator-migrator`, `poly`, `poly-migrator`, `resy`, `resy-migrator`, `scheduler-worker`) and one merge producing 7 PRs, the review noise exceeds the drift savings. Image Updater's direct-commit mode is strictly simpler for this workload.
- **Custom GitHub Actions workflow that commits digests to `main`** — explicitly forbidden by invariant `NO_BESPOKE_DIGEST_WORKFLOW`. This is the shape of the bug, not the fix.
- **Extend `promote-k8s-image.sh` to also commit to `main`** — same failure mode: a one-shot script owned by nobody, still driven by the flight workflow's affected-only logic (the exact source of drift).

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] **NO_BESPOKE_DIGEST_WORKFLOW** — solution is adoption of the existing Image Updater project, not a new `.github/workflows/*.yml` that commits digests. Fail if the PR adds a workflow whose purpose is "commit digest updates to main".
- [ ] **DIGEST_IMMUTABILITY_PRESERVED** — Image Updater is configured with `update-strategy: latest` (v0.15.2 semantics: pick newest tag by image-manifest creation timestamp), paired with a tight `allow-tags` regex that only admits the post-merge SHA-bearing tag class. Tag-class immutability comes from the regex, not the strategy name: every tag admitted by `^preview-[0-9a-f]{40}(-<suffix>)?$` is content-addressed by the merge SHA, so `IMAGE_IMMUTABILITY` axiom (`docs/spec/ci-cd.md`) is untouched. The `digest` strategy is the wrong primitive here (it tracks a single mutable tag). Verify: `allow-tags` admits only preview-SHA-tag-class, never `latest` / `stable` / floating tags.
- [ ] **COMMIT_PROVENANCE_VIA_MESSAGE_PREFIX** — every digest-update commit on `main` uses commit-message prefix `chore(deps): argocd-image-updater` (configured via Image Updater's `git.commit-message-template` ConfigMap key) so `git log --grep='argocd-image-updater' -- infra/k8s/overlays/` is the controller-specific audit filter. Authentication flows through `ACTIONS_AUTOMATION_BOT_PAT` (pusher = `Cogni-1729`), but **authorship** (`git.user` / `git.email`) is `github-actions[bot] <github-actions[bot]@users.noreply.github.com>` — the canonical CI-bot identity used by every other automated commit in this repo: `scripts/ci/promote-k8s-image.sh:114-115` (the very script whose logic this automates), `promote-and-deploy.yml:273-274`, `candidate-flight.yml:130-131,365-366`. This keeps the cross-automation audit filter `git log --author='github-actions\[bot\]' -- infra/k8s/overlays/` usable alongside the grep-prefix filter. Verify: `config-patch.yaml` sets `git.user: github-actions[bot]`, not `Cogni-1729`.
- [ ] **MAIN_WRITE_IS_NARROW_CARVE_OUT** — auto-writing to `main` is a deliberate exception to the "main = human-reviewed code truth" contract in `docs/spec/cd-pipeline-e2e.md:332`. Feasibility relies on Cogni-1729's admin role + `enforce_admins: false` on `main`'s branch protection (verified via `gh api repos/:owner/:repo/branches/main/protection`). The carve-out is scoped by **construction**, not by convention: ACIU can only mutate `images:` blocks for entries matching its configured `kustomize.image-name`, inside the Kustomize directory named by each Application's `source.path` (`infra/k8s/overlays/preview/{{name}}/`). No other path on `main` is reachable. Any future widening of this surface needs an explicit invariant change here.
- [ ] **WRITE_BACK_SCOPE_IS_MAIN_PREVIEW** — ACIU writes to `main` only, and only to `infra/k8s/overlays/preview/<app>/kustomization.yaml`. Deploy branch digest promotion (`promote-k8s-image.sh` during candidate/preview/production flights) stays as-is. Verify: no `argocd-image-updater.argoproj.io/git-branch` annotation points at a `deploy/*` branch, and no annotations are added to `candidate-a-applicationset.yaml` or `production-applicationset.yaml`.
- [ ] **PRODUCTION_NOT_AUTO_UPDATED** — production flights require explicit human dispatch via `promote-to-production.yml`. The controller watches only `preview-applicationset.yaml`'s Applications; annotations on `production-applicationset.yaml` are **not** added. Verify: `infra/k8s/argocd/production-applicationset.yaml` has zero `argocd-image-updater.argoproj.io/*` annotations.
- [ ] **APP_AND_MIGRATOR_BOTH_UPDATED** — every node-type catalog entry (operator, poly, resy) has a two-image kustomize overlay (`cogni-template` + `cogni-template-migrate`); both seeds must stay fresh on `main` or bug #970-class failures return the next time an **unrelated** flight rsyncs `main → deploy/preview`. The AppSet template therefore declares two ACIU image aliases: `app=ghcr.io/cogni-dao/cogni-template` with `allow-tags` keyed to `image_tag_suffix`, and `migrator=ghcr.io/cogni-dao/cogni-template` with `allow-tags` keyed to `migrator_tag_suffix` and `kustomize.image-name: ghcr.io/cogni-dao/cogni-template-migrate`. Scheduler-worker has only an app alias in effect — its `migrator_tag_suffix` regex matches zero GHCR tags, so ACIU no-ops the migrator for it.
- [ ] **NO_NEW_GITHUB_APP** — reuses the existing `Cogni-1729` PAT (`ACTIONS_AUTOMATION_BOT_PAT`). No GitHub App registration, no new trust envelope. Verify: PR adds zero references to new App IDs / private keys / installation IDs.
- [ ] **SIMPLE_SOLUTION** — leverages the upstream install manifest as a remote Kustomize resource (same pattern as `install.yaml: https://raw.githubusercontent.com/argoproj/argo-cd/v2.13.4/manifests/install.yaml`). No forking, no vendoring, no Helm.
- [ ] **ARCHITECTURE_ALIGNMENT** — installs into the existing `argocd` namespace via the existing `infra/k8s/argocd/kustomization.yaml`. Credentials delivered via the same imperative `kubectl create secret generic --dry-run=client -o yaml | kubectl apply -f -` pattern used by `scripts/ci/deploy-infra.sh:966` (ksops is retired — see `infra/provision/cherry/base/bootstrap.yaml`, task.0284). No new namespace, no new secret-management pattern.

### Wiring (concrete)

```text
pr-build.yml (per PR)
  └─ builds pr-{N}-{sha} in GHCR

flight-preview.yml (on merge to main)
  ├─ re-tags pr-{N}-{sha} → preview-{mainSHA} in GHCR   ← ✅ stable tag published
  └─ writes deploy/preview overlay digest via promote-k8s-image.sh

Argo CD Image Updater (continuous, every 2m default poll)
  ├─ watches: Applications generated from preview-applicationset.yaml
  │           (candidate-a and production intentionally excluded — their
  │            AppSets have no ACIU annotations)
  ├─ registry: ghcr.io/cogni-dao/cogni-template
  │   ├─ app alias       allow-tags: ^preview-[0-9a-f]{40}{{image_tag_suffix}}$
  │   │                  update-strategy: latest, kustomize.image-name (default):
  │   │                  ghcr.io/cogni-dao/cogni-template
  │   └─ migrator alias  allow-tags: ^preview-[0-9a-f]{40}{{migrator_tag_suffix}}$
  │                      update-strategy: latest, kustomize.image-name:
  │                      ghcr.io/cogni-dao/cogni-template-migrate
  └─ on new digest:
        write-back-method: git (HTTPS + argocd-image-updater-git-creds Secret
                                → Cogni-1729 PAT does the auth/push; admin-
                                with-enforce-off lets the push land on main)
        git-branch: main                                  ← ✅ writes to main, not deploy/preview
        write-back-target: kustomization    (Application source.path: infra/k8s/overlays/preview/{{name}})
        commit author: github-actions[bot]                ← ✅ matches promote-k8s-image.sh:114-115
        commit message prefix: chore(deps): argocd-image-updater ...  ← ✅ provenance via grep
        → updates BOTH digest fields in main's preview/{{name}}/kustomization.yaml:
              - the cogni-template entry (app)
              - the cogni-template-migrate entry (per-node migrator; skipped for scheduler-worker)

next preview flight
  └─ rsync main → deploy/preview  (Axiom 17)             ← ✅ main's preview overlay is fresh
     └─ promote-k8s-image.sh bumps affected apps only    ← ✅ non-affected apps (incl. their
                                                            migrator entries) now have CURRENT seed
                                                            → kills the #970 recurrence path
```

### Files

**Create:**

- `infra/k8s/argocd/image-updater/kustomization.yaml` — references upstream install manifest pinned at `https://raw.githubusercontent.com/argoproj-labs/argocd-image-updater/v0.15.2/manifests/install.yaml` plus local patches.
- `infra/k8s/argocd/image-updater/config-patch.yaml` — patches the `argocd-image-updater-config` ConfigMap: sets the `registries:` entry for `ghcr.io` (credentials reference the `argocd-image-updater-ghcr` Secret in the `argocd` namespace), sets `git.user: github-actions[bot]` / `git.email: github-actions[bot]@users.noreply.github.com` to match the CI-bot authorship used by `scripts/ci/promote-k8s-image.sh` and every other automated commit in this repo, and sets `git.commit-message-template` to prefix commits with `chore(deps): argocd-image-updater`.
- `docs/runbooks/image-updater-bootstrap.md` — one-page runbook: imperatively creating the two Kubernetes Secrets (`kubectl create secret generic --from-literal=... --dry-run=client -o yaml | kubectl apply -f -`, matching the pattern in `scripts/ci/deploy-infra.sh`), validating the first auto-commit on `main`, rolling back (removing AppSet annotations + scaling controller to 0) if the controller misbehaves, PAT rotation procedure (re-apply the Secret + `kubectl rollout restart deployment/argocd-image-updater -n argocd`). Note: ksops was retired from this repo's Argo CD bootstrap (`infra/provision/cherry/base/bootstrap.yaml`, task.0284 ESO migration) — secrets are **not** committed to git.

**Modify:**

- `infra/k8s/argocd/kustomization.yaml` — add `image-updater/` to `resources:` so the controller is installed alongside the existing `install.yaml`.
- `infra/k8s/argocd/preview-applicationset.yaml` — add the `argocd-image-updater.argoproj.io/*` annotations on the `template.metadata.annotations` block, parameterized via the catalog generator. Two image aliases: `app=ghcr.io/cogni-dao/cogni-template` (`app.allow-tags: regexp:^preview-[0-9a-f]{40}{{image_tag_suffix}}$`, `app.update-strategy: latest`) and `migrator=ghcr.io/cogni-dao/cogni-template` (`migrator.allow-tags: regexp:^preview-[0-9a-f]{40}{{migrator_tag_suffix}}$`, `migrator.update-strategy: latest`, `migrator.kustomize.image-name: ghcr.io/cogni-dao/cogni-template-migrate`). Plus `write-back-method: git:secret:argocd/argocd-image-updater-git-creds`, `git-branch: main`, `write-back-target: kustomization`. GHCR credentials resolve at the registry level (via `registries.conf`) — no per-Application `pull-secret` annotation needed.
- `infra/catalog/{operator,poly,resy,scheduler-worker}.yaml` — add `image_tag_suffix` + `migrator_tag_suffix` fields. `image_tag_suffix`: `""` / `"-poly"` / `"-resy"` / `"-scheduler-worker"`. `migrator_tag_suffix`: `"-operator-migrate"` / `"-poly-migrate"` / `"-resy-migrate"` / `"-scheduler-worker-migrate"` (the last is a no-op — scheduler-worker has no migrator; ACIU's regex matches zero tags for it). Both fields mirror `scripts/ci/lib/image-tags.sh:tag_suffix_for_target` and exist because ApplicationSet Git-file generators interpolate catalog fields into the template.
- `docs/spec/ci-cd.md` § Deploy Branch Rules — replace the current "⚠️ Known anti-pattern: main's overlay digests are hand-curated seeds." callout with a description of the controller's role (seed-keeper on `main`'s preview overlay) and a pointer to this bug's PR, the bootstrap runbook, and the remaining follow-up surfaces (candidate-a / production overlays + migrators).
- `work/projects/proj.cicd-services-gitops.md` row 21 (Active Blockers) — leave open after this PR lands; only flip once the MVP is extended to cover candidate-a/production overlays and migrators (tracked as separate follow-ups).

**MVP scope boundaries (what this PR intentionally does NOT cover):**

- **Candidate-a & production overlays on `main`** stay manually maintained. Rationale: Image Updater's `write-back-target: kustomization` writes to the Application's single `source.path`. The preview AppSet's source.path is `infra/k8s/overlays/preview/{{name}}` — so only that path is updated. Fan-out to sibling envs needs either (a) annotating the candidate-a AppSet the same way (legal — its Applications also live on `deploy/candidate-a`, so writes redirect to `main` via `git-branch: main`) or (b) a small post-commit script that mirrors the digest across env overlays. Pick one in a follow-up once this MVP is proven in steady state.

**In-MVP coverage (revised after rev 2 review):**

- **All four preview catalog entries** — operator, poly, resy, scheduler-worker — get ACIU annotations.
- **Per-node migrator images** (`-operator-migrate`, `-poly-migrate`, `-resy-migrate`) are handled by the second image alias. This is what makes the poly case actually solvable in MVP: every poly flight bumps `-poly` and `-poly-migrate` together via `promote-k8s-image.sh --migrator-digest`, and bug #970 is specifically the scenario where the migrator seed rots on main and rsync overwrites the fresh migrator digest on `deploy/preview` during an unrelated flight. Deferring the migrator alias would have left the most frequent flight path unprotected.
- **Scheduler-worker** has no per-node migrator (it uses the shared operator migrator in-cluster; its kustomize overlay has one images entry, not two). Its `migrator_tag_suffix` regex never matches — ACIU silently skips the migrator alias for it. Clean no-op, no error.

**Test / Validation:**

- `docs/runbooks/image-updater-bootstrap.md` includes the explicit test: push a trivial change to `nodes/poly/app/...`, merge, observe `flight-preview.yml` re-tag to `preview-<merge-sha>-poly` (and `-poly-migrate` if poly's Dockerfile chain produced it) in GHCR, observe within 5 minutes a `github-actions[bot]`-authored commit on `main` updating `infra/k8s/overlays/preview/poly/kustomization.yaml` — both the `cogni-template` and `cogni-template-migrate` image digests — to the new `sha256:...` values.

## Validation

**exercise:** (poly is the most frequent flight path and the most important app for this MVP)

1. On `main`, capture current digests for poly in `infra/k8s/overlays/preview/poly/kustomization.yaml`: `D_app0` (the `cogni-template` entry) and `D_mig0` (the `cogni-template-migrate` entry).
2. Merge a no-op change that touches `nodes/poly/**` (triggers `pr-build` → `flight-preview` → new `preview-{mergeSHA}-poly` + `preview-{mergeSHA}-poly-migrate` tags in GHCR). Capture new digests: `D_app1`, `D_mig1`.
3. Wait ≤ 5 minutes (one ACIU poll cycle + commit latency).
4. Expect **one or two** new commits on `main` authored by `github-actions[bot]` with message prefix `chore(deps): argocd-image-updater`, touching `infra/k8s/overlays/preview/poly/kustomization.yaml` and setting BOTH `cogni-template` digest → `D_app1` and `cogni-template-migrate` digest → `D_mig1`. (ACIU may batch both image updates in a single commit or emit two sequential commits — both are valid; same provenance prefix either way.)
5. Trigger a `flight-preview` run for an **unrelated** PR (e.g. one touching only `nodes/operator/**`). After the flight rsyncs `main → deploy/preview`, inspect `deploy/preview:infra/k8s/overlays/preview/poly/kustomization.yaml`: **both** poly digests must equal `D_app1` / `D_mig1` (fresh seeds inherited from main), not `D_app0` / `D_mig0` (the stale pre-Image-Updater values). If only the app digest is fresh and the migrator is stale, bug #970's mechanism is still live → blocker.

**observability:**

- `{namespace="argocd",pod=~"argocd-image-updater-.*"}` in Loki shows `level=info msg="Successfully updated image"` lines for both `app` and `migrator` aliases on the `preview-poly` Application at the deployed SHA of the controller.
- `git log --grep='chore(deps): argocd-image-updater' --author='github-actions\[bot\]' --since="1 hour ago" -- infra/k8s/overlays/preview/poly/` returns at least one commit covering both digest bumps.
- `argocd app get preview-poly -o json | jq '.status.summary.images'` at rest matches the latest `main` preview seed for poly (both app and migrator).

## Blocked by / prerequisites

- **Cluster-side Secret authoring access** — the bootstrap operator needs to run two `kubectl create secret generic ... | kubectl apply -f -` commands in the `argocd` namespace (see `docs/runbooks/image-updater-bootstrap.md` §1). Same access surface as `scripts/ci/deploy-infra.sh` already exercises; no new permission tier.
- **GHCR scan via `GHCR_DEPLOY_TOKEN`** — the existing org-level PAT already has `read:packages` scope and is what every deploy pipeline uses to pull images. Reused verbatim for Image Updater's registry metadata scanning; no new credential.
- **`main` branch protection must permit admin direct push** — verified pre-design via `gh api repos/:owner/:repo/branches/main/protection`: `required_pull_request_reviews.required_approving_review_count: 1` + `enforce_admins: false`; Cogni-1729 is `role_name: admin`. Admin-with-enforce-off = PAT direct push to main works. If this changes (e.g. `enforce_admins: true` is ever flipped), ACIU will start failing its write-back silently — the `MAIN_WRITE_IS_NARROW_CARVE_OUT` invariant makes this an explicit dependency, not a hidden assumption.

_Intentionally not prerequisites_ (reconciled during `/review-design` and `/review-implementation`):

- ~~New GitHub App registration~~ — reuses `ACTIONS_AUTOMATION_BOT_PAT` + `Cogni-1729`, the existing PAT-based automation identity. See `proj.vcs-integration.md` L70 — that "separate apps per blast radius" constraint governs GitHub **Apps**; PAT reuse is consistent with every other automated commit path in this repo.
- ~~New branch-protection carve-out on `main`~~ — the required bypass (admin-with-`enforce_admins: false`) **already exists** on main's current branch protection. The design relies on that pre-existing posture; it does not add a new rule, exemption, or ruleset.
- ~~Argo CD v2.14+ compatibility smoke test~~ — we pin v0.15.2, which was tested against Argo CD v2.13.4 upstream. Upgrading Image Updater to v0.18.x or v1.x is a follow-up tied to the Argo CD server upgrade, not a precondition for this MVP.

## Implementation review (revision 1)

Self-review against upstream v0.15.2 docs and the live bootstrap script surfaced four blockers plus one non-blocking cleanup. Each item has a specific fix and is cross-referenced to a source of truth — an upstream doc URL or a live file path in this repo. All must be green before `/closeout`.

- [x] **B1 — `.enc.yaml` ksops workflow is dead.** `infra/provision/cherry/base/bootstrap.yaml:176-179` explicitly retired ksops (`# ksops CMP plugin + repo-server sidecar patch removed. SOPS/ksops will be replaced by ESO (task.0284)`). Applying `infra/k8s/argocd/image-updater/kustomization.yaml` as shipped would submit SOPS ciphertext as raw Secret contents. Fix: drop `ghcr-secret.enc.yaml` + `git-creds-secret.enc.yaml` resources + the two `.enc.yaml.example` files; rewrite `docs/runbooks/image-updater-bootstrap.md` §1 and the PAT-rotation section to use imperative `kubectl create secret generic --from-literal=... --dry-run=client -o yaml | kubectl apply -f -`, matching the live pattern at `scripts/ci/deploy-infra.sh:966`.
- [x] **B2 — `update-strategy: newest-build` is not a v0.15.2 strategy.** [v0.15.2 docs](https://raw.githubusercontent.com/argoproj-labs/argocd-image-updater/v0.15.2/docs/configuration/images.md#update-strategies) list only `semver | latest | name | digest`. Invalid values silently fall back to the `semver` default, which matches zero of our `preview-<40hex>{-suffix}` tags. Fix: change the annotation value in `infra/k8s/argocd/preview-applicationset.yaml` to `latest`; update the `DIGEST_IMMUTABILITY_PRESERVED` invariant narrative above to say `latest` and note that tag-class immutability comes from the `allow-tags` regex, not the strategy name.
- [x] **B3 — `app.pull-secret: pullsecret:...` is the wrong Secret type.** Per the same v0.15.2 doc (§Specifying pull secrets), `pullsecret:<ns>/<name>` requires a `kubernetes.io/dockerconfigjson` Secret with a `.dockerconfigjson` key. The authored Secret is `type: Opaque` with a `token` key. The annotation is also redundant — `config-patch.yaml`'s `registries.conf` entry (`credentials: secret:argocd/argocd-image-updater-ghcr#token`) already handles GHCR auth at the registry level. Fix: delete the `app.pull-secret` annotation line from `preview-applicationset.yaml`.
- [x] **B4 — commit author will be `argocd-image-updater <noreply@argoproj.io>`, not `Cogni-1729`.** Per [v0.15.2 update-methods docs](https://raw.githubusercontent.com/argoproj-labs/argocd-image-updater/v0.15.2/docs/basics/update-methods.md#specifying-the-user-and-email-address-for-commits), the HTTPS creds secret only controls _authentication_; _authorship_ comes from `git.user` + `git.email` in the `argocd-image-updater-config` ConfigMap (or CLI flags). The `COMMIT_PROVENANCE_VIA_MESSAGE_PREFIX` invariant above explicitly claims "The commit author is `Cogni-1729`" — that claim currently fails. Fix: add `git.user: Cogni-1729` and `git.email: <Cogni-1729 GitHub noreply>` to `infra/k8s/argocd/image-updater/config-patch.yaml`.
- [x] **C1 (non-blocking) — drop undefined template vars.** `git.commit-message-template` in `config-patch.yaml` references `{{ .NewDigest }}` and `{{ .OldDigest }}`; v0.15.2's template schema only exposes `.AppName` + `.AppChanges[].Image` / `.OldTag` / `.NewTag`. `text/template` renders missing fields as `<no value>`. Fix: remove the `@{{ .NewDigest }}` and `@{{ .OldDigest }}` fragments.

Drive-by notes (not this PR):

- `infra/k8s/argocd/kustomization.yaml:4` header comment + `ksops-cmp.yaml` resource + `repo-server-patch.yaml` sidecar patch are all ksops-era dead code. Track under task.0284 (ESO migration).
- `image_tag_suffix` + `migrator_tag_suffix` in `infra/catalog/*.yaml` duplicate `scripts/ci/lib/image-tags.sh:tag_suffix_for_target`. Either side could become the generator for the other. Follow-up after this MVP proves out.

## Implementation review (revision 2)

Rev-1 passed my own gate but an external reviewer pressure-tested three load-bearing assumptions. All three needed real fixes — one was a design error that would have left the most important app (poly) **incompletely covered**.

- [x] **B5 — Wrong commit author.** Rev-1 set `git.user: Cogni-1729` / `git.email: Cogni-1729@users.noreply.github.com`. This is a value I invented, not a value I observed. The canonical CI-bot authorship in this repo is `github-actions[bot] <github-actions[bot]@users.noreply.github.com>`, used by **the very script whose job we're automating** — `scripts/ci/promote-k8s-image.sh:114-115` — and by `promote-and-deploy.yml:273-274`, `candidate-flight.yml:130-131,365-366`. Authentication is still Cogni-1729 via the PAT (that's what lets the push land on main); authorship is the bot identity. Fix: `config-patch.yaml` now sets `git.user: github-actions[bot]`. Updated `COMMIT_PROVENANCE_VIA_MESSAGE_PREFIX` invariant + Wiring diagram accordingly.
- [x] **B6 — `main` write feasibility was asserted, not verified.** Rev-1's "~~Branch-protection carve-out on `main`~~" struck-through line claimed the PAT "already has push access to main" by analogy to `release.yml` / `promote-and-deploy.yml` — but those workflows push to `deploy/*` branches (`release.yml` pushes release branches, `promote-and-deploy.yml` pushes `deploy/preview`/`deploy/production`, `candidate-flight.yml` pushes `deploy/candidate-a`). **None of them direct-push to main.** PR merges route through the API (`gh pr merge`), not raw `git push origin main`. I verified the actual posture: `gh api repos/:owner/:repo/branches/main/protection` returns `required_pull_request_reviews.required_approving_review_count: 1` with `enforce_admins: false`; `Cogni-1729` is `role_name: admin`. So the PAT **can** direct-push to main today — but only because admin+enforce-off bypass exists. Fix: added `MAIN_WRITE_IS_NARROW_CARVE_OUT` invariant + explicit `main branch protection` prerequisite so this posture is a documented dependency of the design, not a latent assumption. Also tightened the "not a prerequisite" bullet to say the carve-out **already exists**, not that none is needed.
- [x] **B7 — Poly migrator deferral rendered MVP ineffective for the most important app.** Rev-1 explicitly deferred migrator digest updates ("Per-node migrator images stay maintained by `promote-k8s-image.sh --migrator-digest` on deploy branches"). Walk the failure path: (1) poly PR merges → flight bumps `-poly` + `-poly-migrate` on `deploy/preview`; (2) unrelated operator PR merges → flight runs `rsync -a --delete main → deploy/preview`; this **wipes the fresh poly-migrate digest on `deploy/preview` with main's stale seed**; (3) `promote-k8s-image.sh` then bumps only operator. Result: fresh operator + fresh poly-app + **stale poly-migrate** on `deploy/preview` → bug #970 returns. Deferring the migrator meant the MVP did not actually solve the case the ticket was opened for. Fix: added a second image alias `migrator=ghcr.io/cogni-dao/cogni-template` with `migrator.allow-tags` keyed to a new `migrator_tag_suffix` catalog field and `migrator.kustomize.image-name: ghcr.io/cogni-dao/cogni-template-migrate` so the controller writes to the second `images:` entry. Added 4-case `migrator_tag_suffix` to catalog files (`-operator-migrate`, `-poly-migrate`, `-resy-migrate`, `-scheduler-worker-migrate`). Scheduler-worker's migrator regex matches zero tags → no-op. Added `APP_AND_MIGRATOR_BOTH_UPDATED` invariant. Rewrote validation block to exercise poly (not resy) and require both digests to refresh.

## Related

- **Predecessor bandaids** (all manual overlay-digest bumps — the anti-pattern this bug retires):
  - #970 / bug.0343 — poly-doltgres migrator
  - #971 — scheduler-worker multi-queue
  - #972 — operator + resy BUILD_SHA injection
- **Sibling bug not retired by this work:** rollout-status health check (Argo reporting Healthy before old ReplicaSet drains) — tracked as bug.0345 / `proj.cicd-services-gitops.md` row 22.
- **Anti-pattern description:** `docs/spec/ci-cd.md` § Deploy Branch Rules (to be updated by this PR).
- **Upstream project:** https://github.com/argoproj-labs/argocd-image-updater (2K ★, Apache-2.0, active 2026).
