# services/sandbox-openclaw · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Last reviewed:** 2026-02-12
- **Status:** draft

## Purpose

Multi-stage devtools image for running OpenClaw in Cogni. One image for both gateway (long-running) and ephemeral (one-shot) modes. Adds pnpm, git, socat, and the sandbox entrypoint onto a published GHCR OpenClaw base with header-forwarding.

## Pointers

- [OpenClaw Sandbox Spec](../../docs/spec/openclaw-sandbox-spec.md) — invariants 26 (IMAGE_FROM_PUBLISHED_BASE), 27 (COMPOSE_IMAGE_PARITY)
- [Sandbox Spec](../../docs/spec/sandboxed-agents.md)
- [Sandbox Runtime (reference)](../sandbox-runtime/)
- [Sandbox Adapter](../../src/adapters/server/sandbox/)

## Boundaries

```json
{
  "layer": "services",
  "may_import": ["services"],
  "must_not_import": ["app", "features", "core", "ports", "adapters"]
}
```

## Public Surface

- **Exports:** Docker image `cogni-sandbox-openclaw:latest` (`ghcr.io/cogni-dao/cogni-sandbox-openclaw:latest`)
- **Routes:** none
- **CLI:** `pnpm sandbox:openclaw:docker:build` (build context = repo root)
- **Env/Config keys (runtime):** `PNPM_STORE_DIR`, `HOME`, `COREPACK_HOME`, `LLM_PROXY_SOCKET`, `LLM_PROXY_PORT`, `OPENCLAW_CONFIG_PATH`, `OPENCLAW_STATE_DIR`, `OPENCLAW_LOAD_SHELL_ENV`
- **Files considered API:** Dockerfile, entrypoint.sh, openclaw-gateway.json

## Responsibilities

- This directory **does**: Multi-stage build (GHCR OpenClaw base → node:22-bookworm + devtools); provide pnpm, git, socat, jq, curl; create sandboxer user; set up pnpm store mount point
- This directory **does not**: Build or maintain OpenClaw itself; bake Cogni node_modules; contain secrets; manage container lifecycle

## Usage

```bash
# Build (pulls GHCR base by default)
pnpm sandbox:openclaw:docker:build

# Build with local override (arm64 dev)
docker build -f services/sandbox-openclaw/Dockerfile \
  --build-arg OPENCLAW_BASE=openclaw:local \
  -t cogni-sandbox-openclaw:latest .

# Verify devtools
docker run --rm cogni-sandbox-openclaw:latest "pnpm --version && git --version && node --version"
```

## Standards

- Base image: GHCR `openclaw-outbound-headers` (header-forwarding fork) — never `openclaw:local` in published images (invariant 26)
- Parameterized via `ARG OPENCLAW_BASE` for per-arch override
- Entrypoint: `sandbox-entrypoint.sh` (socat bridge + `bash -lc`)
- Non-root: sandboxer user (uid 1001, gid 1001)
- pnpm store: `PNPM_STORE_DIR=/pnpm-store`, mount `pnpm_store` named volume
- No Cogni node_modules baked in — deps installed at runtime via cache volume
- Socket mount at `/llm-sock` (same convention as sandbox-runtime)

## Dependencies

- **Internal:** none (image-only, no src/ imports)
- **External:** Docker, GHCR OpenClaw base image, node:22-bookworm

## Change Protocol

- Update this file when **Dockerfile** or **entrypoint.sh** changes
- Bump **Last reviewed** date
- Rebuild image and verify: `pnpm sandbox:openclaw:docker:build`

## Notes

- `entrypoint.sh` is copied from `sandbox-runtime/` (not symlinked) for build context isolation
- Build context is repo root (not service dir) — COPY paths are relative to repo root
- `openclaw-gateway.json` is the gateway agent config — bind-mounted into compose, not baked into image
- Gateway mode overrides entrypoint to `["node", "/app/dist/index.js", "gateway"]` — devtools unused but present
