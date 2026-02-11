---
id: task.0031
type: task
title: "Build unified cogni-sandbox-openclaw devtools image + pnpm cache volumes"
status: Todo
priority: 0
estimate: 3
summary: Rebuild cogni-sandbox-openclaw Dockerfile as multi-stage — node:20 base with devtools (pnpm, git, socat), OpenClaw runtime rebuilt for node:20 ABI. Deps NOT baked; fast installs via pnpm-store named volume. One image for both gateway and ephemeral.
outcome: Single image with OpenClaw on node:20 + Cogni devtools. First pnpm install populates cache volume; subsequent runs complete in seconds. Gateway compose uses new image with cache volume. Ephemeral mode uses identical image + same workspace contract.
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
- OpenClaw runtime rebuilt for node:20 ABI at image build time — copy source + manifests from `openclaw:local`, then `pnpm install --frozen-lockfile` in the node:20 stage (rebuilds native modules correctly)
- System tools installed: `socat`, `git`, `jq`, `curl`
- `pnpm@9.12.2` installed (Cogni's pinned version, matches `packageManager` field)
- `sandboxer` user (uid 1001, gid 1001) preserved for sandbox adapter compatibility
- Existing `entrypoint.sh` (socat bridge) preserved — same entrypoint for both modes
- **No Cogni node_modules baked in** — deps installed at runtime via `pnpm install` using cache volume
- Compose updated: named volume `pnpm_store` mounted into gateway container for fast installs
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
  COPY --from=openclaw /app /app
  WORKDIR /app
  RUN pnpm install --frozen-lockfile     ← rebuilds native modules for node:20
  Create sandboxer user (1001:1001)
  COPY entrypoint.sh
  WORKDIR /workspace
  ENTRYPOINT sandbox-entrypoint.sh
```

### Runtime Workspace Contract

At runtime, the agent gets a **RW workspace** (either host-cloned for ephemeral, or tmpfs for gateway). To run Cogni tools:

1. **`/repo/current`** — read-only git-sync source (reference)
2. **`/workspace/`** — writable working directory
3. Agent (or entrypoint) copies/clones source into `/workspace/`, runs `pnpm install`
4. **`pnpm_store` volume** mounted at pnpm's store dir — first install populates it, subsequent installs resolve from cache (~10-30s)

### Compose Changes

```yaml
openclaw-gateway:
  image: cogni-sandbox-openclaw:latest # was: openclaw-outbound-headers:latest
  entrypoint: ["node", "/app/dist/index.js", "gateway"]
  volumes:
    - pnpm_store:/home/sandboxer/.local/share/pnpm/store # persistent cache
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

- [ ] Verify OpenClaw runtime works on node:20: build a test container with `FROM node:20-bookworm`, copy `/app` from `openclaw:local`, run `pnpm install --frozen-lockfile` to rebuild native modules, verify `node /app/dist/index.js --version` succeeds
- [ ] Rewrite `services/sandbox-openclaw/Dockerfile` as multi-stage:
  - Stage 1: `FROM openclaw:local AS openclaw`
  - Stage 2: `FROM node:20-bookworm` — install system tools, pnpm@9.12.2, copy `/app` from stage 1, `pnpm install --frozen-lockfile` in `/app`, create sandboxer user, copy entrypoint
- [ ] Update `docker-compose.dev.yml`:
  - Change `openclaw-gateway` image from `openclaw-outbound-headers:latest` to `cogni-sandbox-openclaw:latest`
  - Add `pnpm_store` named volume, mount into gateway service
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

# Verify pnpm cache volume (second install faster)
docker volume create pnpm_store_test
docker run --rm -v pnpm_store_test:/home/sandboxer/.local/share/pnpm/store cogni-sandbox-openclaw:latest sh -c "cd /tmp && pnpm init && pnpm add zod && echo 'first install done'"
docker run --rm -v pnpm_store_test:/home/sandboxer/.local/share/pnpm/store cogni-sandbox-openclaw:latest sh -c "cd /tmp && pnpm init && pnpm add zod && echo 'second install done (should be fast)'"
docker volume rm pnpm_store_test

# Gateway starts with healthcheck
pnpm sandbox:openclaw:docker:build && pnpm dev:infra

# Lint/type check pass
pnpm check
```

**Expected:** Image builds. OpenClaw reports version on node:20. pnpm, git, socat present. No baked Cogni deps. Second pnpm install is fast via cache. Gateway healthcheck passes.

## Review Checklist

- [ ] **Work Item:** task.0031 linked in PR body
- [ ] **Spec:** OPENCLAW_SANDBOX_OFF, COGNI_IS_MODEL_ROUTER, SECRETS_HOST_ONLY upheld — no secrets baked into image
- [ ] **Tests:** gateway healthcheck passes with new image, `pnpm check` passes
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
