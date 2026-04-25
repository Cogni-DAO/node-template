---
id: task.0374
type: task
title: "Catalog-as-SSoT — make infra/catalog/*.yaml the single node declaration"
status: needs_design
priority: 0
rank: 1
estimate: 4
branch: feat/catalog-ssot-pivot
summary: "Pivot before task.0372: make `infra/catalog/*.yaml` the single source of truth for the node list. Every CI/infra consumer that today hardcodes `(operator poly resy scheduler-worker)` (image-tags.sh, detect-affected.sh, wait-for-argocd.sh, compose, future bootstrap script) reads catalog instead. Adding a node collapses from a 10-file edit to a 3-step PR (drop catalog yaml + write Dockerfile + add overlay)."
outcome: "After this task, `infra/catalog/*.yaml` is the only place a node is declared. `scripts/ci/lib/image-tags.sh` reads it. `scripts/ci/detect-affected.sh` reads it (path_prefix → target). `scripts/ci/wait-for-argocd.sh`'s default APPS list reads it. Compose generation (or its CI doc) references it. A new lint check (`scripts/ci/check-catalog-ssot.sh`) fails CI when any consumer references a node not present in catalog. task.0372's Layer 1 bootstrap script (push 12 deploy branches) becomes a one-liner over `infra/catalog/*.yaml`."
spec_refs:
  - ci-cd
assignees: []
project: proj.cicd-services-gitops
created: 2026-04-25
updated: 2026-04-25
labels: [ci-cd, infra, ssot, task.0372-blocker]
external_refs:
  - work/items/task.0372.candidate-flight-matrix-cutover.md
  - work/projects/proj.cicd-services-gitops.md
---

# task.0374 — Catalog-as-SSoT pivot

## Why this lands before task.0372

Reviewer note (2026-04-25, on task.0372 PR-prep): _"Pivot to catalog SSoT this week, before 0372. … After SSoT lands, 0372's Layer 1 bootstrap script becomes a one-liner iterating `infra/catalog/*.yaml`. That's the multiplier you want before adding nodes."_

The matrix cutover (task.0372) is currently parameterized by hardcoded node lists scattered across CI scripts and YAML. Shipping it on top of duplicated lists doubles the migration cost: every per-node branch, every matrix `include`, every `wait-for-argocd APPS` list, every `detect-affected` path-prefix arm has to be edited each time a node lands or leaves. With a real SSoT, the matrix shape derives from one `ls infra/catalog/*.yaml` glob. **Defer task.0372 PR open. Land this first.**

## Current state — duplicated node-list sites (audit)

| Site                                                                           | What it hardcodes                                                                                                                       | Drift evidence                                                                               |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `scripts/ci/lib/image-tags.sh`                                                 | `ALL_TARGETS=(operator poly resy scheduler-worker)`; `NODE_TARGETS=(operator poly resy)`; `tag_suffix_for_target()` case arm per target | The de-facto registry today (per ci-cd.md axiom 16). Catalog files exist but don't drive it. |
| `scripts/ci/detect-affected.sh`                                                | per-target case arms mapping `nodes/<name>/*` → `add_target <name>`                                                                     | New node = new case arm. Catalog has no `path_prefix` field yet.                             |
| `scripts/ci/wait-for-argocd.sh`                                                | `APPS=(operator poly resy scheduler-worker sandbox-openclaw)` default                                                                   | **Drifted**: `sandbox-openclaw` appears here but not in `image-tags.sh`.                     |
| `infra/compose/runtime/docker-compose.yml`                                     | service definitions per node + `COGNI_NODE_ENDPOINTS=operator=http://app:3000,poly=http://poly:3100,…`                                  | Not generated; hand-edited.                                                                  |
| `infra/k8s/argocd/<env>-applicationset.yaml`                                   | implicit via `files: infra/catalog/*.yaml`                                                                                              | ✅ already catalog-driven.                                                                   |
| Future `scripts/ops/bootstrap-per-node-deploy-branches.sh` (task.0372 Layer 1) | would have to re-enumerate the node list                                                                                                | **Avoidable** by landing this task first.                                                    |

## Catalog shape — what needs adding

