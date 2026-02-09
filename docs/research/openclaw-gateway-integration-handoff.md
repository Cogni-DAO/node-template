---
id: openclaw-gateway-integration-handoff
type: research
title: "OpenClaw Gateway Integration: Verified Findings & Corrections for Implementation"
status: active
trust: reviewed
verified: 2026-02-09
summary: Protocol corrections, validated fixtures, and gotchas discovered during outboundHeaders patch testing. Read before implementing the gateway integration plan.
read_when: Implementing OpenClaw gateway service integration (the feature plan).
owner: derekg1729
created: 2026-02-09
tags: [sandbox, billing, openclaw, gateway]
---

# OpenClaw Gateway Integration: Verified Findings for Implementation

**Date**: 2026-02-09
**Branch**: `fix/charge-receipts`
**Patched image**: `openclaw-outbound-headers:latest` (92505cab538b)
**Prerequisite reading**: `docs/research/openclaw-gateway-header-injection.md` (validated research)

## 1. Critical Protocol Corrections (vs. the feature plan)

The feature plan has several protocol details wrong. These were discovered empirically during testing.

### A. Frame format is NOT JSON-RPC 2.0

The plan says `JSON-RPC: connect (with token if auth enabled)` and `JSON-RPC: sessions.patch(...)`.

**Wrong.** OpenClaw uses a custom frame format:

```typescript
// Request (client → server)
{ type: "req", id: "1", method: "connect", params: { ... } }

// Response (server → client)
{ type: "res", id: "1", ok: true, payload: { ... } }
// or
{ type: "res", id: "1", ok: false, error: { code: 1001, message: "..." } }

// Server-push event
{ type: "event", event: "connect.challenge", payload: { nonce: "...", ts: 123 } }
```

### B. WS handshake is a 3-step dance, not a simple send

1. **Server** sends `{ type: "event", event: "connect.challenge", payload: { nonce, ts } }` immediately on WS open
2. **Client** must reply with a `connect` request containing full `ConnectParamsSchema`:
   ```json
   {
     "type": "req",
     "id": "1",
     "method": "connect",
     "params": {
       "minProtocol": 3,
       "maxProtocol": 3,
       "client": {
         "id": "test",
         "version": "1.0.0",
         "platform": "node",
         "mode": "backend"
       },
       "auth": { "token": "your-token" }
     }
   }
   ```
3. **Server** responds with `{ type: "res", id: "1", ok: true, payload: { type: "hello-ok", protocol: 3, ... } }`

If you send a malformed first frame (e.g. JSON-RPC format), the server closes with code 1008 "invalid request frame".

**Valid `client.id` values**: `"test"`, `"cli"`, `"gateway-client"`, `"webchat-ui"`, `"webchat"`, etc. (see `GATEWAY_CLIENT_IDS` in source)
**Valid `client.mode` values**: `"test"`, `"cli"`, `"backend"`, `"webchat"`, `"ui"`, `"node"`, `"probe"`
**Protocol version**: currently `3`

### C. `sessions.patch` parameter shape

The plan's pseudocode shows:

```typescript
sessions.patch({ sessionKey, outboundHeaders });
```

**Wrong.** The actual schema uses `key` (not `sessionKey`) and fields are at the **top level** (not nested under a `patch` object):

```json
{
  "type": "req",
  "id": "2",
  "method": "sessions.patch",
  "params": {
    "key": "agent:main:my-session",
    "outboundHeaders": { "x-litellm-end-user-id": "tenant-42" }
  }
}
```

To clear: `"outboundHeaders": null` (at top level alongside `key`).

### D. `agent` call requires `idempotencyKey`

The agent schema requires `idempotencyKey` (string). Without it, validation fails. Generate a unique one per call:

```typescript
idempotencyKey: `${runId}-${Date.now()}`;
```

## 2. Ready-to-Use Fixtures

### A. `tests/_fixtures/sandbox/openclaw-gateway-client.ts`

A working WS client implementing the correct handshake + agent + sessions.patch. This is the **test fixture** version — the production `src/adapters/server/sandbox/openclaw-gateway-client.ts` can copy the protocol logic from here.

Key methods:

- `connect({ url, token })` — full handshake with timeout
- `agent({ message, sessionKey, outboundHeaders })` — send agent call
- `sessionsPatch({ sessionKey, outboundHeaders })` — set/clear session headers
- `close()` — clean teardown

