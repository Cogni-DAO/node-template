# services/sandbox-aider · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

POC container for running aider as a headless coding agent in the Cogni sandbox. Uses the standard socat bridge pattern for LLM proxy access via LiteLLM.

## Pointers

- [Sandbox Spec](../../docs/spec/sandboxed-agents.md)
- [Sandbox Runtime (reference)](../sandbox-runtime/)
- [Sandbox OpenClaw (reference)](../sandbox-openclaw/)

## Boundaries

```json
{
  "layer": "services",
  "may_import": ["services"],
  "must_not_import": ["app", "features", "core", "ports", "adapters"]
}
```

## Public Surface

- **Exports:** Docker image `cogni-sandbox-aider:latest`
- **Env/Config keys (runtime):** `AIDER_MODEL`, `LITELLM_API_KEY`, `TASK`, `LLM_PROXY_SOCKET`, `LLM_PROXY_PORT`
- **Files considered API:** Dockerfile, entrypoint.sh, run.sh

## Responsibilities

- This directory **does**: Build an aider-based sandbox image with socat bridge; provide headless task execution via run.sh
- This directory **does not**: Manage container lifecycle; contain secrets; integrate with the app's sandbox adapter

## Usage

```bash
# Build image
docker build -t cogni-sandbox-aider:latest services/sandbox-aider/

# Run with task file
docker run --rm -v /path/to/workspace:/workspace cogni-sandbox-aider:latest

# Run with task env var
docker run --rm -e TASK="Add a docstring to main.py" cogni-sandbox-aider:latest
```

## Standards

- Entrypoint: `sandbox-entrypoint.sh` (socat bridge + `bash -lc`)
- Non-root: sandboxer user (uid 1001, gid 1001)
- Socket mount at `/llm-sock` (same convention as sandbox-runtime)
- Task input: `/workspace/task.md` file or `TASK` env var

## Dependencies

- **Internal:** none (image-only, no src/ imports)
- **External:** Docker, `paulgauthier/aider:latest` base image

## Change Protocol

- Update this file when **Dockerfile** or **entrypoint.sh** changes
- Rebuild image and verify: `docker build -t cogni-sandbox-aider:latest services/sandbox-aider/`
