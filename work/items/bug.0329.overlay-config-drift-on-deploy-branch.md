---
id: bug.0329
type: bug
title: Overlay ConfigMap patches drift from main because deploy-branch overlays are never rsync'd
status: needs_implement
priority: 1
rank: 5
estimate: 2
summary: The promote-and-deploy workflow deliberately excludes `infra/k8s/overlays/**` from the base/catalog rsync step ("overlays are NOT synced — they contain env-specific state (IPs) that provision wrote directly to the deploy branch"). Side effect, any non-digest change to an overlay on `main` (e.g. `COGNI_NODE_ENDPOINTS` port correction in `866f6c97d` / `79f888aff`) never propagates to `deploy/preview` / `deploy/candidate-a` / `deploy/production`. Only `promote-k8s-image.sh`'s in-place digest sed runs against the deploy-branch copy. Confirmed in prod on 2026-04-19, preview, scheduler-worker ConfigMap — `poly=http://poly-node-app:3100,resy=http://resy-node-app:3300` on deploy branch even though main has `:3000` for both. Scheduler-worker `createGraphRunActivity` times out with `UND_ERR_CONNECT_TIMEOUT` against poly:3100 (pod `targetPort` 3100 but Service `port` 3000), chat on `poly-preview.cognidao.org` hangs, task.0280 HTTP delegation silently fails post-promote even though the correct manifest is on main. Operator endpoint works by coincidence (`targetPort == port == 3000`).
outcome: Any change to an overlay on main propagates to every `deploy/*` branch on the next promote. EndpointSlice IP patches (the one piece of legitimately env-local overlay state) are preserved. No bespoke YAML-merge logic — use file-level split + `rsync --exclude`.
spec_refs:
  - cd-pipeline
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch: fix/bug.0329-overlay-drift
pr:
reviewer: claude-code
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-19
updated: 2026-04-19
labels: [cicd, deploy-branch, gitops, config-drift, task.0280-follow-up]
external_refs:
  - trigger: task.0280 preview validation, 2026-04-19
  - surfaced-run: https://github.com/Cogni-DAO/node-template/actions/runs/24633902426
  - related-fix: 866f6c97d
---

## Design

### Outcome

Any non-IP change to an overlay file on `main` (ConfigMap data, resource list, image digest baseline, resource refs) automatically reaches `deploy/preview`, `deploy/candidate-a`, and `deploy/production` on the next promote. EndpointSlice IP patches written by the provision script stay pinned to the VM's truth.

### Approach

**Solution**: split the EndpointSlice IP patches into their own file per overlay dir, rsync everything else from `main`, exclude the IP file.

1. **Per overlay dir** (`infra/k8s/overlays/<env>/<app>/`), extract every `EndpointSlice` JSON-patch block out of `kustomization.yaml` into a sibling `endpoints-patch.yaml` that Kustomize references via `patches: - path: endpoints-patch.yaml`.
2. **Workflow** (`.github/workflows/promote-and-deploy.yml`, "Sync base and catalog" step, line 184): add one more rsync line that syncs overlays but excludes `endpoints-patch.yaml`:
   ```
   rsync -a --delete --exclude='endpoints-patch.yaml' \
     app-src/infra/k8s/overlays/ deploy-branch/infra/k8s/overlays/
   ```
3. **Provision script** (`scripts/ci/deploy-infra.sh` + `scripts/setup/provision-test-vm.sh`): writes to `endpoints-patch.yaml` instead of editing inline patches in `kustomization.yaml`. Same kustomize JSON-patch shape, just relocated.
4. **promote-k8s-image.sh**: no change — it already runs _after_ the rsync step, so it mutates the (now main-derived) `kustomization.yaml` in the deploy-branch checkout.

**Reuses**: existing rsync step, existing promote-k8s-image.sh digest sed, existing kustomize `patches: - path:` support. Zero new scripts, zero new jobs.

**Rejected**:

- **YAML-aware merge** (parse + merge `kustomization.yaml` from main and deploy branch): fragile in bash, adds `yq` dependency to CI, duplicates kustomize's own patch layering.
- **Move IPs out of Kustomize entirely** (e.g. a separate `kubectl apply` of EndpointSlice resources from provision): larger blast radius, makes the k8s install no longer fully declarative via Argo.
- **Re-run provision's IP-write step inside the promote workflow**: couples promote to live VM state, requires VM-IP lookup at promote time, more moving parts than a file split.
- **Just rebase deploy branches onto main each promote**: preserves history but breaks the "digest-only, atomic, revertable" promote commits the release-slot controller depends on.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] OVERLAY_NON_IP_PARITY: Any file under `infra/k8s/overlays/**` other than `endpoints-patch.yaml` must be byte-identical between `main` and `deploy/<env>` immediately after a promote (verifiable with `git diff main -- infra/k8s/overlays/ ':!**/endpoints-patch.yaml'`, modulo the single digest line promote-k8s-image.sh writes).
- [ ] ENDPOINTS_LOCAL: `endpoints-patch.yaml` must be the ONLY overlay file that differs per-VM; workflow must skip it via `--exclude`.
- [ ] SIMPLE_SOLUTION: Leverages rsync's `--exclude` and kustomize's native patch-path reference — no bespoke YAML merge.
- [ ] ARCHITECTURE_ALIGNMENT: Preserves GitOps / Argo "manifest is truth" — provisioning still writes a YAML file, just a narrower one.

### Files

<!-- High-level scope -->

- Create: `infra/k8s/overlays/<env>/<app>/endpoints-patch.yaml` — per overlay dir that currently has inline EndpointSlice patches (preview, canary, candidate-a, production × scheduler-worker, and any node/operator overlay that patches EndpointSlices).
- Modify: `infra/k8s/overlays/<env>/<app>/kustomization.yaml` — remove inline EndpointSlice patches, add `patches: - path: endpoints-patch.yaml`.
- Modify: `.github/workflows/promote-and-deploy.yml` — add overlay rsync with `--exclude='endpoints-patch.yaml'` next to the existing base/catalog rsync.
- Modify: `scripts/ci/deploy-infra.sh`, `scripts/setup/provision-test-vm.sh` — write to `endpoints-patch.yaml` instead of `kustomization.yaml`.
- Modify: `docs/spec/ci-cd.md` — document the split + sync semantics.
- Test: dry-run promote on `candidate-a` with a deliberate ConfigMap change on main, assert `deploy/candidate-a` picks it up, assert EndpointSlice IPs unchanged.

## Validation

- After landing, on the next `main → deploy/<env>` promote, `git diff main origin/deploy/<env> -- infra/k8s/overlays/ ':!**/endpoints-patch.yaml'` shows only the single digest line mutation from `promote-k8s-image.sh`, nothing else.
- Deliberate ConfigMap change on main (e.g. bump a `LOG_LEVEL` value in an overlay) reaches `deploy/candidate-a` ConfigMap inside 1 promote cycle.
- `kubectl -n cogni-<env> get endpointslices.discovery.k8s.io -o jsonpath='{.items[*].endpoints[*].addresses}'` unchanged across a promote (IPs pinned).
- Preview scheduler-worker `COGNI_NODE_ENDPOINTS` reads `poly=http://poly-node-app:3000,resy=http://resy-node-app:3000` without a manual poke to `deploy/preview`.

### Immediate preview unblock (separate from this fix)

Out of scope for bug.0329, tracked elsewhere: a one-shot direct commit to `deploy/preview` rewriting `COGNI_NODE_ENDPOINTS` to port 3000 across poly + resy entries, to let task.0280 actually serve chat on preview. Until that lands, this bug's structural fix can't be validated end-to-end on preview (only candidate-a).
