---
id: bug.0009
type: bug
title: "Mock-LLM SSE streaming incompatible with OpenClaw pi-ai parser — gateway returns empty payloads"
status: In Progress
priority: 1
estimate: 1
summary: Mock-LLM's SSE streaming format causes pi-ai's for-await loop to produce zero iterations inside OpenClaw's embedded agent runtime. Real models (nemotron-nano-30b via OpenRouter) work perfectly. Blocks stack tests that depend on mock-llm.
outcome: Stack tests pass with mock-llm, or tests are reconfigured to use a real model for gateway E2E
spec_refs:
  - openclaw-sandbox-spec
project: proj.openclaw-capabilities
branch: feat/concurrent-openclaw
pr:
reviewer:
created: 2026-02-09
updated: 2026-02-09
labels: [openclaw, mock-llm, testing]
external_refs:
  - "OpenClaw image: openclaw-outbound-headers:latest (v2026.2.6-3)"
assignees: derekg1729
credit:
---

# Mock-LLM SSE streaming incompatible with OpenClaw pi-ai parser

## Root Cause (proven)

**Not an OpenClaw bug.** The full gateway pipeline works with real models. The issue is mock-llm's SSE streaming format.

### Diagnostic Matrix (OPENCLAW_RAW_STREAM=1)

| Backend                      | PI_RAW_STREAM                            | OPENCLAW_RAW_STREAM                                                               | Session Transcript                       | HTTP Response                  |
| ---------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------ |
| **mock-llm**                 | FILE NOT FOUND (env var is pi-mono only) | 1 event: `assistant_message_end`, `rawText:""`                                    | `content:[]`, `usage:{input:0,output:0}` | `"No response from OpenClaw."` |
| **nemotron-nano-30b** (real) | FILE NOT FOUND (same)                    | 38 `text_delta` events + `text_end` + `assistant_message_end` with full `rawText` | Full content + thinking                  | Real markdown content          |

### What this tells us

1. **OpenClaw v2026.2.6-3 pipeline is correct** — streaming works end-to-end with real models
2. **nginx proxy is correct** — same proxy chain, works with real models
3. **WS client + billing are correct** — proven separately, and now gateway content works too
4. **mock-llm's SSE format** causes pi-ai's embedded streaming loop (`for await` over OpenAI SDK chunks) to exit immediately with zero iterations
5. Non-streaming error responses (400 from LiteLLM) DO come through as content — confirming the content pipeline works; only streaming is affected

### Previous hypothesis (disproven)

The original bug title blamed OpenClaw v2026.2.4. We rebuilt to v2026.2.6-3 — same behavior with mock-llm, works with real models. The version was never the issue.

### Standalone SDK tests were misleading

Tests #1-4 (OpenAI SDK + pi-ai `streamSimple` from inside container) all worked with mock-llm. But those tests constructed the SDK client and model context manually. The embedded agent runtime constructs them differently, and something about that construction + mock-llm's SSE format = zero stream iterations.

## Reproduction

```bash
# Fails (mock-llm backend):
# Config: "model": { "primary": "cogni/test-model" }
curl -s http://127.0.0.1:3333/v1/chat/completions \
  -H "Authorization: Bearer openclaw-internal-token" \
  -H "Content-Type: application/json" \
  -d '{"model":"cogni/test-model","messages":[{"role":"user","content":"Say hello"}]}'
# Returns: "No response from OpenClaw."

# Works (real model backend):
# Config: "model": { "primary": "cogni/nemotron-nano-30b" }
curl -s http://127.0.0.1:3333/v1/chat/completions \
  -H "Authorization: Bearer openclaw-internal-token" \
  -H "Content-Type: application/json" \
  -d '{"model":"cogni/nemotron-nano-30b","messages":[{"role":"user","content":"Say hello"}]}'
# Returns: real content with streaming deltas
```

## Impact

**Testing-only blocker.** Real models work. Stack tests that use mock-llm for gateway content assertions will fail. Options:

- Fix mock-llm SSE format to be compatible with pi-ai's parser
- Use a real (free) model for gateway stack tests
- Assert protocol flow only (event types, billing) and skip content assertions for mock-llm

## Plan

- [x] Add `OPENCLAW_RAW_STREAM=1` to compose, run diagnostic matrix
- [x] Confirm PI_RAW_STREAM is pi-mono only (not applicable to embedded)
- [x] Rebuild OpenClaw to v2026.2.6-3 — same result (disproves version theory)
- [x] Test with real model (nemotron-nano-30b) — **works perfectly**
- [ ] Investigate mock-llm SSE format vs what pi-ai expects (chunk structure, headers, etc.)
- [ ] Fix mock-llm or reconfigure stack tests

## Validation

```bash
# With real model configured, gateway returns content:
curl -s http://127.0.0.1:3333/v1/chat/completions \
  -H "Authorization: Bearer openclaw-internal-token" \
  -H "Content-Type: application/json" \
  -d '{"model":"cogni/nemotron-nano-30b","messages":[{"role":"user","content":"Say hello"}]}'
# Expected: choices[0].message.content contains real text
```

## PR / Links

- Blocks: task.0008 (stack test content assertions only)
- Project: [proj.openclaw-capabilities](../projects/proj.openclaw-capabilities.md)
- Diagnostic env vars in compose: `OPENCLAW_RAW_STREAM=1`, `OPENCLAW_RAW_STREAM_PATH=/tmp/openclaw-raw-stream.jsonl`

## Attribution

- Investigation: AI-assisted raw stream diagnostic (OPENCLAW_RAW_STREAM matrix)
