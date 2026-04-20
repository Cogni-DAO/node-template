---
id: bug.0334
type: bug
title: Overlay EndpointSlice IPs via env-state.yaml + workflow rsync — establish INFRA_K8S_MAIN_DERIVED
status: needs_merge
priority: 0
rank: 1
estimate: 3
summary: "After bug.0333's base audit, overlay `kustomization.yaml` files on `deploy/<env>` still hold EndpointSlice IP patches (`/endpoints/0/addresses`) that drift from main because the promote workflow excludes `infra/k8s/overlays/**` from its rsync. Any non-digest overlay change on main (ConfigMap patches for genuinely env-varying values like `TEMPORAL_NAMESPACE`, per-node DNS URLs, `NEXTAUTH_URL`, Service nodePort, Deployment secret refs) can still silently fail to propagate. Triggered by the 2026-04-19 preview outage (task.0280 HTTP delegation blocked by stale `COGNI_NODE_ENDPOINTS` — main had `:3000`, `deploy/preview` had `:3100`)."
outcome: "`INFRA_K8S_MAIN_DERIVED` holds after every promote. For every file under `infra/k8s/` on `deploy/<env>`, the file is byte-identical to `main` at the promoted SHA, OR the file is `env-state.yaml` (the per-overlay VM-truth file). Provision writes only `env-state.yaml` files. Kustomize `replacements` wires VM IPs into EndpointSlices. Workflow rsync covers the entire `infra/k8s/` tree with `--exclude='env-state.yaml'`. Non-digest overlay drift is structurally impossible."
spec_refs:
  - cd-pipeline
  - ci-cd
assignees: claude-code
credit:
project: proj.cicd-services-gitops
branch: fix/bug.0334-overlay-rsync
pr: https://github.com/Cogni-DAO/node-template/pull/943
reviewer: derekg1729
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-19
updated: 2026-04-20
labels:
  [cicd, deploy-branch, gitops, config-drift, bug.0333-follow-up, critical]
external_refs:
  - predecessor: bug.0333
  - trigger-incident: task.0280 preview validation, 2026-04-19
  - pr-predecessor: https://github.com/Cogni-DAO/node-template/pull/939
---

## Design

### Outcome

`INFRA_K8S_MAIN_DERIVED` invariant: every file under `infra/k8s/` on a deploy branch is either byte-identical to `main` at the promoted SHA, or is an `env-state.yaml` file. `promote-k8s-image.sh`'s digest-line edit is the only exception per overlay `kustomization.yaml`.

### Approach

**Per-overlay-dir `env-state.yaml`** (NOT one-per-env). 16 overlay dirs → 16 `env-state.yaml` files. Each overlay's file holds the VM IP used by that overlay's EndpointSlices. This design handles production's two-IP topology (`127.0.0.1` for scheduler-worker via host-loopback, `10.0.0.1` for node-apps via pod network) naturally: each overlay carries the IP its EndpointSlices need. No unification required.

1. **`infra/k8s/overlays/<env>/<app>/env-state.yaml`** × 16 — minimal schema:

   ```yaml
   apiVersion: v1
   kind: ConfigMap
   metadata:
     name: env-state
     annotations:
       config.kubernetes.io/local-config: "true"
   data:
     VM_IP: "84.32.109.222"
   ```

   `config.kubernetes.io/local-config: "true"` keeps the ConfigMap out of the rendered output; it exists only for kustomize `replacements` to read.

