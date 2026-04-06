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
build → promote → deploy-infra → verify  → e2e   → preview → release → production
GREEN    GREEN      GREEN          RED       BLOCKED  BLOCKED   BLOCKED   LEGACY
```

## Active Blockers

| #   | Issue                                                                                                   | Status         | Owner     | Impact                                                                   |
| --- | ------------------------------------------------------------------------------------------------------- | -------------- | --------- | ------------------------------------------------------------------------ |
| 1   | **Canary provision succeeded, verify RED on poly DNS** — operator healthy, poly/resy DNS not resolving  | 🔧 IN PROGRESS | Other dev | Blocks verify → E2E → everything downstream                              |
| 2   | **Preview provision triggered** — waiting for VM + bootstrap completion                                 | 🔧 IN PROGRESS | Other dev | Preview env not yet available                                            |
| 3   | **Deploy branches use PRs instead of direct commits** — unnecessary noise for machine-written state     | ❌ RED         | —         | task.0292                                                                |
| 4   | **Production rebuilds instead of promoting** — `build-prod.yml` builds fresh `prod-${SHA}` on main push | ❌ RED         | —         | Production gets different images than validated in canary/preview        |
| 5   | **CI doesn't gate canary→preview** — `e2e.yml` dispatches without checking `ci.yaml` status             | ❌ RED         | —         | task.0293                                                                |
| 6   | **Release PR conveyor belt** — auto-creates release PR on every preview E2E success                     | ❌ RED         | —         | task.0294                                                                |
| 7   | **No production promotion in pipeline** — promote-and-deploy supports it but nothing triggers it        | ❌ RED         | —         | Only legacy build-prod→deploy-production exists                          |
| 8   | **Rename staging→preview in workflows** — `staging` branch name + refs are historical artifacts         | ❌ RED         | —         | Naming confusion; `e2e.yml` lines 10, 113, 128 + `ci.yaml` push triggers |
| 9   | **SHA-pin OpenClaw images** — gateway uses `:latest`, violates IMAGE_IMMUTABILITY                       | ❌ RED         | —         | Mutable tags in production                                               |

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

- [ ] EndpointSlice IPs on deploy branches + Temporal namespace bootstrap (blocks verify → everything downstream) — other dev actively working: extracting env-endpoints.yaml, wiring ensure-temporal-namespace.sh, adding migration job wait gates
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
