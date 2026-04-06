---
id: proj.cicd-services-gitops
type: project
primary_charter:
title: CI/CD Pipeline
state: Active
priority: 1
estimate: 5
summary: Get the canary-first pipeline fully green — build→promote→deploy→verify→E2E→preview→release→production
outcome: One clean flow from push-to-canary through production with no rebuilds, E2E-gated promotion, and CI-gated preview
assignees: derekg1729
created: 2026-02-06
updated: 2026-04-05
labels: [deployment, infra, ci-cd]
---

# CI/CD Pipeline

## Goal

Get the canary-first pipeline fully green: build once on canary, promote proven digests through preview to production. Currently 60% complete — build, promote-k8s, and deploy-infra work. Everything after verify is blocked (other dev actively fixing EndpointSlice routing + Temporal bootstrap). Even when unblocked, 9 verified gaps prevent clean end-to-end release flow.

## Pipeline Health

```
build → promote → deploy-infra → verify → e2e → promote-to-preview
GREEN    GREEN      AMBER          GREEN    GREEN   GREEN
```

Canary full chain GREEN. Production deployed and healthy. deploy-infra AMBER: OpenClaw healthcheck skip works but Alloy/git-sync/repo-init health gate too strict.

## Branch Model (updated 2026-04-06)

```
feat/* → canary → release/* → main (default)
deploy/canary, deploy/preview, deploy/production  (deploy state)
```

- **`main`** is the default branch (changed from `staging` on 2026-04-06)
- **`staging`** is DEPRECATED — kept temporarily for workflow_run compatibility, will be deleted
- `workflow_run` reads from `main` now
- No more cherry-pick tax between branches

## Active Blockers

| #   | Issue                                                                            | Status      | Owner | Impact                                                             |
| --- | -------------------------------------------------------------------------------- | ----------- | ----- | ------------------------------------------------------------------ |
| 1   | **Provision creates incomplete k8s secrets** — missing OAuth, Privy, connections | ❌ RED      | —     | bug.0296. Production patched manually. Provision not reproducible. |
| 2   | **LiteLLM billing callback DNS** — 0 charge_receipts everywhere                  | ❌ RED      | —     | #781 merged but needs deploy-infra success to take effect          |
| 3   | **deploy-infra health gate too strict** — Alloy/git-sync/repo-init block on exit | ❌ RED      | —     | OpenClaw skip in place, but other services still fail              |
| 4   | **SHA-pin OpenClaw images** — gateway uses `:latest`                             | ❌ RED      | —     | Violates IMAGE_IMMUTABILITY                                        |
| 5   | **160 stale branches** — 16 release/_, 19 claude/_, 7 codex/_, old feat/_        | ❌ RED      | —     | Repo hygiene. Need auto-tag+delete workflow.                       |
| 6   | **preview.cognidao.org TLS** — last cert pending                                 | ⚠️ WAITING  | —     | Self-resolves (Caddy auto-retry)                                   |
| 7   | **Argo EndpointSlice OutOfSync** — k8s metadata drift                            | ⚠️ COSMETIC | —     | `ignoreDifferences` fix needed                                     |
| 8   | **Prometheus metrics gap** — Alloy on canary only                                | ⚠️ GAP      | —     | Preview/production have no metrics scraping                        |
| 9   | **VM IPs in public repo** — EndpointSlices expose bare IPs                       | ⚠️ SECURITY | —     | bug.0295                                                           |
| 10  | **Affected-only builds** — CI rebuilds everything on every PR                    | ❌ RED      | —     | task.0260: Turborepo --affected                                    |
| 11  | **Deprecate staging branch** — no longer needed, main is default                 | ⚠️ CLEANUP  | —     | Delete after confirming no remaining references                    |

## Resolved (2026-04-06 deploy session)