Existing fields per `infra/catalog/<name>.yaml` (already declared by task.0247 + task.0320):

```yaml
name: operator
type: node # node | service
port: 3000
node_id: "<uuid>"
dockerfile: nodes/operator/app/Dockerfile
image_tag_suffix: "" # "" for operator, "-poly", "-resy", "-scheduler-worker"
migrator_tag_suffix: "-operator-migrate"
candidate_a_branch: deploy/candidate-a-operator
preview_branch: deploy/preview-operator
production_branch: deploy/production-operator
```

New field this task adds:

```yaml
path_prefix: nodes/operator/ # detect-affected.sh maps this prefix → this target
# (scheduler-worker uses services/scheduler-worker/)
```

Optionally (deferred to follow-up if non-trivial):

```yaml
compose_service: operator # name in docker-compose.runtime.yml
compose_endpoint_url: "http://app:3000" # for COGNI_NODE_ENDPOINTS generation
```

The compose fields are Run-tier ("regenerate compose from catalog"). This task ships the Walk tier (read-only consumers), not full compose generation.

## Design

### Outcome

**One declaration site: `infra/catalog/<name>.yaml`.** Every existing CI/infra consumer that today hardcodes a per-node list reads catalog instead. A CI lint enforces "no consumer references a node not in catalog". Adding a node is: drop a catalog yaml, write a Dockerfile, add an overlay → workflows pick it up next run.

### Approach

**One commit per consumer migrated, in the order below.** Small, reviewable steps; each one independently revertable; final commit is the lint that locks the new contract in place.

#### Step 1 — Migrate `scripts/ci/lib/image-tags.sh` (the de-facto registry)

Replace hardcoded arrays + case-arm function with catalog readers. New shape:

```bash
catalog_targets()        { ls infra/catalog/*.yaml | xargs -n1 basename | sed 's/\.yaml$//' ; }
catalog_node_targets()   { for f in infra/catalog/*.yaml; do yq -r 'select(.type == "node") | .name' "$f"; done; }
catalog_field()          { local name="$1" field="$2"; yq -r ".${field}" "infra/catalog/${name}.yaml"; }
tag_suffix_for_target()  { catalog_field "$1" image_tag_suffix; }
image_name_for_target()  { printf '%s' "$IMAGE_NAME_APP"; }   # unchanged
```

Compatibility shims (drop after one full release cycle):

```bash
ALL_TARGETS=()
mapfile -t ALL_TARGETS < <(catalog_targets)
NODE_TARGETS=()
mapfile -t NODE_TARGETS < <(catalog_node_targets)
```

`yq` (mikefarah's go-yq) is already installed on every workflow runner via the standard ubuntu-latest setup-yq pattern; verify with one workflow run before merging. Fallback: a 5-line python parser if yq isn't reliably present.

#### Step 2 — Migrate `scripts/ci/detect-affected.sh`

Add `path_prefix:` to all 4 catalog files. Replace the case-arm in detect-affected.sh:

```bash
# Before
case "$path" in
  nodes/operator/packages/* | nodes/operator/*) add_target operator ;;
  nodes/poly/packages/* | nodes/poly/*)         add_target poly ;;
  …
esac

# After
for catalog_file in infra/catalog/*.yaml; do
  target=$(yq -r '.name' "$catalog_file")
  prefix=$(yq -r '.path_prefix' "$catalog_file")
  case "$path" in "${prefix}"*) add_target "$target" ;; esac
done
```

#### Step 3 — Migrate `scripts/ci/wait-for-argocd.sh`

Replace the hardcoded default APPS list:

```bash
# Before
APPS=(operator poly resy scheduler-worker sandbox-openclaw)

# After
mapfile -t APPS < <(yq -r '.name' infra/catalog/*.yaml)
```

This **fixes the existing `sandbox-openclaw` drift** by making it the catalog's responsibility (its placeholder catalog entry would need to opt out via a new `wait_for_argocd: false` field, OR sandbox-openclaw simply doesn't get a catalog entry yet).

#### Step 4 — CI lint: `scripts/ci/check-catalog-ssot.sh`

