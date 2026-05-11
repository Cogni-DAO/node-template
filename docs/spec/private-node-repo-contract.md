---
id: private-node-repo-contract-spec
type: spec
title: Private Node Repos & Sovereign node-template Contract
status: draft
spec_state: draft
trust: draft
summary: Phased plan for splitting nodes into private/sovereign repos. v0 forks Cogni's poly node into a private repo with its own VMs; the cogni monorepo is renamed; node-template becomes a real sovereign-fork quickstart.
read_when: Splitting a node into a private/sovereign repo, planning external-contributor onboarding, designing multi-tenant operator GH App, or evaluating shared-infra vs. own-VMs trade-offs for a node.
owner: derekg1729
created: 2026-05-07
tags: [meta, deployment, sovereignty]
---

# Private Node Repos & Sovereign node-template Contract

## Context

Cogni's [Node vs Operator Contract](./node-operator-contract.md) defines node sovereignty as non-negotiable: a node must be forkable and runnable without any Cogni Operator account. Today the codebase ships in one repo (`Cogni-DAO/cogni`) which is misnamed — it IS the active multi-node monorepo (operator + resy + poly + a node-template fixture), not a template anyone would fork.

Two pressures force a structural change now:

1. **Cogni's poly node needs to go private.** Polymarket trading logic, target wallet research, and CLOB integrations are not appropriate for an open repo.
2. **External contributors need a real fork target.** "Cogni-DAO/cogni" implies a quickstart but currently delivers an entire multi-node monorepo with operator code, resy, and active development churn.

The current `single-node-scope` gate ([Node CI/CD Contract](./node-ci-cd-contract.md)) handles cross-domain PRs _within_ one repo. It does not address node-as-its-own-repo.

## Goal

Define a phased path from "single monorepo with all nodes" to "private/sovereign nodes can live in their own repos" that:

- Preserves [Node vs Operator Contract](./node-operator-contract.md) sovereignty invariants (FORK_FREEDOM, DEPLOY_INDEPENDENCE, WALLET_CUSTODY, etc.)
- Builds **zero new abstractions** in v0 — extracts no cross-repo deploy plane, no shared-k3s multi-tenancy, no multi-tenant GH App
- Surfaces real signal before designing the platform-grade abstractions of vNext
- Aligns Cogni's open-source + sovereignty story: forking `node-template` produces a complete, sovereign Cogni node — not a client of Cogni's operator service

## Core Invariants

1. **NODE_OWNS_OWN_BUILD**: A private/forked node's repo owns its own app + migrator image builds, schemas, and Dockerfile. The operator monorepo never reads a private node's source.
2. **NODE_OWNS_OWN_DEPLOY_STATE_v0**: In v0, a private/forked node owns its own k8s overlays, Argo CD, secrets, deploy branches, and VMs. No cross-repo deploy plane is built until Phase 3.
3. **NO_CROSS_REPO_INFRA_v0**: v0 builds zero new abstractions in `cogni` to support `cogni-poly` (no cross-repo dispatch lever, no shared k3s, no shared sops). Each repo is a complete, self-contained system.
4. **SOVEREIGN_FORK_QUICKSTART**: Forking `Cogni-DAO/cogni` produces a complete, sovereign Cogni node with its own VMs and infra — never a client of Cogni's hosted operator. Cogni Operator GH App is opt-in value-add (Phase 2+), not a runtime dependency.
5. **GHCR_IS_ORG_SCOPED**: `ghcr.io/cogni-dao/<image>` references survive repo rename. Image refs in overlays do not need updating when `node-template` → `cogni`.
6. **REPO_RENAME_SETTLES_BEFORE_REUSE**: `Cogni-DAO/cogni` cannot be recreated until GitHub releases the slug post-rename (~24h budget). Phase 0 sequences the new `node-template` quickstart fork after the settle window.
7. **OPERATOR_GH_APP_INSTALL_PER_REPO**: The same `cogni-node-template` GH App is installed on each repo it operates on (`cogni`, `cogni-poly`, future external nodes). Multi-tenant runtime support is Phase 2.

## Non-Goals

- **Multi-tenant operator GH App** — deferred to Phase 2. v0 keeps the operator agent single-tenant; a fork can hardcode its own repo identity if it wants its own AI engineering manager loop.
- **Operator-hosted node tenancy** (Railway-like) — deferred to Phase 3.
- **Per-node compute metering / billing** — deferred to Phase 4 (Akash north star).
- **Shared k3s + cross-repo deploy plane** — explicitly rejected for v0. v0 nodes that want privacy run their own VMs.
- **`packages/` extraction to a registry (npm / GH Packages)** — deferred. v0 vendors shared packages into the fork at fork time and accepts drift.