| Issue                                         | Resolution                                    |
| --------------------------------------------- | --------------------------------------------- |
| Canary + preview + production VMs provisioned | 3 fresh VMs, all healthy                      |
| Pipeline never completed E2E                  | Full chain GREEN                              |
| provision Phase 7 branch bug                  | SCP from local (dev fix)                      |
| Caddyfile www redirect blocking TLS           | Removed www block                             |
| deploy-infra OpenClaw healthcheck             | Skip when not running                         |
| Scheduler-worker port mismatch                | :3100/:3300 → :3000                           |
| Legacy build-prod.yml                         | Deleted from staging+main                     |
| staging/canary workflow drift                 | Full merge via #784, #785                     |
| CI doesn't gate canary→preview                | task.0293 done                                |
| Release PR conveyor belt                      | task.0294 done                                |
| E2E as separate workflow (chaining bug)       | Collapsed into promote-and-deploy             |
| Canary reset to main                          | Force-pushed, branches aligned                |
| Default branch → main                         | Changed from staging                          |
| Production OAuth secrets missing              | Manually patched k8s secrets (bug.0296 filed) |

## Environment Status (2026-04-06 06:00 UTC)

| Check                     | Canary (84.32.109.160) | Preview (84.32.110.92) | Production (84.32.110.202) |
| ------------------------- | ---------------------- | ---------------------- | -------------------------- |
| VM + k3s + Argo CD        | ✅                     | ✅                     | ✅                         |
| All node pods Running 1/1 | ✅                     | ✅                     | ✅                         |
| Migrations completed      | ✅                     | ✅                     | ✅                         |
| NodePort /readyz 200      | ✅ (all 3)             | ✅ (all 3)             | ✅ (all 3)                 |
| Compose infra healthy     | ✅                     | ✅                     | ✅                         |
| TLS certs (HTTPS)         | ✅ (3/3)               | ⚠️ (2/3)               | ✅ (3/3)                   |
| Loki logs flowing         | ✅                     | TBD                    | TBD                        |
| Prometheus metrics        | ⚠️ canary only         | ❌ no Alloy            | ❌ no Alloy                |
| GitHub secrets set        | ✅                     | ✅                     | ✅                         |
| DNS A records correct     | ✅                     | ✅                     | ✅                         |
| Chat working              | ✅                     | ✅                     | TBD                        |
| OAuth sign-in             | TBD                    | TBD                    | ✅ (manual patch)          |
| Billing pipeline          | TBD                    | ❌ 0 receipts          | TBD                        |

## Roadmap

### Crawl (P0) — Done

| Deliverable                                                                    | Status |
| ------------------------------------------------------------------------------ | ------ |
| Canonical `pnpm packages:build` (tsup + tsc -b + validation)                   | Done   |
| Manifest-first Docker layering (app + scheduler-worker)                        | Done   |
| `check:full` local CI-parity gate                                              | Done   |
| Runtime DSN isolation (`validate-dsns.sh`)                                     | Done   |
| App to `apps/operator` workspace, flatten platform/ → infra/ + scripts/        | Done   |
| K8s overlays + Kustomize bases (node-app, scheduler-worker, sandbox)           | Done   |
| Argo CD catalog-driven ApplicationSets tracking deploy branches                | Done   |
| Deploy branch model (deploy/canary, deploy/preview, deploy/production)         | Done   |
| Multi-node CI scripts (promote-k8s-image, deploy-infra)                        | Done   |
| k3s + Argo CD bootstrap via cloud-init                                         | Done   |
| Service contract (livez, readyz, version, pino, Zod config, graceful shutdown) | Done   |
| staging-preview.yml disabled (replaced by multi-node pipeline)                 | Done   |

### Walk (P1) — DSN-Only Provisioning & Build Improvements

**Goal:** Provisioner uses DSNs instead of component vars; build-time env coupling removed.

| Deliverable                                                                     | Status      | Est | Work Item            |
| ------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Add `DATABASE_ROOT_URL` secret (admin DSN for provisioning)                     | Not Started | 1   | (create at P1 start) |
| Implement Node provisioner (`provision.ts`) parsing 3 DSNs with `URL()`         | Not Started | 2   | (create at P1 start) |
| Update `db-provision` container env: only 3 DSNs                                | Not Started | 1   | (create at P1 start) |
| Delete `APP_DB_*` usage from provisioner codepath                               | Not Started | 1   | (create at P1 start) |
| Runtime-only env validation: remove build-time env coupling                     | Not Started | 2   | (create at P1 start) |
| `check:full --only-stack` and `--verbose` CLI enhancements                      | Not Started | 2   | (create at P1 start) |
| Multi-node CI: per-node `validate:chain`, fix `COGNI_NODE_DBS` in component job | Not Started | 1   | (create at P1 start) |

