---
id: bug.0010
type: bug
title: "OpenClaw gateway HTTP endpoint ignores model field from request — always uses agent default"
status: Backlog
priority: 1
estimate: 1
summary: The gateway's /v1/chat/completions HTTP endpoint ignores the `model` field in the incoming request body and always uses the agent's configured default model from openclaw-gateway.json. This prevents dynamic model selection from our graph executor.
outcome: Graph executor can specify model per-request through the gateway, or we have a documented workaround
spec_refs:
  - openclaw-sandbox-spec
project: proj.openclaw-capabilities
branch: feat/concurrent-openclaw
pr:
reviewer:
created: 2026-02-09
updated: 2026-02-09
labels: [openclaw, gateway, model-routing]
external_refs:
assignees: derekg1729
credit:
---

# OpenClaw gateway HTTP endpoint ignores model field from request

## Observed

Sending `"model":"cogni/nemotron-nano-30b"` in the HTTP request body while the agent config has `"primary": "cogni/test-model"` results in the request being sent to `test-model` (which returned a LiteLLM 400 error naming `test-model`).

The gateway's chat completions endpoint uses the agent's default model, not the model from the request.

## Expected

Either:

- The `model` field in the request body overrides the agent default (like a standard OpenAI-compat endpoint)
- Or we have a mechanism to specify model per-request (WS `agent` command params, session config, etc.)

## Impact

Our graph executor (`SandboxGraphProvider`) needs to route to different models based on the graph configuration. Currently the only way to change models is to modify `openclaw-gateway.json` and restart the container.

## Investigation needed

- [ ] Check if the WS `agent` request method accepts a `model` param that overrides the default
- [ ] Check if `sessions.patch` can set a per-session model override
- [ ] Check OpenClaw docs/source for dynamic model selection in gateway mode
- [ ] If no override exists: evaluate whether multiple agents (one per model) is a viable workaround

## Validation

Send a request with a model override and confirm the gateway uses the requested model, not the agent default.

## PR / Links

- Related: task.0008
- Project: [proj.openclaw-capabilities](../projects/proj.openclaw-capabilities.md)
- Config: `services/sandbox-openclaw/openclaw-gateway.json`
