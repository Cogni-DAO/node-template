---
id: task.0031
type: task
title: "Build unified cogni-sandbox-openclaw devtools image + pnpm cache volumes"
status: Todo
priority: 0
estimate: 3
summary: Rebuild cogni-sandbox-openclaw Dockerfile as multi-stage — node:20 base with devtools (pnpm, git, socat), OpenClaw runtime rebuilt for node:20 ABI. Deps NOT baked; fast installs via pnpm-store named volume. One image for both gateway and ephemeral.
outcome: Single image with OpenClaw on node:20 + Cogni devtools. First pnpm install populates store volume; subsequent runs are fast relink/verify with minimal downloads. Gateway compose uses new image with cache volume. Ephemeral mode uses identical image + same workspace contract.
spec_refs: openclaw-sandbox-spec, sandboxed-agents-spec
assignees: derekg1729
credit:
project: proj.openclaw-capabilities
branch:
pr:
reviewer:
created: 2026-02-11
updated: 2026-02-11
labels: [openclaw, sandbox, docker, p1]
external_refs:
---

# Build unified cogni-sandbox-openclaw devtools image + pnpm cache volumes

## Context

Today `cogni-sandbox-openclaw` is a thin layer over `openclaw:local` (node:22-bookworm) — adds socat + sandboxer user. The agent gets the Cogni repo via read-only volume mount (`repo_data:/repo:ro`) with no `node_modules`. To run `pnpm check`, `pnpm test`, or any Node tooling, the agent needs `pnpm install` at runtime (~2-5 min cold). That's unacceptable.

**Node version conflict**: OpenClaw base is `node:22-bookworm`. Cogni requires `node:20.x` (`engines` in package.json, enforced by pnpm). Copying `node_modules` from a node:22 stage is unsafe if any native deps exist (different ABI). Must rebuild OpenClaw deps on node:20 at image build time.

**Why not bake node_modules?** Cogni's dependency tree changes frequently. Baking `node_modules` into the image forces a full rebuild on every `pnpm-lock.yaml` change, makes the image huge, and still requires brittle runtime wiring (symlinking into RO mounts). Instead: ship devtools + a warm pnpm store volume. First run populates the cache; subsequent runs are fast.

## Requirements