### Run (P2+) — Secret Cleanup & Graph-Scoped Builds

| Deliverable                                                                | Status      | Est |
| -------------------------------------------------------------------------- | ----------- | --- |
| Delete `APP_DB_*` + `POSTGRES_ROOT_*` secrets from GitHub                  | Not Started | 2   |
| Graph-scoped builds (`pnpm deploy` for service Dockerfiles)                | Not Started | 3   |
| Test architecture: move `tests/_fakes/` and `tests/_fixtures/` out of root | Not Started | 3   |

### GitOps Foundation

| Deliverable                                               | Status      | Work Item |
| --------------------------------------------------------- | ----------- | --------- |
| OpenTofu k3s module (Cherry Servers provider)             | Done        | task.0149 |
| k3s provisioned + Argo CD installed via cloud-init        | Done        | task.0149 |
| Promotion flow: PR→overlay→Argo syncs (canary working)    | Done        | task.0149 |
| Multi-node Argo CD: catalog-driven ApplicationSets        | Done        | task.0247 |
| infra/ reorg: k8s/, provision/, catalog/                  | Done        | task.0247 |
| Storage plan: PVCs for stateful deps, backup strategy     | Not Started | —         |
| K8s API read-only service account for AI agent debugging  | Not Started | task.0187 |
| Argo CD API token for sync status / rollback by AI agents | Not Started | task.0187 |

## Constraints

- **IMAGE_IMMUTABILITY**: Tags are `{env}-{sha}-{service}` or content-addressed; never `:latest`
- **MANIFEST_DRIVEN_DEPLOY**: Promotion = overlay digest change, not rebuild
- **BUILD_ONCE_PROMOTE**: Canary builds images; preview and production promote the exact same digests
- **NO_SSH_PAST_GITOPS**: No SSH deploy after production joins promote-and-deploy chain
- **AFFECTED_ONLY_CI**: Run lint/test/build only for changed packages (target: Turborepo, task.0260)

## Dependencies

- [x] EndpointSlice IPs on deploy branches + Temporal namespace bootstrap — fixed in #774. Provision writes IPs, promote writes digests. One writer per deploy fact.
- [ ] turbo.json pipeline config (blocks affected-only CI)

## Relocated Sections

The following content was removed from this project during the 2026-04-05 stabilization cleanup. It lives in dedicated specs/projects:

- **Preview Environments** → [preview-deployments.md](../../docs/spec/preview-deployments.md)
- **Health Probe Separation** → [health-probes.md](../../docs/spec/health-probes.md)
- **Node → Operator Migration** → [node-operator-contract.md](../../docs/spec/node-operator-contract.md) (needs its own project file)
- **Scaling Infrastructure** (HPA, managed Postgres, CDN) → trigger-based, not active
- **CI Portability / Dagger** → deferred, evaluate when GitHub Actions becomes limiting
- **CI Acceleration / Turborepo** → task.0260, referenced in constraints above

## Design Notes

Content aggregated from original CI/CD roadmap docs during 2026-04-05 stabilization pass. See Relocated Sections above for pointers.

## As-Built Specs

- [ci-cd.md](../../docs/spec/ci-cd.md) — Pipeline flow, branch model, workflow inventory
- [build-architecture.md](../../docs/spec/build-architecture.md) — Build order, Docker layering
- [health-probes.md](../../docs/spec/health-probes.md) — Liveness/readiness probe separation
- [services-architecture.md](../../docs/spec/services-architecture.md) — Service structure contracts
- [database-url-alignment.md](../../docs/spec/database-url-alignment.md) — DSN source of truth