## Design

### Repo Topology

| Repo                       | Visibility | Contains                                                 | Forking it means                                                                                                       |
| -------------------------- | ---------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **`Cogni-DAO/cogni`**      | Public     | Operator + resy + node-template fixture + all rails      | Active Cogni development. Self-host the entire Cogni platform.                                                         |
| **`Cogni-DAO/cogni-poly`** | Private    | Poly only (single-node mono with full rails)             | Cogni's own production node — internal-only, sovereign of the open monorepo.                                           |
| **`Cogni-DAO/cogni`**      | Public     | Minimal node skeleton + full rails (no operator, no biz) | "I want a sovereign Cogni node. My own VMs. My own secrets. Optionally opt into Cogni's AI engineering manager later." |

`Cogni-DAO/cogni` is the rename of the current `Cogni-DAO/cogni`. The `node-template` slug is then released by GitHub and reused for the new minimal quickstart fork.

### Onboarding Paths

| Path                                                 | When                                          | Sovereignty                                | Cost                              |
| ---------------------------------------------------- | --------------------------------------------- | ------------------------------------------ | --------------------------------- |
| Add `nodes/<name>/` in `Cogni-DAO/cogni`             | Cogni-internal nodes, no privacy needs        | Shares Cogni's VMs, secrets, CI            | Lowest — default                  |
| Fork `Cogni-DAO/cogni`                               | External orgs / privacy-needing nodes         | Own VMs, own secrets, own CI               | 3 VMs (cand/preview/prod) + ops   |
| Fork `node-template` + install Cogni Operator GH App | Same as above, plus AI engineering management | Own infra, opt-in to operator capabilities | + GH App install (Phase 2 onward) |
| Cogni-hosted node tenancy                            | vNext (Phase 3)                               | None at infra layer                        | Pay Cogni                         |

### v0 Ownership Matrix (Cogni-poly)