- Single Dockerfile produces one image for **both** gateway (long-running) and ephemeral (one-shot) modes
- Image based on `node:20-bookworm` (Cogni's required engine version)
- OpenClaw runtime rebuilt for node:20 ABI at image build time — copy `/app` from `openclaw:local`, then reinstall deps in the node:20 stage (rebuilds native modules correctly). Guard: use `--frozen-lockfile` if `pnpm-lock.yaml` exists, otherwise fall back to plain `pnpm install`
- System tools installed: `socat`, `git`, `jq`, `curl`
- `pnpm@9.12.2` installed (Cogni's pinned version, matches `packageManager` field)
- `sandboxer` user (uid 1001, gid 1001) preserved for sandbox adapter compatibility
- Existing `entrypoint.sh` (socat bridge) preserved — same entrypoint for both modes
- **No Cogni node_modules baked in** — deps installed at runtime via `pnpm install` using cache volume
- Compose updated: named volume `pnpm_store` mounted at `/pnpm-store`, `PNPM_STORE_DIR=/pnpm-store` set in env
- Gateway compose service updated to use new image
- Build script: `pnpm sandbox:openclaw:docker:build` builds the unified image
- No secrets in image (SECRETS_HOST_ONLY upheld)

## Design

### Image Layout

```
/app/                          ← OpenClaw runtime (rebuilt on node:20)
/app/dist/                     ← Compiled OpenClaw JS (copied from openclaw:local)
/app/node_modules/             ← OpenClaw deps (rebuilt for node:20 ABI)
/app/package.json              ← OpenClaw manifest
/usr/local/bin/sandbox-entrypoint.sh  ← socat bridge entrypoint
/workspace/                    ← Agent working directory (empty at build)
```

No `/opt/cogni/`. No baked Cogni deps. The image is a **devtools runtime** — node:20 + pnpm + git + OpenClaw.

### Dockerfile Strategy (Multi-Stage)

```
Stage 1 — FROM openclaw:local AS openclaw
  (source of /app — dist, package.json, pnpm-lock.yaml, patches, etc.)

Stage 2 — FROM node:20-bookworm
  Install system deps: socat, git, jq, curl
  Enable corepack, prepare pnpm@9.12.2
  ENV PNPM_STORE_DIR=/pnpm-store
  COPY --from=openclaw /app /app
  WORKDIR /app
  # Rebuild OpenClaw deps for node:20 ABI.
  # Guard: if pnpm-lock.yaml exists, use --frozen-lockfile;
  # otherwise fall back to plain pnpm install (OpenClaw may use
  # a different lockfile name or install method).
  RUN if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile; \
      else pnpm install; fi
  Create sandboxer user (1001:1001)
  RUN mkdir -p /pnpm-store && chown sandboxer:sandbox /pnpm-store
  COPY entrypoint.sh
  WORKDIR /workspace
  ENTRYPOINT sandbox-entrypoint.sh
```

### Runtime Workspace Contract

The image is **orchestration-agnostic** — it does not assume how the workspace is populated. That's the provider's job (task.0022 for git relay, gateway runner for chat mode). The image provides:

1. **`/workspace/`** — empty writable working directory (populated at runtime by provider)
2. **`/pnpm-store/`** — mount point for pnpm store named volume (`PNPM_STORE_DIR=/pnpm-store`)
3. **Devtools** — `pnpm`, `git`, `node`, `socat` available on PATH

The provider (not the image) is responsible for cloning/copying source into `/workspace/` and running `pnpm install`. The pnpm store volume ensures first install populates the cache; subsequent installs are fast relink/verify with minimal downloads.

### Compose Changes

```yaml
openclaw-gateway:
  image: cogni-sandbox-openclaw:latest # was: openclaw-outbound-headers:latest
  entrypoint: ["node", "/app/dist/index.js", "gateway"]
  environment:
    - PNPM_STORE_DIR=/pnpm-store
  volumes:
    - pnpm_store:/pnpm-store # persistent pnpm content-addressable store
    # ... existing volumes unchanged
```

New named volume:

```yaml
volumes:
  pnpm_store:
    name: pnpm_store
```

## Allowed Changes

- `services/sandbox-openclaw/Dockerfile` — rewrite as multi-stage (node:20 base + openclaw:local source)
- `services/sandbox-openclaw/entrypoint.sh` — minor updates if needed (e.g., pnpm store path env)
- `platform/infra/services/runtime/docker-compose.dev.yml` — update `openclaw-gateway` image + add `pnpm_store` volume
- `platform/infra/services/runtime/docker-compose.yml` — update production gateway image reference
- `package.json` — add/update `sandbox:openclaw:docker:build` script

## Plan

- [ ] Verify OpenClaw runtime works on node:20: build a test container with `FROM node:20-bookworm`, copy `/app` from `openclaw:local`, reinstall deps (guarded: `--frozen-lockfile` if lockfile exists, else plain install), verify `node /app/dist/index.js --version` succeeds
- [ ] Rewrite `services/sandbox-openclaw/Dockerfile` as multi-stage:
  - Stage 1: `FROM openclaw:local AS openclaw`
  - Stage 2: `FROM node:20-bookworm` — install system tools, pnpm@9.12.2, `ENV PNPM_STORE_DIR=/pnpm-store`, copy `/app` from stage 1, guarded reinstall in `/app`, create sandboxer user + `/pnpm-store` dir, copy entrypoint
- [ ] Update `docker-compose.dev.yml`:
  - Change `openclaw-gateway` image from `openclaw-outbound-headers:latest` to `cogni-sandbox-openclaw:latest`
  - Add `pnpm_store` named volume mounted at `/pnpm-store`
  - Add `PNPM_STORE_DIR=/pnpm-store` to environment
  - Keep existing entrypoint override for gateway mode
- [ ] Add `sandbox:openclaw:docker:build` script to root `package.json` (build context = repo root to allow future Cogni manifest copying if needed, Dockerfile = `services/sandbox-openclaw/Dockerfile`)
- [ ] Verify gateway mode: `pnpm sandbox:openclaw:docker:build && pnpm dev:infra` — gateway starts, healthcheck passes
- [ ] Verify ephemeral mode: existing sandbox integration tests still pass (same image, same entrypoint)
- [ ] Verify devtools: `docker run --rm cogni-sandbox-openclaw:latest pnpm --version && git --version && socat -V`
- [ ] Verify pnpm cache volume: run `pnpm install` inside container twice — second run significantly faster

## Non-Goals

- Baking Cogni node_modules or packages:build output into the image (explicitly rejected — use cache volumes)
- Git relay wiring (task.0022)
- Runtime workspace orchestration (clone, worktree, symlink) — that's provider-level, not image-level
- Image size optimization beyond what multi-stage naturally provides
- Rebuilding OpenClaw from source — use pre-built `/app/dist` from `openclaw:local`, only rebuild `node_modules`
- Updating production compose (`docker-compose.yml`) to use the new image for GHCR-published gateway — defer until the image is published to a registry

## Validation

**Command:**

```bash
# Build the image
pnpm sandbox:openclaw:docker:build

# Verify OpenClaw works on node:20
docker run --rm cogni-sandbox-openclaw:latest node /app/dist/index.js --version

# Verify devtools
docker run --rm cogni-sandbox-openclaw:latest pnpm --version
docker run --rm cogni-sandbox-openclaw:latest git --version
docker run --rm cogni-sandbox-openclaw:latest socat -V 2>&1 | head -1

# Verify no Cogni deps baked in
docker run --rm cogni-sandbox-openclaw:latest test -d /opt/cogni && echo "FAIL: baked deps" || echo "PASS"

# Verify pnpm store volume (second install relinks from cache)
docker volume create pnpm_store_test
docker volume create workspace_test
# First run: cold install populates store
docker run --rm \
  -v pnpm_store_test:/pnpm-store \
  -v workspace_test:/workspace \
  -e PNPM_STORE_DIR=/pnpm-store \
  cogni-sandbox-openclaw:latest \
  sh -c "cd /workspace && pnpm init && pnpm add zod && echo 'first install done'"
# Second run: same workspace + store — should be fast relink
docker run --rm \
  -v pnpm_store_test:/pnpm-store \
  -v workspace_test:/workspace \
  -e PNPM_STORE_DIR=/pnpm-store \
  cogni-sandbox-openclaw:latest \
  sh -c "cd /workspace && pnpm install && echo 'second install done (fast relink)'"
docker volume rm pnpm_store_test workspace_test

# Gateway starts with healthcheck
pnpm sandbox:openclaw:docker:build && pnpm dev:infra

# Lint/type check pass
pnpm check
```

**Expected:** Image builds. OpenClaw reports version on node:20. pnpm, git, socat present. No baked Cogni deps. Second pnpm install is fast relink from store. Gateway healthcheck passes.

## Review Checklist

- [ ] **Work Item:** task.0031 linked in PR body
- [ ] **Spec:** OPENCLAW_SANDBOX_OFF, COGNI_IS_MODEL_ROUTER, SECRETS_HOST_ONLY upheld — no secrets baked into image
- [ ] **Tests:** gateway healthcheck passes with new image, `pnpm check` passes
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