The `ws` package is now a dev dependency (added to workspace root).

### B. `tests/_fixtures/sandbox/test-gateway-outbound-headers.ts`

Standalone manual test script (runnable via `npx tsx`). Tests all 3 scenarios:

1. Basic outboundHeaders flow
2. Concurrent session isolation
3. Clear via sessions.patch(null)

All 3 pass against `openclaw-outbound-headers:latest`.

## 3. Plan Corrections & Refinements

### The plan's OpenClawGatewayClient design (step 5) needs adjustment

The plan proposes:

- `chat()` — HTTP POST to `/v1/chat/completions`
- `configureSession()` — WS `sessions.patch` to set outboundHeaders

**Issue with HTTP chat**: The HTTP `/v1/chat/completions` endpoint does NOT support `outboundHeaders`. It was NOT extended by the patch. It only reads `model`, `messages`, `stream`, `user`. So if you set outboundHeaders via WS `sessions.patch` and then call HTTP `chat`, the headers might not flow — the HTTP handler creates its own session scoping (prefixed `openai`), separate from the WS session key namespace.

**Recommendation**: Either:

1. Use WS for everything (agent call + session config) — proven to work
2. Use HTTP for chat but set outboundHeaders via the `agent` WS call (which auto-persists to session) and ensure the HTTP `user` field maps to the same session

Option 1 is simpler and verified. The test fixture implements it.

### `gateway.auth.mode: "none"` — verify this exists

The plan says `"none"` for internal network. The source code I inspected defines `ResolvedGatewayAuthMode = "token" | "password"`. The config `gateway.auth.mode` is not `"none"` in the type — it might be handled as a fallback or might cause a startup error. Our test used `"token"` auth. If deploying to sandbox-internal, token auth with a static token is still safe and simpler than debugging `"none"`.

### nginx gateway proxy — header pass-through

The plan correctly says the gateway proxy should NOT overwrite `x-litellm-end-user-id` or `x-litellm-spend-logs-metadata`. Verified: the patched OpenClaw sets these headers on outbound calls. The proxy just needs to pass them through to LiteLLM. The existing per-run proxy template DOES overwrite `x-litellm-end-user-id` (it injects billingAccountId), so the new gateway template must be different.

### `x-cogni-run-id` for audit log correlation — excellent design

The plan's idea of a dedicated `x-cogni-run-id` header for `grep`-based audit log correlation is good. The outboundHeaders patch supports arbitrary headers, so this works out of the box:

```typescript
outboundHeaders: {
  "x-litellm-end-user-id": billingAccountId,
  "x-litellm-spend-logs-metadata": JSON.stringify({ run_id: runId, graph_id: graphId }),
  "x-cogni-run-id": runId,  // for proxy log grep
}
```

## 4. Validated Merge Order (header priority)

Confirmed from source (`extra-params.ts:138`) and empirical testing:

1. `provider.headers` (static config in `openclaw.json`) — **lowest priority**
2. `session.outboundHeaders` (per-session, set via WS) — **overrides static**
3. OpenRouter attribution wrapper (if applicable)
4. Per-call `options.headers` (internal code) — **highest priority**

This means: if `openclaw.json` has `"x-litellm-end-user-id": "default"` and the session sets `"x-litellm-end-user-id": "tenant-42"`, the outbound call will have `tenant-42`. Correct behavior.

## 5. Guardrails in the Patched Image

The `validateOutboundHeaders()` function in `sessions-patch.ts` enforces:

- Must be a non-null plain object
- All values must be strings
- No CR/LF in keys or values (header injection prevention)
- Total serialized size < 8KB

These are enforced on both `agent` and `sessions.patch` calls. No need to duplicate validation in Cogni's client.

## 6. Image Tagging

| Image                              | ID             | Description                                              |
| ---------------------------------- | -------------- | -------------------------------------------------------- |
| `openclaw:local`                   | `0f9db433c74f` | Upstream unpatched v2026.2.4                             |
| `cogni-sandbox-openclaw:latest`    | `f6bff193b445` | Old sandbox image (pre-gateway, docker-exec model)       |
| `openclaw-outbound-headers:latest` | `92505cab538b` | **Validated patched image** with outboundHeaders support |

The compose service should use `openclaw-outbound-headers:latest` (or whatever GHCR tag we push it as) instead of `cogni-sandbox-openclaw:latest`.
