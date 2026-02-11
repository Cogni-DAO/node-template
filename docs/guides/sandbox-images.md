---
id: sandbox-images-guide
type: guide
title: Sandbox Container Images
status: active
trust: reviewed
summary: How to pull, build, and push the sandbox container images used by OpenClaw agents.
read_when: Building CI/CD for sandbox images, or ad-hoc rebuilding/publishing when no CI exists yet. Most developers should just pull from GHCR.
owner: derekg1729
created: 2026-02-12
verified: 2026-02-12
tags: [sandbox, openclaw, docker]
---

# Sandbox Container Images

## For most developers: pull from GHCR

Images are published as multi-arch manifests (arm64 + amd64). Docker resolves automatically.

```bash
# The devtools runtime (what agents run in)
docker pull ghcr.io/cogni-dao/cogni-sandbox-openclaw:latest

# Seed pnpm store for offline installs
pnpm sandbox:pnpm-store:seed:from-ghcr
```

Then `pnpm dev:infra` starts the gateway with seeded store. That's it.

## Published images

| Image                         | GHCR path                                            | What it is                                                                                            |
| ----------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **openclaw-outbound-headers** | `ghcr.io/cogni-dao/openclaw-outbound-headers:latest` | Fork of OpenClaw with auth header forwarding patches. Build-time base only.                           |
| **cogni-sandbox-openclaw**    | `ghcr.io/cogni-dao/cogni-sandbox-openclaw:latest`    | Wraps the above with Cogni devtools (pnpm, git, node:22). The image agents actually run in.           |
| **pnpm-store**                | `ghcr.io/cogni-dao/node-template:pnpm-store-latest`  | Snapshot of all project dependencies for offline `pnpm install`. Also tagged `pnpm-store-{lockhash}`. |

## How each image was built and pushed

### 1. openclaw-outbound-headers

Built from the [OpenClaw repo](https://github.com/cogni-dao/openclaw), not this repo.

```bash
# From /Users/derek/dev/openclaw/
docker buildx build --platform linux/amd64,linux/arm64 \
  -t ghcr.io/cogni-dao/openclaw-outbound-headers:latest \
  --push .
```

**Rebuild when:** OpenClaw upstream changes or header-forwarding patches are updated.

### 2. cogni-sandbox-openclaw

Built from this repo. Uses `openclaw-outbound-headers` as its base layer.

```bash
# From repo root
docker buildx build --platform linux/amd64,linux/arm64 \
  -f services/sandbox-openclaw/Dockerfile \
  -t ghcr.io/cogni-dao/cogni-sandbox-openclaw:latest \
  --push .
```

**Rebuild when:** Dockerfile changes (system deps, pnpm version, entrypoint) or OpenClaw base is updated.

### 3. pnpm-store

Built from this repo. Uses `cogni-sandbox-openclaw` as its base and runs `pnpm fetch` to populate the store.

```bash
# From repo root
LOCK_HASH=$(sha256sum pnpm-lock.yaml | cut -c1-12)

docker buildx build --platform linux/amd64,linux/arm64 \
  -f services/sandbox-openclaw/Dockerfile.pnpm-store \
  -t ghcr.io/cogni-dao/node-template:pnpm-store-latest \
  -t ghcr.io/cogni-dao/node-template:pnpm-store-${LOCK_HASH} \
  --push .
```

**Rebuild when:** `pnpm-lock.yaml` changes (new/updated dependencies).

## Local dev scripts

| Command                                  | What it does                                   |
| ---------------------------------------- | ---------------------------------------------- |
| `pnpm sandbox:openclaw:docker:build`     | Build `cogni-sandbox-openclaw:latest` locally  |
| `pnpm sandbox:pnpm-store:build`          | Build pnpm-store image locally                 |
| `pnpm sandbox:pnpm-store:seed`           | Build + seed `pnpm_store` volume (one command) |
| `pnpm sandbox:pnpm-store:seed:from-ghcr` | Pull from GHCR + seed (no local build)         |

## Prerequisites

- Docker with buildx (for multi-arch builds)
- GHCR auth: `echo $CR_PAT | docker login ghcr.io -u <username> --password-stdin`
- Write access to `ghcr.io/cogni-dao/` packages

## Related

- [OpenClaw Sandbox Spec](../spec/openclaw-sandbox-spec.md) — invariants, architecture, image table
- [proj.openclaw-capabilities](../../work/projects/proj.openclaw-capabilities.md) — project roadmap
- [proj.sandboxed-agents](../../work/projects/proj.sandboxed-agents.md) — sandbox agent architecture
- [task.0031](../../work/items/task.0031.openclaw-cogni-dev-image.md) — original implementation task
- [task.0036](../../work/items/task.0036.pnpm-store-cicd.md) — CI/CD automation (replaces these manual steps)
