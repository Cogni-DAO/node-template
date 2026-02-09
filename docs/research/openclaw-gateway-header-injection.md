---
id: openclaw-gateway-header-injection
type: research
title: "OpenClaw Gateway: Per-Session Outbound Header Injection (for Cogni + LiteLLM Billing)"
status: draft
trust: draft
summary: Investigation into OpenClaw's ability to forward per-session billing headers to LiteLLM, current limitations, and proposed patch design.
read_when: Working on OpenClaw gateway integration, sandbox billing, or multi-tenant LLM proxy attribution.
owner: derekg1729
created: 2026-02-08
tags: [sandbox, billing, openclaw]
---

# OpenClaw Gateway: Per-Session Outbound Header Injection (for Cogni + LiteLLM Billing)

**Date**: 2026-02-08
**Branch**: `fix/charge-receipts`
**OpenClaw image**: `cogni-sandbox-openclaw:latest` (based on `openclaw:local`, pi-ai OpenAI/JS 6.10.0)

## 1. What we're trying to do

Cogni wants to run one long-running OpenClaw gateway container (warm, low-latency) that can serve multiple concurrent users/sessions.

Cogni's runtime/billing requires that every outbound LLM call from OpenClaw to LiteLLM includes session-specific attribution so spend logs can be reconciled per billing account. Concretely, Cogni needs to set, per session:

- `x-litellm-end-user-id` — billing account / tenant identity
- `x-litellm-spend-logs-metadata` — JSON metadata (runId, graphId, etc.)

Without those headers, LiteLLM spend logs and Cogni charge receipts can't be correctly attributed per user/tenant when multiple users share the same long-running gateway.

## 2. Limitations found (current OpenClaw behavior)

### A. No per-request header overrides via Gateway protocols

- **HTTP** OpenAI-compatible endpoint (`/v1/chat/completions` in `openai-http.ts`) accepts standard OpenAI fields only (`model`/`messages`/`stream`/`user`). There is no request field to provide headers or provider overrides.
- **WebSocket** protocol (`AgentParamsSchema`) is also closed (`additionalProperties: false`) and has no header/provider override fields.
- `agentCommand()` / `AgentCommandOpts` has no parameter for per-request headers.

**Result**: the gateway cannot accept "billing headers" from Cogni per request today.

### B. Provider/model overrides exist but don't solve dynamic multi-user billing

- `SessionEntry` supports `providerOverride` and `modelOverride`.
- This can route a session to a different provider config that contains static headers (e.g., a provider named `billing-user-123` with `headers: { "x-litellm-end-user-id": "user-123" }`).
- **But**: this requires predefining a provider per billing identity in `openclaw.json`. That does not scale for dynamic users/tenants.

### C. Where headers can be injected today (and why it's insufficient)

Verified header chain:

```
openclaw.json → models.providers.<name>.headers (static)
    ↓
pi-ai ModelDefinition.headers
    ↓
openai-completions.js createClient():
    const headers = { ...model.headers };           // line 289
    Object.assign(headers, optionsHeaders);          // line 315 (call-time overrides win)
    new OpenAI({ defaultHeaders: headers });         // line 321
    ↓
Every outbound request includes these headers
```

There is already a call-time injection seam: `options.headers` overrides. It's used today by the OpenRouter attribution wrapper in `extra-params.ts`, but it is not exposed to gateway clients and not session-configurable.

**Empirical verification**: we ran an echo server inside the container, set `models.providers.echotest.headers` in config, and confirmed all three custom headers (`x-cogni-trace`, `x-litellm-end-user-id`, `x-custom-passthrough`) arrived on the outbound HTTP request to the echo server.

### D. Concurrency + static config is a race condition

If we try to implement dynamic billing by rewriting `openclaw.json` per request/session, concurrent requests will clobber each other. `loadConfig()` reads from disk for each command, so writes race under concurrency.

### E. Header name correctness (LiteLLM)

LiteLLM header for metadata is `x-litellm-spend-logs-metadata` (NOT `x-litellm-metadata`). Our current nginx proxy template already uses the correct name.

### Summary table

| Scenario                                                      | Works?                          |
| ------------------------------------------------------------- | ------------------------------- |
| Static provider headers in config                             | Yes (verified empirically)      |
| Per-request headers via gateway HTTP                          | No — not in protocol            |
| Per-request headers via gateway WS                            | No — not in protocol            |
| Per-session provider switch to different static headers       | Yes, but doesn't scale          |
| Concurrent different billing headers, single OpenClaw process | No — requires external injector |

