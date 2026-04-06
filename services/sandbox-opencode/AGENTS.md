# sandbox-opencode - AGENTS.md

> Scope: this directory only. Keep <=150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

OpenCode coding agent container for sandboxed code generation tasks. Uses `COGNI_MODEL` env var from the graph executor — no hardcoded model names.

## Architecture

```
GraphRunRequest.modelRef.modelId
  → SandboxGraphProvider sets COGNI_MODEL env var
  → entrypoint.sh starts socat bridge (localhost:8080 → unix socket → LiteLLM)
  → run.sh reads task from /workspace/.cogni/context.json or messages.json
  → run.sh generates opencode.json with local.$MODEL for all agents
  → OpenCode calls LiteLLM proxy via LOCAL_ENDPOINT env var
  → LiteLLM routes to provider (OpenRouter, Anthropic, etc.)
  → run.sh emits SandboxProgramContract JSON envelope on stdout
```

## Key Files

| File            | Purpose                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------- |
| `Dockerfile`    | Multi-stage: Go build from `golang:1.24-bookworm`, runtime on `debian:bookworm-slim`              |
| `entrypoint.sh` | Socat bridge — identical to `sandbox-runtime/entrypoint.sh`                                       |
| `run.sh`        | Reads task from `.cogni/` protocol, generates config, runs OpenCode, emits SandboxProgramContract |

## Pointers

- [sandbox-runtime entrypoint](../sandbox-runtime/entrypoint.sh): canonical socat bridge pattern
- [sandbox-runtime agent](../sandbox-runtime/agent/run.mjs): COGNI_MODEL passthrough reference

## Boundaries

```json
{
  "layer": "services",
  "may_import": ["services"],
  "must_not_import": ["app", "features", "core", "ports", "adapters"]
}
```

## Public Surface

- **Exports:** Docker image `cogni-sandbox-opencode:latest`
- **Env/Config keys:** `COGNI_MODEL` (required), `OPENAI_API_BASE`, `LITELLM_API_KEY`
- **Input protocol:** `/workspace/.cogni/context.json` → `messages.json` → `TASK` env var (fallback chain)

## Responsibilities

- This directory **does**: build the OpenCode sandbox container image
- This directory **does not**: register the container in SandboxGraphProvider (see task.0298)
- This directory **does not**: handle billing — that is LiteLLM proxy's responsibility

## Notes

- OpenCode is a Go binary from github.com/opencode-ai/opencode
- The entrypoint.sh must stay in sync with `services/sandbox-runtime/entrypoint.sh`
- Output format: SandboxProgramContract envelope (`{ payloads: [{ text }], meta: { durationMs, error } }`)
- Model config: `opencode.json` generated at runtime with `local.$COGNI_MODEL` (LOCAL_ENDPOINT discovery)