| Asset                                | Owner                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| Poly app + packages + schemas        | `cogni-poly` (private)                                                         |
| Poly app/migrator image builds       | `cogni-poly` CI → private GHCR (`ghcr.io/cogni-dao/cogni-poly-{app,migrator}`) |
| Poly k8s overlays + kustomize        | `cogni-poly`                                                                   |
| Poly runtime secrets (sops'd or env) | `cogni-poly`                                                                   |
| Poly deploy branches                 | `cogni-poly` (`deploy/<env>-poly` lives in its own repo)                       |
| Poly Argo CD                         | `cogni-poly`'s own k3s on `cogni-poly`'s own VMs                               |
| Poly's GH App (PR review etc.)       | Same `cogni-node-template` GH App, dual-installed on `cogni-poly` (Phase 1+)   |

**Each node is a complete, self-contained system.** No cross-repo deploy plane. No shared k3s. No shared sops.

### Why poly runs its own VMs in v0 (~$150-300/mo extra cost)

A shared-k3s, multi-source-Argo design would save the VM cost but requires building:

- A cross-repo dispatch lever (`cogni-poly` → `cogni`'s `promote-poly-digest.yml`)
- Cross-repo Argo creds (deploy keys for private repos on shared cluster)
- Secrets-sourced-from-elsewhere coupling (whose sops keys decrypt poly's secrets?)
- An operator-side abstraction for "deploy a remote node"

Building those for n=1 known node we control is premature. The right shape for that abstraction emerges only with n≥2 real consumers and a working multi-tenant GH App. v0's goal is decoupling, not optimization. Pay the VM cost; defer the design.

### Hardcoded Repo Identity (v0 simplification)

The operator agent today hardcodes one target repo (`Cogni-DAO/cogni`, soon `Cogni-DAO/cogni`). After fork, `cogni-poly` updates its own copy of those references to point at itself. Each repo's operator-agent instance manages its own repo. **No new "multi-repo operator" code in v0** — that's Phase 2.

### Phased Plan

#### Phase 0 — Decouple poly into private repo (THIS WORK)

| Step | Task                                                                                                                                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1  | Land this spec                                                                                                                                                                                                 |
| 0.2  | Rename `Cogni-DAO/cogni` → `Cogni-DAO/cogni`                                                                                                                                                                   |
| 0.3  | Update Argo `repoURL` in `infra/k8s/**/Application*.yaml`                                                                                                                                                      |
| 0.4  | Update hardcoded `Cogni-DAO/cogni` strings in scripts/docs (only where trivial)                                                                                                                                |
| 0.5  | Confirm GHCR refs unaffected (org-scoped — verified)                                                                                                                                                           |
| 0.6  | Wait for GH redirect to settle; create `Cogni-DAO/cogni-poly` (private, full history)                                                                                                                          |
| 0.7  | Strip `cogni-poly` to single-node: remove `nodes/{operator,resy,node-template}/`, prune root `packages/` to poly's transitive deps, vendor any cross-node packages, drop their catalog/overlay/secrets entries |
| 0.8  | Strip `cogni`: remove `nodes/poly/`, `infra/catalog/poly.yaml`, `infra/k8s/overlays/*/poly/`, `infra/k8s/secrets/*/poly*`, root `packages/poly-*` if any                                                       |
| 0.9  | Provision `cogni-poly`'s own VMs via existing `provision-test-vm.sh`                                                                                                                                           |
| 0.10 | Install `cogni-node-template` GH App on `cogni-poly`; set `GH_REVIEW_APP_*` env secrets in cogni-poly's environments                                                                                           |
| 0.11 | Wait for GH to release the `node-template` slug (~24h post-rename); create new `Cogni-DAO/cogni` (public, minimal fork of `cogni` stripped to node-template fixture + rails)                                   |

Phase 0 is **decoupling, not platform-building.** Zero new platform code; the only edits are repo renames, file moves, and string updates.

#### Phase 1 — Validate the sovereign-fork model

- Document the fork-and-stand-up flow end-to-end using `cogni-poly` as the proof case
- Validate `node-template` quickstart: someone (Derek as proxy) forks it cleanly and stands up a working node from scratch
- Capture friction points; convert recurring ones into reusable workflows or scripts in `cogni`'s rails

#### Phase 2 — Multi-tenant operator GH App

- `operator_node_registrations` table + GH App installation webhook → auto-register
- Per-installation auth, per-node API keys, per-node DB tenancy
- Operator agent loop iterates registered installations rather than hardcoding one repo
- PR review + candidate-flight dispatch work cross-repo
- **Unblocks**: Cogni Operator becomes useful as an opt-in service for forked `node-template` users

#### Phase 3 — Operator-hosted node tenancy (Railway model)

- Multi-tenant k3s namespacing per registered `node_id`
- Self-service overlay scaffolding from a node repo's `node.yaml`
- Per-node secret-sync API (so external nodes aren't shipping secrets through Cogni's repo)
- **Unblocks**: External orgs can run nodes on Cogni-managed infra without self-hosting VMs

#### Phase 4 — Compute metering (Akash north star)

- Pod-level resource accounting per `node_id`
- Billing pipeline → `charge_receipts`
- Cogni-hosted nodes pay; sovereign-fork nodes don't

### Repo-Rename Mechanics

GitHub auto-redirects all references from old → new slug after rename. The redirect occupies the old slug, but GitHub releases it after a brief settle period (empirically ~minutes to a few hours; budget 24h to be safe before reusing).

| Step | Action                                                                                                                                 |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------- |
| R.1  | UI rename `Cogni-DAO/cogni` → `Cogni-DAO/cogni`                                                                                        |
| R.2  | PR in `cogni` updating Argo `Application.spec.source.repoURL` to `Cogni-DAO/cogni`                                                     |
| R.3  | Audit + update hardcoded `Cogni-DAO/cogni` strings in scripts, docs, env-config                                                        |
| R.4  | Update PR/branch references in any pinned GitHub Actions URLs                                                                          |
| R.5  | Re-test candidate-flight + promote-and-deploy on `cogni`                                                                               |
| R.6  | After settle, attempt to create `Cogni-DAO/cogni`. If blocked, escalate via GH support or use interim name `node-template-quickstart`. |

GHCR image refs are org-scoped (`ghcr.io/cogni-dao/<image>`), unaffected by repo rename. ✅

### Cross-references

- [Node vs Operator Contract](./node-operator-contract.md) — sovereignty invariants this spec preserves
- [Node CI/CD Contract](./node-ci-cd-contract.md) — `single-node-scope` gate applies within a single repo; this spec extends the model to single-node repos
- [VCS Integration spec](./vcs-integration.md) — `operator_node_registrations` schema referenced in Phase 2
- [Identity Model](./identity-model.md) — `node_id` semantics

## Acceptance Checks

**Phase 0 done when:**

- [ ] `Cogni-DAO/cogni` exists; `Cogni-DAO/cogni` redirect works for prior issue/PR links
- [ ] `Cogni-DAO/cogni-poly` exists, private, full history, single-node mono
- [ ] `cogni-poly` has its own running VMs across all 3 envs; flighted at least one PR end-to-end
- [ ] `cogni` no longer contains any `poly` directories or catalog/overlay/secret entries
- [ ] `cogni` candidate-flight + promote-and-deploy still green on a representative PR
- [ ] New `Cogni-DAO/cogni` exists, public, minimal — quickstart README works for a clean fork

**Sovereignty preserved (manual):**

- [ ] `cogni-poly` runs `docker compose up` (or `provision-test-vm.sh` + Argo) without any reference to `cogni`'s infrastructure or accounts
- [ ] `cogni-poly`'s deploy state lives entirely within `cogni-poly`'s git
- [ ] `cogni-poly`'s runtime secrets are owned by `cogni-poly`'s GitHub Environments

## Open Questions

- **Vendoring strategy for shared `packages/`** — at fork time, which packages get vendored and which remain root-shared until vNext extraction? Proposal: any package poly's `nodes/poly/app` or `nodes/poly/graphs` imports gets vendored into `cogni-poly/packages/`. Resolves at fork-execution time.
- **Phase 2 GH App rename** — should `cogni-node-template` GH App be renamed to `cogni-operator` to match its actual role? Touches `appId` (no), `installationId` (no), but does touch UI displays + permission grants. Defer the rename to when Phase 2 ships.
- **`single-node-scope` gate semantics in single-node repos** — the gate becomes a no-op in `cogni-poly`. Either delete the workflow there or keep it as a self-validating check that the repo really is single-node. Lean: keep + simplify.

## Node-naming convention (node-template fork hygiene)

`Cogni-DAO/node-template` is the canonical fork target. Every active config and workflow MUST be retargetable to a forker's node name via one of three mechanisms — ranked by preference. New code that introduces a per-node string MUST land in tier A or B unless tier C is structurally unavoidable.

**Tier A — convention-discoverable (preferred; no edit needed by forker).**

Scripts and workflows iterate the filesystem and act on what they find.

- Workspace globs: `pnpm-workspace.yaml` uses `nodes/*/app`, `nodes/*/graphs`, `nodes/*/packages/*`.
- Architecture enforcement: `.dependency-cruiser.cjs` layer regexes use `^nodes/[^/]+/app/src/<layer>` so the rules apply to any node directory.
- Test discovery: `tests/arch/tool-catalog-no-global-iteration.test.ts` uses `readdirSync("nodes")` to enumerate nodes at test time.
- Argo CD generators: `infra/k8s/argocd/*-applicationset.yaml` use a single git generator pinned to one catalog file; the catalog file's `name` field drives `{{.name}}` substitution throughout the template.

**Tier B — config-derived (read `.cogni/repo-spec.yaml` `intent.name` or the catalog yaml).**

Scripts that need a single node name read it from the canonical source.

- `intent.name` in `.cogni/repo-spec.yaml` is the SSOT for the human-facing node name.
- `infra/catalog/<name>.yaml`'s `name` field drives image tag suffixes (`-<name>`, `-<name>-migrate`), deploy branch names (`deploy/{candidate-a,preview,production}-<name>`), and Argo Application paths.
- New per-node scripts: read from `.cogni/repo-spec.yaml` via `@cogni/repo-spec` accessors; do not hardcode a literal.

**Tier C — filesystem rename (structurally unavoidable; the rename helper covers this).**

Some strings cannot be expressed via convention or config without inventing a new abstraction. They are renamed mechanically by `scripts/rename-node.sh <new-name>`:

- `nodes/node-template/` directory name
- `@cogni/node-template-app`, `@cogni/node-template-knowledge` package names
- `infra/catalog/node-template.yaml` filename
- `tsconfig.base.json` `@/*` alias path entries (`nodes/node-template/app/src/*`)
- Per-node tsconfig project references in root `tsconfig.json`
- `sonar-project.properties` source paths
- ApplicationSet `revision: deploy/preview-node-template` + `path: infra/catalog/node-template.yaml` pins

The rename script does `git mv` + `perl -pi -e 's/node-template/<new>/g'` across all tracked text files, excluding only itself and `pnpm-lock.yaml` (regenerated by `pnpm install`). Forkers run it once after cloning; the resulting commit IS the fork.

**Anti-rule.** Do not add new tier-C surface area. If a tier-C hardcoded literal is unavoidable, document why in the file and update this section.

### Acceptance for the convention

- `scripts/rename-node.sh foobar` on a clean fork yields a green `pnpm install --no-frozen-lockfile && pnpm packages:build && pnpm test:ci` with zero manual edits.
- `git grep -nI '\bnode-template\b' -- ':!docs/' ':!work/' ':!.claude/' ':!scripts/rename-node.sh' ':!pnpm-lock.yaml'` returns ONLY occurrences the rename script will sed-replace.

## Related

- [Node vs Operator Contract](./node-operator-contract.md)
- [Node CI/CD Contract](./node-ci-cd-contract.md)
- [VCS Integration](./vcs-integration.md)