## 3. Proposed OpenClaw patch: per-session outbound header overrides

### Goal

Add a generic, per-session outbound header override mechanism, so Cogni can set billing headers once per session and OpenClaw will apply them to all outbound LiteLLM calls for that session.

### Patch principles

- **Generic**: OpenClaw should not hardcode LiteLLM concepts. It should support `outboundHeaders` as a generic mechanism.
- **Session-scoped**: headers are stored on `SessionEntry` and applied to all outbound calls for that session.
- **Call-time injection**: merge into `options.headers` at the existing seam so it is guaranteed to be applied per request without rewriting config.

### Proposed API surface

**`sessions.patch`** (required):

- Add `outboundHeaders` as settable session state.
- Allow `null` to clear.

**`agent` + `chat.send`** (optional but recommended):

- Accept `outboundHeaders` on these calls too, and persist to the session (convenience + reduces client choreography).

### Data model changes

`SessionEntry` gains:

```typescript
outboundHeaders?: Record<string, string>
```

### Runtime plumbing changes

At the point where OpenClaw builds the outbound OpenAI/LiteLLM client call:

1. Read `providerConfig.headers` (static)
2. Read `sessionEntry.outboundHeaders` (dynamic)
3. Merge them and inject via call-time `options.headers` (so call-time always wins)

Merge order (lowest to highest priority):

1. `provider.headers` (static config)
2. `session.outboundHeaders` (per session)
3. Existing OpenRouter attribution wrapper (if applicable)
4. Per-call `options.headers` (if any exist in internal code)

### Guardrails (even for MVP)

- Reject CR/LF in header values (prevent header injection)
- Trim values
- Cap total size (e.g., 8KB serialized) to prevent bloating session storage / request abuse
- Allowlist keys or prefix-based allowlist (team decision)

### Verification plan (must be E2E)

1. Create two sessions concurrently:
   - Session A: `outboundHeaders` includes `x-litellm-end-user-id: A`
   - Session B: `outboundHeaders` includes `x-litellm-end-user-id: B`
2. Run both concurrently through the gateway.
3. Verify via LiteLLM spend logs or an echo server in place of LiteLLM that outbound requests include the correct per-session headers without cross-contamination.

## Appendix: Key source locations (inside `cogni-sandbox-openclaw:latest`)

| Component                                 | Path                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------- |
| OpenAI HTTP handler                       | `/app/src/gateway/openai-http.ts`                                            |
| Gateway protocol schema                   | `/app/src/gateway/protocol/schema/agent.ts`                                  |
| Agent command types                       | `/app/src/commands/agent/types.ts`                                           |
| Agent command (model override resolution) | `/app/src/commands/agent.ts`                                                 |
| Model config types (headers field)        | `/app/src/config/types.models.ts`                                            |
| Model resolution for pi-ai                | `/app/src/agents/pi-embedded-runner/model.ts`                                |
| Extra params / call-time header wrapper   | `/app/src/agents/pi-embedded-runner/extra-params.ts`                         |
| pi-ai OpenAI completions provider         | `/app/node_modules/@mariozechner/pi-ai/dist/providers/openai-completions.js` |
| pi-ai types (ModelDefinition.headers)     | `/app/node_modules/@mariozechner/pi-ai/dist/types.d.ts`                      |

## 4. Gateway API Reference (from source inspection of `cogni-sandbox-openclaw:latest`)

### Two interfaces, same port

OpenClaw gateway exposes both HTTP and WebSocket on the same port (default 3000).

#### HTTP — OpenAI-compatible endpoint

**Endpoint**: `POST /v1/chat/completions`

Standard OpenAI chat completion request body:

```json
{
  "model": "echo-test",
  "messages": [
    { "role": "system", "content": "You are helpful." },
    { "role": "user", "content": "Hello" }
  ],
  "stream": false,
  "user": "optional-user-id"
}
```

- Auth: `Authorization: Bearer <token>` (same token as WS `connect`)
- `user` field maps to session key scoping (prefix `openai`)
- `model` field can route to different agents via `resolveAgentIdForRequest`
- Supports streaming (SSE) and non-streaming
- **No extension fields** — the handler only reads `model`, `messages`, `stream`, `user`
- Source: `/app/src/gateway/openai-http.ts`

#### WebSocket — full protocol