A repo-grep guard. For each ASCII identifier `operator|poly|resy|scheduler-worker` appearing in CI scripts/workflows/compose, fail unless it's:

1. inside `infra/catalog/*.yaml` (the SSoT itself), OR
2. inside a known-allowlisted file (e.g., human-readable test fixture, ADR, work item).

Run on every PR via a new `ci-ssot` job in `pr-build.yml`. Locks the contract: future PRs that hardcode a node name will fail CI with a pointer to this task.

#### Step 5 — Out-of-scope, deferred to follow-up tasks

- **Compose generation from catalog** — `infra/compose/runtime/docker-compose.yml` references nodes structurally (one `service:` block per node + DSN env vars). A real fix means generating compose YAML from the catalog at deploy-prep time. Significant scope; file as task.0375 (Run tier).
- **K8s overlay generation from catalog** — `infra/k8s/overlays/<env>/<node>/kustomization.yaml` is per-node hand-maintained. Out of scope for this task.
- **Catalog schema validation** (Zod / JSON Schema for `infra/catalog/*.yaml`) — useful but not on the critical path. Follow-up.

### Reuses

- `infra/catalog/*.yaml` — already declared (task.0247, task.0320). Just add `path_prefix:` and start reading.
- `yq` — already used in CI workflows; standard ubuntu-latest setup.
- Existing AppSet shape (`files: infra/catalog/*.yaml`) — no change; AppSets already catalog-driven.

### Rejected

- **Top-down rewrite — generate everything from catalog (compose + overlays + k8s base) in this task.** Too big; multiplies blast radius. Step 5 captures the deferred portion as a follow-up. Walk-then-run.
- **Embed the SSoT in `image-tags.sh` itself ("just keep this single file as canon")** — the reviewer's exact point: not actually SSoT if compose, detect-affected, wait-for-argocd each maintain their own copy. The drift in `wait-for-argocd.sh` (sandbox-openclaw) is the proof it's not single-sourced today.
- **Use TypeScript/Node to read catalog from CI scripts** — most consumers are bash. `yq` is the lower-friction reader.
- **Land this AFTER task.0372** — would force task.0372 to either ship with hardcoded lists (re-paying the migration cost when a node lands) or land a partial SSoT inside the matrix PR (unscoped). Reviewer's pivot is correct; this lands first.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] CATALOG_IS_SSOT: After this task, `infra/catalog/*.yaml` is the only file that lists nodes. `scripts/ci/check-catalog-ssot.sh` enforces this on every PR. (spec: ci-cd)
- [ ] NO_HARDCODED_NODE_LIST: `scripts/ci/lib/image-tags.sh`, `scripts/ci/detect-affected.sh`, `scripts/ci/wait-for-argocd.sh` contain no literal `(operator poly resy scheduler-worker)` array or equivalent case arm. All node enumeration is catalog-driven. (spec: ci-cd)
- [ ] PATH_PREFIX_DECLARED: Every `infra/catalog/<name>.yaml` declares a `path_prefix:` field, and `detect-affected.sh` reads it. (spec: ci-cd)
- [ ] BACKWARDS_COMPATIBLE_SHIM: Migration ships compatibility shims (`ALL_TARGETS`, `NODE_TARGETS` arrays exported by `image-tags.sh`) so callers that haven't migrated yet keep working. Shims removable after one release cycle. (spec: ci-cd)
- [ ] CI_LINT_BLOCKS_REGRESSION: `scripts/ci/check-catalog-ssot.sh` runs on every PR; fails when a CI script / workflow / compose file hardcodes a node name not in catalog. (spec: ci-cd)
- [ ] TASK_0372_MULTIPLIER: After this task, task.0372's Layer 1 bootstrap script (push 12 per-node deploy branches) is a one-liner: `for c in infra/catalog/*.yaml; do for env in candidate-a preview production; do …; done; done`. Verified by drafting that script as a checkpoint commit (not merged from this PR; just exists in branch comments to prove the property). (spec: ci-cd)
- [ ] NO_NEW_RUNTIME_DEPS: No new packages, no new long-running services, no new tooling beyond `yq` (already installed). (spec: architecture)
- [ ] SIMPLE_SOLUTION: Net new code is ~1 catalog field × 4 files + ~30 lines of bash refactor + ~50 lines for the lint script. No new abstractions.
- [ ] ARCHITECTURE_ALIGNMENT: `infra/catalog/*.yaml` was always meant to be the catalog (per `infra/AGENTS.md`); this task delivers on that promise instead of leaving it half-wired.

