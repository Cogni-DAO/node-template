# Node CI/CD Contract

> [!CRITICAL]
> Node sovereignty is non-negotiable. CI must run from repo with zero operator dependencies.

## Core Invariants

1. **Fork Freedom**: CI runs without secrets; CD (build/deploy) is gated and skippable on forks
2. **Policy Stays Local**: ESLint/depcruise/prettier/tsconfig never centralized
3. **Local Gate Parity**: `pnpm check` is local equivalent of CI; CI parallelizes same checks across jobs
4. **No Runtime Fetches**: Workflows never fetch config from outside repo

---

## Implementation Checklist

### P0: Document Current State (This PR)

- [x] Scan CI entrypoints and classify files
- [x] Document canonical commands (`pnpm check`, `pnpm check:full`)
- [x] Classify portable vs node-owned files
- [ ] Add to AGENTS.md pointers

### P1: In-Repo Reusable Workflow Seam

**Gate**: Only proceed if Node #2 planned within 30 days OR CI drift pain exists

- [ ] Create `.github/workflows/_rails-node-ci.yml` with `on: workflow_call`
- [ ] Move static job steps (checkout, setup-node, pnpm install, typecheck, lint)
- [ ] Move unit job steps (format, tests, coverage upload)
- [ ] Move integration job steps (test:int)
- [ ] Convert `ci.yaml` to thin caller with `uses: ./.github/workflows/_rails-node-ci.yml`
- [ ] Verify: same commands, same order, same pass/fail behavior

### P2: Jenkins Migration (Future)

**Gate**: Paid customer exists OR GitHub Actions costs become prohibitive

- [ ] Create `Jenkinsfile` declarative pipeline
- [ ] Create Jenkins shared library from `_rails-node-ci.yml` logic
- [ ] Replace GHCR with generic container registry
- [ ] Replace GitHub secrets with Vault/generic secrets manager
- [ ] Deprecate GitHub Actions workflows

### P3: External Rails Kit Repo (Future)

**Gate**: 2+ nodes exist AND workflow drift maintenance burden proven

- [ ] Extract `_rails-node-ci.yml` to `cogni-rails` repo
- [ ] Extract composite actions (`loki-ci-telemetry`, `loki-push`)
- [ ] Extract `platform/ci/scripts/` portable scripts
- [ ] Nodes pin to versioned refs
- [ ] **Do NOT extract** lint/depcruise/prettier configs

---

## File Pointers

### Workflow Entrypoints (Current)

| File                                      | Type | Secrets | Trigger               | Commands                                               |
| ----------------------------------------- | ---- | ------- | --------------------- | ------------------------------------------------------ |
| `.github/workflows/ci.yaml`               | CI   | No      | PR, push staging/main | typecheck, lint, format, test:ci, test:int, arch:check |
| `.github/workflows/build-prod.yml`        | CD   | Yes     | push main             | build.sh, test-image.sh, push.sh                       |
| `.github/workflows/staging-preview.yml`   | CD   | Yes     | push staging          | pnpm check, build.sh, deploy.sh, e2e                   |
| `.github/workflows/deploy-production.yml` | CD   | Yes     | workflow_run          | deploy.sh                                              |

### Local Gates

| Command           | Script                  | Purpose                                                                 |
| ----------------- | ----------------------- | ----------------------------------------------------------------------- |
| `pnpm check`      | `scripts/check-fast.sh` | Fast gate: typecheck + lint + format + unit/contract/meta + docs + arch |
| `pnpm check:full` | `scripts/check-full.sh` | CI parity: Docker build + stack + all test suites                       |

**Note**: `ci.yaml` runs the same checks as `pnpm check` but parallelized across jobs (static → unit/integration). Local gate runs sequentially for simplicity.

### Portable (Rails Candidates)

| Path                                 | Purpose              |
| ------------------------------------ | -------------------- |
| `.github/actions/loki-ci-telemetry/` | CI telemetry capture |
| `.github/actions/loki-push/`         | Loki push            |
| `platform/ci/scripts/build.sh`       | Docker build         |
| `platform/ci/scripts/push.sh`        | GHCR push            |
| `platform/ci/scripts/test-image.sh`  | Image liveness test  |

### Node-Owned (Never Centralize)

| Path                           | Why                         |
| ------------------------------ | --------------------------- |
| `.dependency-cruiser.cjs`      | Hex architecture boundaries |
| `eslint.config.mjs`, `eslint/` | UI/chain governance rules   |
| `biome.json`, `biome/`         | Lint rules                  |
| `.prettierrc`                  | Formatting                  |
| `tsconfig*.json`               | Path aliases                |
| `scripts/check-*.sh`           | Local gate definitions      |
| `Dockerfile`                   | Image definition            |

---

## Design Decisions

### 1. Why Jenkins Is an Option

| Concern        | GitHub Actions     | Jenkins      |
| -------------- | ------------------ | ------------ |
| OSS            | Proprietary runner | Fully OSS    |
| Self-host      | Limited            | Full control |
| Cost at scale  | Per-minute billing | Own infra    |
| Vendor lock-in | GitHub-specific    | Portable     |

**Key driver**: Dolt CI/CD (database merkle tree management) requires persistent state and complex branching that GitHub Actions can't manage. Jenkins migration is gated (P2) until Dolt integration begins.

### 2. Why In-Repo Seam First?

Extracting to external repo too early causes:

- Version pinning overhead before patterns stabilize
- False abstraction boundaries
- Reduced iteration speed

In-repo `_rails-node-ci.yml` provides seam without extraction cost.

### 3. Why Policy Stays Node-Owned?

Centralizing lint/depcruise configs causes:

- Fork friction (must accept upstream rules)
- Policy fights across nodes
- Loss of sovereignty

Rails kit provides **orchestration defaults**, not **policy mandates**.

---

**Last Updated**: 2025-12-20
**Status**: Design Approved