- JSON-RPC 2.0 framing: `{ "jsonrpc": "2.0", "id": "...", "method": "...", "params": {...} }`
- First call must be `connect` with `{ token, password }` for auth
- Source: `/app/src/gateway/protocol/schema/agent.ts`

### Key WS methods

#### `agent` — run an agent

```json
{
  "message": "say hello",
  "agentId": "main",
  "sessionKey": "agent:main:my-session",
  "thinking": "medium",
  "extraSystemPrompt": "optional extra context",
  "deliver": false,
  "idempotencyKey": "uuid-here",
  "timeout": 30000,
  "lane": "optional-lane",
  "label": "optional-label"
}
```

Full schema fields: `message` (required), `agentId`, `to`, `replyTo`, `sessionId`, `sessionKey`, `thinking`, `deliver`, `attachments`, `channel`, `replyChannel`, `accountId`, `replyAccountId`, `threadId`, `groupId`, `groupChannel`, `groupSpace`, `timeout`, `lane`, `extraSystemPrompt`, `idempotencyKey` (required), `label`, `spawnedBy`.

**`additionalProperties: false`** — no extra fields accepted today. This is why the patch is needed.

#### `sessions.patch` — modify session state

Exists today for model/thinking overrides. The patch would extend this to accept `outboundHeaders`.

#### `chat.send` — delivery-oriented message path

Alternative to `agent`, used for outbound message delivery.

### Session model

- Sessions keyed by string: `"agent:<agentId>:<sessionName>"` (e.g. `"agent:main:billing-user-42"`)
- `SessionEntry` stores: `providerOverride`, `modelOverride`, `thinkingLevel`, `authProfileOverride`, `spawnedBy`, etc.
- Sessions are **sticky** — state persists across calls within the same key
- The `user` field on the HTTP endpoint maps to session scoping (prefixed `openai`)

### Agent execution flow (request → outbound LLM call)

```
gateway request (HTTP or WS)
  → agentCommand(opts: AgentCommandOpts)
    → resolveConfiguredModelRef()       // picks provider/model from config or session override
    → runWithModelFallback()
      → runEmbeddedPiAgent()            // for LLM providers (not CLI backends)
        → pi-ai streamSimple(model, context, options)
          → openai-completions.js createClient(model, context, apiKey, options.headers)
            → new OpenAI({
                baseURL: model.baseUrl,
                defaultHeaders: { ...model.headers, ...options.headers }
              })
```

### Where headers enter the outbound HTTP request

Three layers, merged lowest → highest priority:

1. **`model.headers`** — static, from `openclaw.json` `models.providers.<name>.headers`
2. **`options.headers`** — call-time, from `streamFn` wrappers (today only used for OpenRouter attribution in `extra-params.ts`)
3. **OpenAI SDK built-ins** — `Authorization`, `User-Agent`, `x-stainless-*`

### What exists vs. what the patch needs to add

| Exists today                                         | Patch must add                                         |
| ---------------------------------------------------- | ------------------------------------------------------ |
| `models.providers.<name>.headers` (static config)    | `SessionEntry.outboundHeaders` (per-session, dynamic)  |
| `SessionEntry.providerOverride` / `modelOverride`    | `sessions.patch` accepting `outboundHeaders`           |
| `options.headers` seam in `streamFn` wrapper pattern | Plumbing from session → `options.headers` at call-time |
| `AgentParamsSchema` (closed, no extra fields)        | Extend schema or use `sessions.patch` pre-call         |

### Config shape (for pointing gateway at Cogni's LLM proxy)

```json
{
  "models": {
    "mode": "replace",
    "providers": {
      "cogni": {
        "baseUrl": "http://litellm:4000/v1",
        "api": "openai-completions",
        "apiKey": "sk-...",
        "headers": { "x-static-header": "value" },
        "models": [{ "id": "model-name", "name": "Model Name" }]
      }
    }
  },
  "agents": {
    "defaults": { "model": { "primary": "cogni/model-name" } },
    "list": [{ "id": "main", "default": true }]
  },
  "gateway": { "mode": "local" }
}
```

### Gateway startup

```bash
node /app/openclaw.mjs gateway          # or via dist/index.js
```

Listens on port 3000 by default (HTTP + WS upgrade on same port).

### Auth

- `authorizeGatewayConnect` in `/app/src/gateway/auth.ts`
- Bearer token on HTTP, `{ token }` on WS `connect`
- Supports `x-forwarded-for` / `x-forwarded-proto` for proxied setups
- Config: `gateway.auth` in `openclaw.json` (mode options include `"none"` for dev)