### Files

**Modify (catalog — declare new field)**

- `infra/catalog/{operator,poly,resy,scheduler-worker}.yaml` — add `path_prefix:` field. ~4 lines total.

**Modify (consumers — migrate one at a time)**

- `scripts/ci/lib/image-tags.sh` — replace hardcoded arrays + case arm with catalog readers (`yq`-backed). Keep `ALL_TARGETS` / `NODE_TARGETS` arrays as shims (populated from catalog at source time). One commit.
- `scripts/ci/detect-affected.sh` — replace per-target case arms with iteration over `infra/catalog/*.yaml` `path_prefix`. One commit.
- `scripts/ci/wait-for-argocd.sh` — replace hardcoded default APPS list with `mapfile` from catalog. One commit. (Drops `sandbox-openclaw` from the default; that node lacks a catalog entry today and is already a placeholder.)

**Create (CI lint)**

- `scripts/ci/check-catalog-ssot.sh` — repo-grep guard. ~50 lines.
- `.github/workflows/pr-build.yml` (or new `.github/workflows/ci-ssot.yml`) — wire the check into PR CI. ~10 lines.

**Modify (spec)**

- `docs/spec/ci-cd.md` — replace axiom 16 ("`scripts/ci/lib/image-tags.sh` defines `ALL_TARGETS`…") with `CATALOG_IS_SSOT` axiom pointing to `infra/catalog/*.yaml`.
- `infra/AGENTS.md` — relax the "catalog stays thin" boundary to name the new `path_prefix:` field, alongside the `*_branch` fields task.0320 added.

**Test**

- Manual validation: run each migrated script locally against the live catalog; confirm output identical to pre-migration. Compare `image-tags.sh` `ALL_TARGETS` expansion before/after; compare `detect-affected.sh` output for known PR diffs; compare `wait-for-argocd.sh` APPS for `PROMOTED_APPS=""` default.
- One CI dry-run: open this PR, run pr-build.yml, confirm the new `ci-ssot` job is green and the rest of CI is unchanged.

## Validation

### exercise

1. Local: `bash scripts/ci/lib/image-tags.sh; echo "${ALL_TARGETS[@]}"` (after sourcing) → `operator poly resy scheduler-worker`. Add a 5th catalog file (`canary.yaml`); re-source; output now includes `canary`. Delete the test catalog file.
2. Local: introduce a deliberate hardcode in a workflow (e.g., add `# echo operator poly resy` to a comment in `pr-build.yml`); run `bash scripts/ci/check-catalog-ssot.sh` → fails with a pointer to this task. Revert.
3. CI: open this PR. The new `ci-ssot` job is green. All existing CI green (no regression).

### observability

- The `ci-ssot` job's GHA log lists every catalog-driven node enumeration site and confirms zero hardcoded violations.
- Image-tag and affected-targets workflow output for a known PR (e.g., `feat/poly-…`) is byte-identical pre- and post-migration.

## Success criteria

- A new node ships in **3 file edits**: drop `infra/catalog/<name>.yaml`, write `nodes/<name>/app/Dockerfile`, add `infra/k8s/overlays/<env>/<name>/kustomization.yaml`. Every other CI / infra concern picks it up automatically.
- task.0372's Layer 1 bootstrap script becomes a one-liner over `infra/catalog/*.yaml`, ready to run.
- Compose generation remains a follow-up (Run tier); the SSoT contract for _CI_ consumers is locked in by the lint.

## PR / Links

- Reviewer note: 2026-04-25 task.0372 PR-prep review.
- Blocks: [task.0372](task.0372.candidate-flight-matrix-cutover.md) (frozen pending this).
- Spec: [docs/spec/ci-cd.md](../../docs/spec/ci-cd.md) axiom 16 (will be rewritten).