2. **Each overlay `kustomization.yaml`**:

   ```yaml
   resources:
     - ../../../base/<app>
     - env-state.yaml

   replacements:
     - source:
         kind: ConfigMap
         name: env-state
         fieldPath: data.VM_IP
       targets:
         - select: { kind: EndpointSlice, name: temporal-1 }
           fieldPaths: [endpoints.0.addresses.0]
         - select: { kind: EndpointSlice, name: postgres-1 }
           fieldPaths: [endpoints.0.addresses.0]
         # ... one target per EndpointSlice the overlay patches
   ```

   Delete inline `- op: replace path: /endpoints/0/addresses value: [...]` patches. Keep `/metadata/labels/kubernetes.io~1service-name` patches (they're static namePrefix fixes, carried by rsync).

3. **Workflow** (`.github/workflows/promote-and-deploy.yml`):

   Replace the current base+catalog rsyncs with one full-tree rsync excluding `env-state.yaml`:

   ```bash
   rsync -a --delete --exclude='env-state.yaml' \
     app-src/infra/k8s/ deploy-branch/infra/k8s/
   rsync -a --delete app-src/infra/catalog/ deploy-branch/infra/catalog/
   ```

   Update the comment block to document the new contract (`INFRA_K8S_MAIN_DERIVED`).

4. **Provision scripts** (`scripts/ci/deploy-infra.sh`, `scripts/setup/provision-test-vm.sh`):

   Replace inline `sed`/`awk` edits of `kustomization.yaml` EndpointSlice addresses with idempotent writes to the per-overlay `env-state.yaml` files. Script receives `VM_IP` (or derives it) and writes up to 4 files per env: `overlays/<env>/{scheduler-worker,operator,poly,resy}/env-state.yaml`. Production's two-IP case is handled by scheduler-worker's env-state using `127.0.0.1` (or whatever production resolves to for host-loopback reach) while node-apps' env-state uses the node-network IP.

5. **promote-k8s-image.sh**: unchanged. Runs post-rsync.

6. **Deploy-branch migration**: on first promote after merge, the rsync copies the new kustomization.yaml files + deletes any files not in main. Without `env-state.yaml` present, kustomize build fails. Seed `env-state.yaml` into each deploy branch as part of this PR's deploy-branch bootstrap step (automated, not manual): a one-shot workflow run that writes `env-state.yaml` to `deploy/{preview,canary,candidate-a,production}` with the currently-used IPs extracted from the pre-merge overlay kustomization.yaml files. Runs once; after that, ongoing provision writes handle updates.

**Rejected**:

- **One env-state.yaml per env (not per overlay)**: production's two-IP topology breaks the flat schema. Would require multiple keys like `VM_IP_SCHEDULER_WORKER` and `VM_IP_NODE_APP`, each overlay picks the right key. More moving parts, less obvious at review time than "this overlay has its own IP file."
- **Hand-delete the stale `COGNI_NODE_ENDPOINTS` patch on `deploy/preview`**: reverses a previous manual action (allowed by user's stated rules), but only heals one env for one key. Next drift-class bug appears and we're back here.
- **Drop deploy branches entirely, Argo tracks main**: correct end state, far larger refactor. Separate work item.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] INFRA_K8S_MAIN_DERIVED: `git diff <promoted-sha> origin/deploy/<env> -- infra/k8s/ ':!**/env-state.yaml'` returns empty (modulo digest lines written by `promote-k8s-image.sh`) on every env after every promote.
- [ ] ENV_STATE_IS_TRUTH: Provision writes **only** `env-state.yaml` files under `infra/k8s/overlays/**`. Grep for any `sed`/`awk`/`yq` edits against `kustomization.yaml` in provision scripts → none.
- [ ] REPLACEMENTS_NOT_INLINE: `grep -r 'op: replace' infra/k8s/overlays/**/kustomization.yaml | grep 'addresses'` returns zero matches. All EndpointSlice addresses flow via kustomize `replacements`.
- [ ] RENDER_INVARIANT: `kustomize build` output for all 16 overlay × app combinations is byte-identical before/after the refactor.
- [ ] SIMPLE_SOLUTION: Uses only kustomize native `replacements` and rsync `--exclude`. Zero new scripts, zero YAML merge logic.

### Files

- Create: `infra/k8s/overlays/<env>/<app>/env-state.yaml` × 16.
- Modify: `infra/k8s/overlays/<env>/<app>/kustomization.yaml` × 16 — add env-state resource + replacements, delete inline IP patches.
- Modify: `.github/workflows/promote-and-deploy.yml` — full-tree rsync with env-state.yaml exclude; comment rewrite.
- Modify: `scripts/ci/deploy-infra.sh` — write env-state.yaml files; delete inline overlay edits.
- Modify: `scripts/setup/provision-test-vm.sh` — same.
- Docs: update `docs/spec/cd-pipeline-e2e.md` (sync step diagram + invariant), `docs/spec/ci-cd.md` (truth-source model), `docs/guides/node-formation-guide.md` and `docs/guides/multi-node-deploy.md` (provisioning writes env-state).

## Plan

- [ ] **Checkpoint 1 — env-state.yaml + kustomize replacements per overlay; byte-identical render**
  - Create `env-state.yaml` × 16 with current IP values lifted from existing inline patches.
  - Rewrite kustomization.yaml × 16: add `env-state.yaml` to `resources`, add `replacements` block targeting each EndpointSlice, delete inline IP patches.
  - Validation: `kustomize build` × 16 diff vs `/tmp/bug0329-baseline/` → identical.

- [ ] **Checkpoint 2 — Workflow rsync**
  - `.github/workflows/promote-and-deploy.yml`: full-tree rsync excluding `env-state.yaml`; comment rewrite.
  - No functional test in CI until this ships and a promote runs.

- [ ] **Checkpoint 3 — Provision scripts write env-state.yaml**
  - `scripts/ci/deploy-infra.sh`: replace inline overlay edits with `env-state.yaml` writes.
  - `scripts/setup/provision-test-vm.sh`: same.

- [ ] **Checkpoint 4 — Spec + guide updates**
  - `docs/spec/cd-pipeline-e2e.md`, `docs/spec/ci-cd.md`, `docs/guides/multi-node-deploy.md`, `docs/guides/node-formation-guide.md`.

## Validation

- `kustomize build infra/k8s/overlays/<env>/<app>` diff vs baseline × 16 → identical.
- `pnpm check` clean.
- Post-merge: first promote on `deploy/preview` rsyncs updated overlay from main (no COGNI_NODE_ENDPOINTS patch, bug.0333's fix now authoritative) → preview scheduler-worker ConfigMap reads `:3000` for all node entries → task.0280 HTTP delegation works → poly-preview chat recovers. **No manual deploy-branch commit.**
- Reprovision a preview VM with a different IP: provision writes new VM_IP into `deploy/preview/infra/k8s/overlays/preview/<app>/env-state.yaml`. No other files touched.
- `grep -r 'addresses' infra/k8s/overlays/**/kustomization.yaml` returns zero matches.
