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

---

<stuck>
Status Summary                                                                                                                                           
                                                                   ────────────────────────────────────────────────                                    
  ──                                                                                                                                                       
    Done                                                                                                                                                   
                                                                                                                                                           
                                                                                                                                                           
                                                                                                                                                           
    1. Diagnostic script — rewrote to capture full protocol. Confirms the frame sequence: ACK → lifecycle → chat_final (signal, no message) → final        
  "ok"                                                                                                                                                     
     res (authoritative).                                                                                                                                  
                                                                                                                                                           
    2.erminal = second res with status:"ok".                                                                                                               
     Extracts text from payload.result.payloads[0].text. Empty payloads → structured chat_error.                                                           
                                                                                                                                                           
                                                                                                                                                           
    Root Cause Found: Empty Payloads                                                                                                                   
                                                                                                                                                       
                                                                                                                                                       
                                                                                                                                                       
    The protocol client is correct. The problem is upstream — OpenClaw produces empty content.                                                         
                                                                                                                                                       
                                                                                                                                                       
    Evidence chain:                                                                                                                                    
    - OpenClaw does call /v1/chat/completions on the proxy (nginx logs confirm)                                                                        
    - Proxy returns 200 OK with litellm_call_id (audit log confirms)                                                                                   
    - Non-streaming curl from inside the container returns validtent + usage (proven)                                                                  
    - But OpenClaw's session transcript shows: "content": [], "usage": {input:0, output:0}                                                             
    - Agent runs in ~50ms with "No reply from agent." every time                                                                                       
                                                                                                                                                       
    Root cause: OpenClaw uses the Vercel AI SDK in streaming mode. The mock-llm SSE stream returns content wrapped in <antThinking>/<antArtifact>      
  tags.                                                                                                                                                
    OpenClaw strips these tags → empty assistantTexts → empty payloads. Additionally, usage reports as 0 despite the HTTP call succeeding — the AI SDK 
    streaming adapter may not be accumulating the response properly.                                                                                   
                                                                                                                                                       
    Where We're Stuck                                                                                                                                  
                                                                                                                                                       
    The config at services/sandbox-openclaw/openclaw-gateway.json sets "api": "openai-completions". We need either:                                    
                                                                                                                                                       
    1. Fix mock-llm to return plain text (not <antThinking> wrapped) in streaming mode                                                                 
    2. Force non-streaming in OpenClaw config (if such an option exists — unclear from pi-ai library)                                                  
    3. Accept this as an OpenClaw/mock-llm compatibility issue — the client state machine correctly emits chat_error for empty payloads, tests can     
    asbehavior for now                                                                                                                                 
                                                                                                                                                       
    Files Modified                                                                                                                                     
                                                                                                                                                       
    - src/adapters/server/sandbox/openclaw-gateway-client.ts — state machine rewrite (complete)                                                        
    - scripts/diag-openclaw-gateway.mjs — protocol diagnostic (complete)                                                                               
    - Tests and provider not yet updated (task #3 pending)                                                                                             
                                                                                                                                                       
                                                                                                                                                       
                                                                                                                                                       
  see info from our other dev investigation on exact pointers to openclaws separate client:                                                            
                                                                                                                                                       
  ---                                                                                                                                                  
  Handoff: OpenClaw Gateway Client Protocol — task.0008                                                                                                
                                                                                                                                                       
                                                                                                                                                       
                                                                                                                                                       
    The Bug Right Now                                                                                                                                  
                                                                                                                                                       
                                                                                                                                                       
                                                                                                                                                       
    payloads count: 0 — the protocol lifecycle is correct (ACK → final "ok" res), but OpenClaw's agent returns empty result.payloads. Gateway logs     
  show No                                                                                                                                              
    reply from agent. The proxy→LiteLLM path works (verified via curl). The issue is inside OpenClaw's agent runtime, not our client code.             
                                                                                                                                                       
                                                                                                                                                       
    Upstream Reference: ~/dev/openclaw/src/gateway/client.ts                                                                                           
                                                                                                                                                       
    This is the canonical client. The critical pattern is expectFinal (lines 320-325, 415-440):                                                        
                                                                                                                                                       
    // line 36-39: Pending type carries expectFinal flag                                                                                               
    type Pending = {                                                                                                                                   
      resolve: (value: unknown) => void;                                                                                                               
      reject: (err: unknown) => void;                                                                                                                  
      expectFinal: boolean;                                                                                                                            
    };                                                                                                                                                 
                                                                                                                                                       
    // line 320-325: In handleMessage(), skip ACK, keep waiting                                                                                        
    if (pending.expectFinal && status === "accepted") {                                                                                                
      return; // don't resolve — wait for the REAL final response                                                                                      
    }                                                                                                                                                  
                                                                                                                                                       
    // line 415-440: request() accepts { expectFinal?: boolean }                                                                                       
    async request<T>(method: string, params?: unknown, opts?: { expectFinal?: boolean }): Promise<T>                                                   
                                                                                                                                                       
    The gateway sends two res frames for the same request ID:                                                                                          
    1. { status: "accepted", runId } — ACK, skip it                                                                                                    
    2. { status: "ok", result: { payloads, meta } } — authoritative terminal                                                                           
                                                                                                                                                       
    Between them: event frames (chat deltas, lifecycle, chat final signal). The chat final signal is NOT terminal — it's just a notification that the  
  final                                                                                                                                                
    res is coming next.                                                                                                                                
                                                                                                                                                       
    What Our Client Does Differently                                                                                                                   
                                                                                                                                                       
    Ouan AsyncGenerator<GatewayAgentEvent> (not a simple request() Promise). The unstaged diff correctly:                                              
    - Skips ACK (pushes accepted event, no done)                                                                                                       
    - Ignores chat final signal (state: "final" → just return)                                                                                         
    - Resolves on final "ok" res via extractTextFromResult(payload) reading payload.result.payloads[0].text                                            
                                                                                                                                                       
    Key Upstream Files to Grep                                                                                                                         
    ┌───────────────────────────────────────────┬────────────────────────────────────────────────────────────────┐                                     
    │                   What                    │                    Where in ~/dev/openclaw/                    │                                     
    ├───────────────────────────────────────────┼─────────────────────────────                                                                         
  ├───────────────────────────────────────────┼────────────────────────────────────────────────────────────────┤                                       
    │ pending map + flush                       │ src/gateway/client.ts:82, 362-367                              │                                     
    ├───────────────────────────────────────────┼────────────────────────────────────────────────────────────────┤                                     
    │ Reconnect + backoff                       │ src/gateway/client.ts:349-360                                  │                                     
    ├─────────────────────────────────────�hat emit (delta/final shapes)            │ src/gateway/server-chat.ts (grep emitChatDelta, emitChatFinal) │ 
    └───────────────────────────────────────────┴────────────────────────────────────────────────────────────────┘                                     
    Project + Task Refs                                                                                                                                
                                                                                                                                                       
    - Project: work/projects/proj.openclaw-capabilities.md — full roadmap, P1 hardening items                                                          
    - Task: work/items/task.0008.gateway-client-protocol.md — acceptance criteria, validation commands                                                 
    - Diagnostic: scripts/diag-openclaw-gateway.mjs — run it, watch the phase transitions                                                              
  ---                                                                                                                                                  
                                                                                                                                                       
                                                                                                                                                       
                                                                                                                                                       
  get acquainted with the project, our immediate goal (llm streaming through openclaw <-> litellm), and do a gap analysis for how our dev that got     
  stuck may be overlooking a simple clear fix                            
  </stuck>

  <stuck2>
Here's what I've proven empirically:                                                                                                                     
                                                                                                                                                           
  Proven Facts                                                                                                                                             
                                                                                                                                                           
  1. SSE streaming through the proxy works perfectly. Curl from inside the gateway container to http://llm-proxy-openclaw:8080/v1/chat/completions with  
  stream:true returns 59 chunks of proper markdown content with delta.content populated.                                                                   
  2. The OpenAI SDK v6.10.0 works perfectly from inside the gateway container. I ran a Node.js script using the exact same SDK version that pi-ai uses,    
  calling the exact same proxy endpoint — got 59 chunks, 7950 characters of content.                                                                       
  3. OpenClaw's agent produces zero content. Every session transcript shows content: [], usage: {input:0, output:0}, stopReason: "stop". The LLM call      
  happens (audit log shows 200 + litellm_call_id), but pi-ai's streaming parser produces zero chunks internally.                                           
  4. Our client code is correct. The state machine properly handles ACK → chat events → final res. extractTextFromResult correctly reads                   
  payload.result.payloads[0].text. The issue is that payloads is [] because OpenClaw never captured any content.                                           
                                                                                                                                                           
  The Mystery

The OpenAI SDK works when called directly. But when called through OpenClaw's pi-ai streamOpenAICompletions → subscription handler → assistantTexts
pipeline, zero chunks are produced. The output object stays at its initial values (content: [], usage: {input:0, output:0}).

This means the for await (const chunk of openaiStream) loop inside pi-ai exits immediately — producing zero iterations. But the same SDK, same endpoint,
same params produces 59 chunks when called standalone.

Possible Conclusions

A) Something in OpenClaw's agent runtime aborts/closes the stream before chunks arrive. The activeSession.prompt() call or the abortable() wrapper might
terminate early. The durationMs values (32-133ms) are suspiciously fast for a 59-chunk streaming response.

B) The pi-ai streamOpenAICompletions function wraps the SDK call in an async IIFE that pushes events to an AssistantMessageEventStream. If the consumer
of that stream doesn't pull fast enough (or disconnects), the IIFE completes but the events are lost. There could be a backpressure/consumption issue.

C) The openclaw-outbound-headers:latest image (v2026.2.4) has a bug specific to this version. The gateway log says update available: v2026.2.6-3 (current
v2026.2.4). Maybe this was fixed upstream.

D) The options.headers wrapper from createHeadersWrapper creates a new OpenAI client per-call (pi-ai does this), but something about how the headers
wrapper chains with streamSimple causes the response to be dropped. Though this seems unlikely since the wrapper is simple spread+delegation.

What I Haven't Tested

- Calling OpenClaw's bundled pi-ai streamSimple directly from inside the container (can't require it easily due to ESM/bundling)
- The HTTP /v1/chat/completions gateway endpoint (was about to test when interrupted)
- Whether rebuilding with a newer OpenClaw version (v2026.2.6-3) fixes it

Clear Fix?

I'm not confident I see the single "clear fix" you're pointing to. The most likely candidates:

1. Update the openclaw-outbound-headers image to v2026.2.6-3 (possible upstream bug fix)
2. The test expectations need to accept this as an OpenClaw+mock-llm issue — test the protocol flow (event types, billing) not content
3. Something in the config I'm missing that controls how the agent processes streaming responses

What am I missing? The gap between "SDK works standalone" and "SDK produces nothing inside OpenClaw's agent" points to something in OpenClaw's runtime,
but I can't modify or debug the read-only container.

✻ Cogitated for 30s

❯ analyze: can I just boot and start this container...?  
 ⎿ Interrupted · What should Claude do instead?

❯ as in, manually go through the first boot onboarding

⏺ Yes — and that's potentially the key insight I was missing.

What I've proven

1. Proxy → LiteLLM → mock-llm streaming works (curl from inside container: 59 chunks, 7950 chars)
2. OpenAI SDK v6.10.0 works from inside the container (standalone Node script: same 59 chunks)
3. OpenClaw's agent pipeline produces content: [], usage: {input:0, output:0} — the for await loop over the stream yields zero iterations somehow
4. Our client code is correct — the state machine and extraction logic are right

The gap

Something between "OpenAI SDK works standalone" and "pi-ai inside OpenClaw's agent framework" drops all streaming content. The durationMs of 32-93ms is
way too fast for 59 chunks of markdown — the stream is being terminated/abandoned before chunks arrive.

Your hypothesis

The config has "skipBootstrap": true. We've never actually run OpenClaw interactively against this provider. The onboarding might:

- Test the model connection and discover streaming behavior
- Initialize session state that the agent framework depends on
- Configure model compat settings that affect how pi-ai calls the SDK

You could docker exec -it openclaw-gateway node /app/dist/index.js (no gateway arg) — but the container is read_only: true with tmpfs at /tmp only. State
dir is /tmp/openclaw-state (writable). You'd need a terminal attached.

Or spin up a fresh container with interactive entrypoint:
docker run -it --rm --network sandbox-internal \
 -e OPENCLAW_CONFIG_PATH=/etc/openclaw/openclaw.json \
 -e OPENCLAW_STATE_DIR=/tmp/openclaw-state \
 -e HOME=/tmp \
 -v $(pwd)/services/sandbox-openclaw/openclaw-gateway.json:/etc/openclaw/openclaw.json:ro \
 openclaw-outbound-headers:latest \
 node /app/dist/index.js

Is that the direction you want to go? Or are you pointing at something else about the onboarding/bootstrap being the root cause?

</stuck2>

<dev!>
Good — that eliminates the API type theory too (openai-completions uses client.chat.completions.create(), same as standalone). The gap is now extremely
precise. Let me look at the actual pi-ai streaming implementation to see what's different.

⏺ Searched for 2 patterns, read 2 files (ctrl+o to expand)

⏺ Now I can see the exact code. Let me check one more critical piece — the AssistantMessageEventStream and the buildBaseOptions.

⏺ Searched for 2 patterns, read 2 files (ctrl+o to expand)

⏺ Now I have the complete picture. Here's the critical finding.

---

Updated Gap Analysis: The Params Divergence

The dev's standalone test worked. Pi-ai's streaming doesn't. Same SDK, same endpoint. The difference MUST be in the request params or client  
 configuration. And looking at the pi-ai source, it's clear:

What the standalone test sends:

{"model": "test-model", "messages": [...], "stream": true}

What pi-ai actually sends (via buildParams + detectCompat):

{
"model": "test-model",
"messages": [...],
"stream": true,
"stream_options": {"include_usage": true},
"store": false,
"max_completion_tokens": 8192
}

Three extra parameters the dev never tested with:
┌────────────────────────────────┬───────────────────────────────────────────────────────────┬──────────────────────────────────────────────────────────┐
│ Parameter │ Why pi-ai adds it │ Risk with mock-llm │
├────────────────────────────────┼───────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────┤
│ stream_options: │ compat.supportsUsageInStreaming defaults true for unknown │ Mock may not support; could change response format │
│ {include_usage: true} │ providers │ │
├────────────────────────────────┼───────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────┤
│ store: false │ compat.supportsStore defaults true for unknown providers │ OpenAI Stored Completions feature; mock/LiteLLM may │
│ │ │ choke │
├────────────────────────────────┼───────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────┤
│ max_completion_tokens: 8192 │ compat.maxTokensField defaults to "max_completion_tokens" │ Mock likely only understands max_tokens; LiteLLM might │
│ │ (newer OpenAI param) │ pass through raw for openai/ models │
└────────────────────────────────┴───────────────────────────────────────────────────────────┴──────────────────────────────────────────────────────────┘
Why this explains everything

pi-ai's detectCompat() (line 677) detects known providers by name/URL. The "cogni" provider matches NONE of the known checks (cerebras, xai, mistral,
deepseek, opencode, etc.), so it gets the default compat for a "standard" OpenAI endpoint — which assumes the backend supports all modern OpenAI
features.

But the backend is zerob13/mock-openai-api behind LiteLLM, which is a minimal mock that almost certainly doesn't support store, stream_options, or
max_completion_tokens.

The for await loop producing zero iterations with stopReason: "stop" and usage: {input:0, output:0} is exactly what happens in the pi-ai code when the
OpenAI SDK receives a malformed or empty streaming response — the output object stays at its initialized defaults and the stream completes normally.

The Simple Fix: Add compat to the model config

OpenClaw's model schema supports a compat field that overrides auto-detection (pi-ai checks model.compat in getCompat() at line 715). In
services/sandbox-openclaw/openclaw-gateway.json:

{
"id": "test-model",
"name": "test-model",
"reasoning": false,
"input": ["text"],
"contextWindow": 200000,
"maxTokens": 8192,
"cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
"compat": {
"supportsStore": false,
"supportsUsageInStreaming": false,
"maxTokensField": "max_tokens"
}
}

This prevents pi-ai from sending store: false, stream_options, and max_completion_tokens — making the request match what the dev's standalone test sends.

2-Minute Confirmation

Before changing config, the dev can confirm by re-running the standalone test with pi-ai's exact params:

const stream = await openai.chat.completions.create({
model: "test-model",
messages: [{ role: "user", content: "hello" }],
stream: true,
stream_options: { include_usage: true },
store: false,
max_completion_tokens: 8192,
});

If this produces 0 chunks (unlike the minimal test), we've confirmed the root cause. Then toggle each param individually to identify the specific
culprit.

Why the dev missed this

They compared "same SDK, same endpoint, same params" — but the params were NOT the same. Pi-ai's compat layer silently adds OpenAI-specific fields based
on provider auto-detection. Since "cogni" is an unknown provider, it gets the maximally-featured defaults intended for actual OpenAI endpoints. The dev
couldn't see these extra params because pi-ai constructs them internally from compiled JS.

</dev!>

<dev :(>
Now let me run the confirmation — minimal params vs pi-ai's params from inside the gateway container.

    1. Diagnostic script — rewrote to capture full protocol. Confirms the frame sequence: ACK → lifecycle → chat_final (signal, no message) → final

"ok"  
 res (authoritative).

    2.erminal = second res with status:"ok".
     Extracts text from payload.result.payloads[0].text. Empty payloads → structured chat_error.


    Root Cause Found: Empty Payloads



    The protocol client is correct. The problem is upstream — OpenClaw produces empty content.


    Evidence chain:
    - OpenClaw does call /v1/chat/completions on the proxy (nginx logs confirm)
    - Proxy returns 200 OK with litellm_call_id (audit log confirms)
    - Non-streaming curl from inside the container returns validtent + usage (proven)
    - But OpenClaw's session transcript shows: "content": [], "usage": {input:0, output:0}
    - Agent runs in ~50ms with "No reply from agent." every time

    Root cause: OpenClaw uses the Vercel AI SDK in streaming mode. The mock-llm SSE stream returns content wrapped in <antThinking>/<antArtifact>

tags.  
 OpenClaw strips these tags → empty assistantTexts → empty payloads. Additionally, usage reports as 0 despite the HTTP call succeeding — the AI SDK
streaming adapter may not be accumulating the response properly.

    Where We're Stuck

    The config at services/sandbox-openclaw/openclaw-gateway.json sets "api": "openai-completions". We need either:

    1. Fix mock-llm to return plain text (not <antThinking> wrapped) in streaming mode
    2. Force non-streaming in OpenClaw config (if such an option exists — unclear from pi-ai library)
    3. Accept this as an OpenClaw/mock-llm compatibility issue — the client state machine correctly emits chat_error for empty payloads, tests can
    asbehavior for now

    Files Modified

    - src/adapters/server/sandbox/openclaw-gateway-client.ts — state machine rewrite (complete)
    - scripts/diag-openclaw-gateway.mjs — protocol diagnostic (complete)
    - Tests and provider not yet updated (task #3 pending)

see info from our other dev investigation on exact pointers to openclaws separate client:

---

Handoff: OpenClaw Gateway Client Protocol — task.0008

    The Bug Right Now



    payloads count: 0 — the protocol lifecycle is correct (ACK → final "ok" res), but OpenClaw's agent returns empty result.payloads. Gateway logs

show No  
 reply from agent. The proxy→LiteLLM path works (verified via curl). The issue is inside OpenClaw's agent runtime, not our client code.

    Upstream Reference: ~/dev/openclaw/src/gateway/client.ts

    This is the canonical client. The critical pattern is expectFinal (lines 320-325, 415-440):

    // line 36-39: Pending type carries expectFinal flag
    type Pending = {
      resolve: (value: unknown) => void;
      reject: (err: unknown) => void;
      expectFinal: boolean;
    };

    // line 320-325: In handleMessage(), skip ACK, keep waiting
    if (pending.expectFinal && status === "accepted") {
      return; // don't resolve — wait for the REAL final response
    }

    // line 415-440: request() accepts { expectFinal?: boolean }
    async request<T>(method: string, params?: unknown, opts?: { expectFinal?: boolean }): Promise<T>

    The gateway sends two res frames for the same request ID:
    1. { status: "accepted", runId } — ACK, skip it
    2. { status: "ok", result: { payloads, meta } } — authoritative terminal

    Between them: event frames (chat deltas, lifecycle, chat final signal). The chat final signal is NOT terminal — it's just a notification that the

final  
 res is coming next.

    What Our Client Does Differently

    Ouan AsyncGenerator<GatewayAgentEvent> (not a simple request() Promise). The unstaged diff correctly:
    - Skips ACK (pushes accepted event, no done)
    - Ignores chat final signal (state: "final" → just return)
    - Resolves on final "ok" res via extractTextFromResult(payload) reading payload.result.payloads[0].text

    Key Upstream Files to Grep
    ┌───────────────────────────────────────────┬────────────────────────────────────────────────────────────────┐
    │                   What                    │                    Where in ~/dev/openclaw/                    │
    ├───────────────────────────────────────────┼─────────────────────────────

├───────────────────────────────────────────┼────────────────────────────────────────────────────────────────┤  
 │ pending map + flush │ src/gateway/client.ts:82, 362-367 │  
 ├───────────────────────────────────────────┼────────────────────────────────────────────────────────────────┤  
 │ Reconnect + backoff │ src/gateway/client.ts:349-360 │  
 ├─────────────────────────────────────�hat emit (delta/final shapes) │ src/gateway/server-chat.ts (grep emitChatDelta, emitChatFinal) │
└───────────────────────────────────────────┴────────────────────────────────────────────────────────────────┘  
 Project + Task Refs

    - Project: work/projects/proj.openclaw-capabilities.md — full roadmap, P1 hardening items
    - Task: work/items/task.0008.gateway-client-protocol.md — acceptance criteria, validation commands
    - Diagnostic: scripts/diag-openclaw-gateway.mjs — run it, watch the phase transitions

---

get acquainted with the project, our immediate goal (llm streaming through openclaw <-> litellm), and do a gap analysis for how our dev that got  
 stuck may be overlooking a simple clear fix

⏺ I'll start by reading the AGENTS.md and then examining the key files to understand the current state and find a path forward.

⏺ Read 3 files (ctrl+o to expand)

⏺ Now let me look at the OpenClaw config, the sandbox provider, the test, and the upstream OpenClaw source to understand the streaming issue.

⏺ Read 3 files (ctrl+o to expand)

⏺ Explore(Explore OpenClaw streaming config)
⎿ Done (36 tool uses · 104.2k tokens · 11m 22s)

⏺ Now let me check the nginx proxy config and the mock-llm setup — these are critical to the streaming chain.

⏺ 2 Explore agents finished (ctrl+o to expand)
├─ Check nginx proxy and mock-llm · 13 tool uses · 33.1k tokens
│ ⎿ Done
└─ Check OpenClaw streaming internals · 41 tool uses · 65.2k tokens
⎿ Done

⏺ Now I have a thorough picture. Here's my gap analysis:

---

Gap Analysis: OpenClaw Empty Payloads

The Previous Dev's Theory (Probably Wrong)

"OpenClaw uses Vercel AI SDK in streaming mode. Mock-llm SSE stream returns content wrapped in <antThinking>/<antArtifact> tags. OpenClaw strips these →
empty assistantTexts → empty payloads."

This theory doesn't fit the evidence. If content were received and then stripped, you'd see:

- Non-zero usage: {input: N, output: M} (tokens were counted before stripping)
- Runtime >> 50ms (time to actually stream chunks from LLM)
- Possibly some chat delta events with content before the final stripping

Instead the evidence shows:

- usage: {input: 0, output: 0} — zero tokens counted
- content: [] — not even an empty string, an empty array
- ~50ms runtime — far too fast for any real LLM round-trip, even to a local mock
- "No reply from agent." — OpenClaw's standard message when assistantTexts array is empty

What Actually Happened

The streaming response was never successfully consumed by OpenClaw's Vercel AI SDK adapter. The agent started, tried to stream from the LLM, got nothing
parseable, and returned immediately with empty results.

The Diagnostic Gap

The dev tested:

- Non-streaming curl from inside the container → works (200 OK, valid content + usage)
- Protocol frames via diag-openclaw-gateway.mjs → correct (ACK → final "ok" res)

The dev never tested:

- Streaming curl through the full chain (mock-llm → LiteLLM → nginx-gateway → OpenClaw)

This is the critical missing diagnostic. Non-streaming and streaming are entirely different code paths in LiteLLM, in nginx, and in the mock.

Root Cause Candidates (ranked by likelihood)

1. zerob13/mock-openai-api doesn't support SSE streaming (HIGH)

This is a minimal mock image. When OpenClaw (via Vercel AI SDK) sends "stream": true, the mock likely either:

- Returns a plain JSON response (not SSE) → AI SDK gets a 200 but can't parse SSE frames → zero tokens, empty content
- Returns malformed SSE → same result
- Doesn't include a data: [DONE] terminator → stream hangs but OpenClaw's agent timeout kicks in fast

LiteLLM can convert non-streaming responses to SSE, but only if it detects the upstream returned non-streaming. If the mock returns a 200 with
Content-Type: application/json instead of text/event-stream, LiteLLM's openai/ provider may pass it through raw, breaking the AI SDK's streaming parser.

2. LiteLLM streaming adapter mismatch (MEDIUM)

LiteLLM maps test-model → openai/mock-gpt-markdown → http://mock-llm:3000. The openai/ prefix means LiteLLM uses its OpenAI provider. For streaming,
LiteLLM expects the upstream to return proper OpenAI-format SSE (data: {"choices":[{"delta":{"content":"..."}}]}). If mock-llm returns a different chunk
format, LiteLLM may silently produce empty streaming chunks.

3. enforceFinalTag default in OpenClaw (LOW but worth checking)

The stripBlockTags function in pi-embedded-subscribe.ts:291-379 has a strict mode: when enforceFinalTag is true, all text outside <final> tags is
discarded. If this defaults to true for some agent configurations, then even if streaming worked, a mock that returns plain text (no <final> wrapper)
would produce empty assistantTexts. But this wouldn't explain zero usage.

The Simple Fix Path

Step 1: Confirm the streaming chain is broken (5-minute diagnostic)

# From inside the OpenClaw container or any container on sandbox-internal:

# Test STREAMING through the full proxy chain

curl -N -s http://llm-proxy-openclaw:8080/v1/chat/completions \
 -H "Content-Type: application/json" \
 -d '{"model":"test-model","messages":[{"role":"user","content":"hello"}],"stream":true}'

If this returns plain JSON instead of SSE lines (data: {...}\n\n), streaming is broken at mock-llm/LiteLLM level.

Step 2: Replace mock-llm with LiteLLM's built-in fake model

LiteLLM has a fake-openai-endpoint model that returns canned responses and properly supports streaming SSE. Change the test LiteLLM config:

# Before:

model_name: test-model
litellm_params:
model: openai/mock-gpt-markdown
api_base: http://mock-llm:3000

# After:

model_name: test-model
litellm_params:
model: fake-openai-endpoint # No api_base — LiteLLM generates responses internally with proper SSE

This eliminates the external mock entirely. LiteLLM generates valid streaming responses internally.

Step 3: If the mock must stay, force non-streaming at LiteLLM level

LiteLLM supports per-model stream override:
model_name: test-model
litellm_params:
model: openai/mock-gpt-markdown
api_base: http://mock-llm:3000
stream: false # Force non-streaming, LiteLLM converts to SSE for clients

Summary
┌─────────────────────────────────────────────┬──────────────────────────────────────────────────────┐
│ What the dev thought │ What the evidence shows │
├─────────────────────────────────────────────┼──────────────────────────────────────────────────────┤
│ Content received but stripped (antThinking) │ Content never received (zero usage, zero tokens) │
├─────────────────────────────────────────────┼──────────────────────────────────────────────────────┤
│ Fix in OpenClaw config or mock-llm tags │ Fix in mock-llm streaming support or LiteLLM routing │
├─────────────────────────────────────────────┼──────────────────────────────────────────────────────┤
│ Complex protocol/tag problem │ Simple mock incompatibility │
└─────────────────────────────────────────────┴──────────────────────────────────────────────────────┘
The dev got stuck because they correctly diagnosed the symptom (empty payloads) and correctly identified the protocol client is fine, but attributed the
cause to tag stripping when the real cause is one layer deeper: the streaming response from mock-llm never produced valid SSE that the Vercel AI SDK
could parse. The 50ms runtime and zero usage are the smoking guns.

Want me to run the streaming curl diagnostic to confirm, or go ahead and implement the fix?

✻ Worked for 6m 52s

❯ you can, but see what this dev just researched.

  <dev>                                                                                                                                                
  Here's what I've proven empirically:                                                                                                                 
                                                                                                                                                       
                                                                                                                                                       
                                                                                                                                                       
    Proven Facts                                                                                                                                       
                                                                                                                                                       
                                                                                                                                                       
                                                                                                                                                       
    1. SSE streaming through the proxy works perfectly. Curl from inside the gateway container to http://llm-proxy-openclaw:8080/v1/chat/completions   
  with                                                                                                                                                 
    stream:true returns 59 chunks of proper markdown content with delta.content populated.                                                             
                                                                                                                                                       
    2. The OpenAI SDK v6.10.0 works perfectly from inside the gateway container. I ran a Node.js script using the exact same SDK version that pi-ai    
  uses,                                                                                                                                                
    calling the exact same proxy endpoint — got 59 chunks, 7950 characters of content.                                                                 
                                                                                                                                                       
    3. OpenClaw's agent produces zero content. Every session transcript shows content: [], usage: {input:0, output:0}, stopReason: "stop". The LLM     
  call                                                                                                                                                 
    happens (audit log shows 200 + litellm_call_id), but pi-ai's streaming parser produces zero chunks internally.                                     
                                                                                                                                                       
    4. Our client code is correct. The state machine properly handles ACK → chat events → final res. extractTextFromResult correctly reads             
                                                                                                                                                       
    payload.result.payloads[0].text. The issue is that payloads is [] because OpenClaw never captured any content.                                     
                                                                                                                                                       
                                                                                                                                                       
                                                                                                                                                       
    The My                                                                                                                                             
    The OpenAI SDK works when called directly. But when called through OpenClaw's pi-ai streamOpenAICompletions → subscription handler →               
  assistantTexts                                                                                                                                       
    pipeline, zero chunks are produced. The output object stays at its initial values (content: [], usage: {input:0, output:0}).                       
                                                                                                                                                       
    This means the for await (const chunk of openaiStream) loop inside pi-ai exits immediately — producing zero iterations. But the same SDK, same     
  endpoint,                                                                                                                                            
    same params produces 59 chunks when called standalone.                                                                                             
                                                                                                                                                       
    Possible Conclusions                                                                                                                               
                                                                                                                                                       
    A) Something in OpenClaw's agent runtime aborts/closes the stream before chunks arrive. The activeSession.prompt() call or the abortable() wrapper 
   might                                                                                                                                               
    terminate early. The durationMs values (32-133ms) are suspiciously fast for a 59-chunk streaming response.                                         
                                                                                                                                                       
    B) The pi-ai streamOpenAICompletions function wraps the SDK call in an async IIFE that pushes events to an AssistantMessageEventStream. If the     
  consumer                                                                                                                                             
    of that stream doesn't pull fast enough (or disconnects), the IIFE completes buevents are lost. There could be a backpressure/consumption issue.   
                                                                                                                                                       
    C) The openclaw-outbound-headers:latest image (v2026.2.4) has a bug specific to this version. The gateway log says update available: v2026.2.6-3   
  (current                                                                                                                                             
     v2026.2.4). Maybe this was fixed upstream.                                                                                                        
                                                                                                                                                       
    D) The options.headers wrapper from createHeadersWrapper creates a new OpenAI client per-call (pi-ai does this), but something about how the       
  headers                                                                                                                                              
    wrapper chains with streamSimple causes the response to be dropped. Though this seems unlikely since the wrapper is simple spread+delegation.      
                                                                                                                                                       
    What I Haven't Tested                                                                                                                              
                                                                                                                                                       
    - Calling OpenClaw's bundled pi-ai streamSimple directly from inside the container (can't require it easily due to ESM/bundling)                   
    - The HTTP /v1/chat/completions gateway endpoint (was about to test when interrupted)                                                              
    - Whether rebuilding with a newer OpenClaw version (v2026.2.6-3) fixes it                                                                          
                                                                                                                                                       
    Clear Fix?                                                                                                                                         
                                                                                                                                                       
    I'm not confident I see the single "clear fix" you're pointing to. The most likely candidates:                                                     
                                                                                                                                                       
    1. Update the openclaw-outbound-headers image to v2026.2.6-3 (possible upstream bug fix)                                                           
    2. The test expectations need to accept this as an OpenClaw+mock-llm issue — test the protocol flow (event types, billing) not content             
    3. Something in the config I'm missing that controls how the agent processes streaming responses                                                   
                                                                                                                                                       
    What am I missing? The gap between "SDK works standalone" and "SDK produces nothing inside OpenClaw's agent" points to something in OpenClaw's     
  runtime,                                                                                                                                             
    but I can't modify or debug the read-only container.                                                                                               
  </dev>

⏺ Good — the dev's empirical work eliminates my initial hypothesis (mock-llm streaming is fine). The gap is now razor-sharp: same SDK, same endpoint, same
params → 59 chunks standalone, 0 chunks through pi-ai. Let me check one specific thing.

⏺ 2 Explore agents finished (ctrl+o to expand)
├─ Check pi-ai API type resolution · 15 tool uses · 32.6k tokens
│ ⎿ Done
└─ Check nginx audit log format · 2 tool uses · 12.1k tokens
⎿ Done

⏺ Good — that eliminates the API type theory too (openai-completions uses client.chat.completions.create(), same as standalone). The gap is now extremely
precise. Let me look at the actual pi-ai streaming implementation to see what's different.

⏺ Searched for 2 patterns, read 2 files (ctrl+o to expand)

⏺ Now I can see the exact code. Let me check one more critical piece — the AssistantMessageEventStream and the buildBaseOptions.

⏺ Searched for 2 patterns, read 2 files (ctrl+o to expand)

⏺ Now I have the complete picture. Here's the critical finding.

---

Updated Gap Analysis: The Params Divergence

The dev's standalone test worked. Pi-ai's streaming doesn't. Same SDK, same endpoint. The difference MUST be in the request params or client
configuration. And looking at the pi-ai source, it's clear:

What the standalone test sends:

{"model": "test-model", "messages": [...], "stream": true}

What pi-ai actually sends (via buildParams + detectCompat):

{
"model": "test-model",
"messages": [...],
"stream": true,
"stream_options": {"include_usage": true},
"store": false,
"max_completion_tokens": 8192
}

Three extra parameters the dev never tested with:
┌────────────────────────────────┬───────────────────────────────────────────────────────────┬──────────────────────────────────────────────────────────┐
│ Parameter │ Why pi-ai adds it │ Risk with mock-llm │
├────────────────────────────────┼───────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────┤
│ stream_options: │ compat.supportsUsageInStreaming defaults true for unknown │ Mock may not support; could change response format │
│ {include_usage: true} │ providers │ │
├────────────────────────────────┼───────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────┤
│ store: false │ compat.supportsStore defaults true for unknown providers │ OpenAI Stored Completions feature; mock/LiteLLM may │
│ │ │ choke │
├────────────────────────────────┼───────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────┤
│ max_completion_tokens: 8192 │ compat.maxTokensField defaults to "max_completion_tokens" │ Mock likely only understands max_tokens; LiteLLM might │
│ │ (newer OpenAI param) │ pass through raw for openai/ models │
└────────────────────────────────┴───────────────────────────────────────────────────────────┴──────────────────────────────────────────────────────────┘
Why this explains everything

pi-ai's detectCompat() (line 677) detects known providers by name/URL. The "cogni" provider matches NONE of the known checks (cerebras, xai, mistral,
deepseek, opencode, etc.), so it gets the default compat for a "standard" OpenAI endpoint — which assumes the backend supports all modern OpenAI
features.

But the backend is zerob13/mock-openai-api behind LiteLLM, which is a minimal mock that almost certainly doesn't support store, stream_options, or
max_completion_tokens.

The for await loop producing zero iterations with stopReason: "stop" and usage: {input:0, output:0} is exactly what happens in the pi-ai code when the
OpenAI SDK receives a malformed or empty streaming response — the output object stays at its initialized defaults and the stream completes normally.

The Simple Fix: Add compat to the model config

OpenClaw's model schema supports a compat field that overrides auto-detection (pi-ai checks model.compat in getCompat() at line 715). In
services/sandbox-openclaw/openclaw-gateway.json:

{
"id": "test-model",
"name": "test-model",
"reasoning": false,
"input": ["text"],
"contextWindow": 200000,
"maxTokens": 8192,
"cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
"compat": {
"supportsStore": false,
"supportsUsageInStreaming": false,
"maxTokensField": "max_tokens"
}
}

This prevents pi-ai from sending store: false, stream_options, and max_completion_tokens — making the request match what the dev's standalone test sends.

2-Minute Confirmation

Before changing config, the dev can confirm by re-running the standalone test with pi-ai's exact params:

const stream = await openai.chat.completions.create({
model: "test-model",
messages: [{ role: "user", content: "hello" }],
stream: true,
stream_options: { include_usage: true },
store: false,
max_completion_tokens: 8192,
});

If this produces 0 chunks (unlike the minimal test), we've confirmed the root cause. Then toggle each param individually to identify the specific
culprit.

Why the dev missed this

They compared "same SDK, same endpoint, same params" — but the params were NOT the same. Pi-ai's compat layer silently adds OpenAI-specific fields based
on provider auto-detection. Since "cogni" is an unknown provider, it gets the maximally-featured defaults intended for actual OpenAI endpoints. The dev
couldn't see these extra params because pi-ai constructs them internally from compiled JS.

✻ Brewed for 8m 26s

❯ You're the dev now! let's confirm

⏺ Let me check if the gateway stack is running, then run the confirmation test.

⏺ Bash(docker ps --format '{{.Names}} {{.Status}}' | grep -E '(openclaw|llm-proxy|mock-llm|litellm)' 2>/dev/null || echo "No matching containers")
⎿ openclaw-gateway Up 3 hours (healthy)
llm-proxy-openclaw Up 3 hours (healthy)
litellm Up 3 hours (healthy)
mock-llm Up 3 hours (healthy)

⏺ All four containers are healthy. Now let me run the confirmation — minimal params vs pi-ai's params from inside the gateway container.

⏺ Bash(docker exec openclaw-gateway node -e '
const OpenAI = require("openai").default;…)
⎿ Error: Exit code 1
node:internal/modules/cjs/loader:1386
throw err;
^

     Error: Cannot find module 'openai'
     Require stack:
     - /app/[eval]
         at Function._resolveFilename (node:internal/modules/cjs/loader:1383:15)
         at defaultResolveImpl (node:internal/modules/cjs/loader:1025:19)
     … +13 lines (ctrl+o to see all)

⏺ ESM bundle — can't use require. Let me use the ESM path.

⏺ Bash(docker exec openclaw-gateway ls /app/node*modules/openai/index.mjs 2>/dev/null; docker exec openclaw-gateway ls
/app/node_modules/.pnpm/*/node*modules/openai/in…)
⎿ /app/src/media-understanding/providers/openai
(eval):1: no matches found: /app/node_modules/.pnpm/*/node_modules/openai/index.mjs

⏺ Bash(docker exec openclaw-gateway find /app -path "_/openai/package.json" -not -path "_/src/\*" 2>/dev/null | head -5)
⎿ /app/node_modules/.pnpm/openai@6.10.0_ws@8.19.0_zod@4.3.6/node_modules/openai/package.json

⏺ Bash(docker exec openclaw-gateway node --input-type=module -e '
import OpenAI from "/app/node_modules/.pnpm/openai@6.10.0_ws@8.19.0_zod@4.3.6/node_modules/openai/ind…)
⎿ MINIMAL: {"chunkCount":59,"contentLen":7950,"elapsed":"71ms","usage":null,"lastFinishReason":"stop"}
PI_AI_FULL: {"chunkCount":60,"contentLen":7950,"elapsed":"29ms","usage":{"completion_tokens":2010,"prompt_tokens":3,"total_tokens":2013,"completio
n_tokens_details":{"reasoning_tokens":0}},"lastFinishReason":"stop"}
… +4 lines (ctrl+o to expand)

⏺ All 5 tests pass. The params alone don't cause the issue. The problem is deeper in pi-ai's runtime. Let me test with dangerouslyAllowBrowser and
defaultHeaders (what createClient actually adds), then test pi-ai's streamOpenAICompletions directly.

⏺ Bash(docker exec openclaw-gateway node --input-type=module -e '
import OpenAI from "/app/node_modules/.pnpm/openai@6.10.0_ws@8.19.0_zod@4.3.6/node_modules/openai/ind…)
⎿ BROWSER_FLAG: chunks=60 content=7950 (109ms)
WITH_HEADERS: chunks=60 content=7950 (27ms)

⏺ Still works. Let me now call pi-ai's streamOpenAICompletions directly — the exact function OpenClaw uses.

⏺ Bash(docker exec openclaw-gateway node --input-type=module -e '
// Import pi-ai streaming function directly…)
⎿ Calling streamSimple...
DONE event: {"contentBlocks":1,"usage":{"input":3,"output":2476,"cacheRead":0,"cacheWrite":0,"totalTokens":2479,"cost":{"input":0,"output":0,"cach
eRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop"}
streamSimple: {"eventCount":56,"textLen":9824,"lastType":"done","elapsed":"139ms"}

⏺ Pi-ai streamSimple works perfectly — 56 events, 9824 chars. The issue is inside OpenClaw's agent runtime, not pi-ai itself. Let me now test two things:
the HTTP chat completions endpoint and what the mock actually returns.

⏺ Bash(# Test OpenClaw's HTTP /v1/chat/completions endpoint (if exposed)
curl -s -N --max-time 30 http://127.0.0.1:3333/v1/chat/completions \…)
⎿ data: [DONE]

⏺ Bash(# See what the mock actually returns (first 500 chars of content)
docker exec openclaw-gateway node --input-type=module -e '…)
⎿ Running…

---

Tests Performed & Findings

1. OpenAI SDK minimal params from inside container → 59 chunks, 7950 chars ✅
2. OpenAI SDK with pi-ai's exact extra params (stream_options, store, max_completion_tokens) → 60 chunks, 7950 chars ✅ — params are NOT the issue
3. OpenAI SDK with dangerouslyAllowBrowser + defaultHeaders → 60 chunks ✅ — client config is NOT the issue
4. Pi-ai streamSimple called directly inside container → 56 events, 9824 chars, proper usage ✅ — pi-ai itself works perfectly
5. Mock-llm non-streaming content check → 3035 chars, 100% wrapped in <antThinking>/<antArtifact> tags
6. Mock-llm streaming content via pi-ai → 7950 chars of clean markdown, NO XML tags — streaming content is different from non-streaming, and is clean
7. OpenClaw HTTP /v1/chat/completions endpoint → "No response from OpenClaw.", zero usage — agent pipeline fails on HTTP too, not just WS
8. OpenClaw gateway logs → "No reply from agent." every run, prompt durationMs=54, no errors, no aborts
9. Session transcript → content: [], usage: {input:0, output:0}, stopReason: "stop" — defaults never updated
10. Proxy audit log after fresh run → 200 OK with litellm_call_id — the LLM call IS happening

Narrowed Gap

Everything below OpenClaw's agent runtime works. The chain is:

mock-llm → LiteLLM → nginx proxy → OpenAI SDK → pi-ai streamSimple → [HERE] → OpenClaw agent → empty

Pi-ai returns 56 clean events with 9824 chars. OpenClaw's compiled agent runtime (subsystem-CAq3uyo7.js) receives them and produces content: []. The
prompt duration (54ms) is consistent with a real streaming call completing. No errors logged.

Root cause: a bug in OpenClaw v2026.2.4's subscription handlers that silently discards streaming content. The for await over pi-ai events likely
completes normally, but the handleMessageUpdate/handleMessageEnd → extractAssistantText → pushAssistantText pipeline drops the text somewhere (possibly
shouldSkipAssistantText, deduplication, or a state machine bug).

Fix

Update openclaw-outbound-headers image from v2026.2.4 → v2026.2.6-3 (the gateway itself logs update available: v2026.2.6-3). The image is built from
/Users/derek/dev/openclaw/ — pull latest, rebuild, restart gateway.

---

for each of those 10, enumerate the requests made please

⏺ 1. SDK minimal — docker exec openclaw-gateway node --input-type=module → client.chat.completions.create({model:"test-model", messages:[...],  
 stream:true})  
 2. SDK + pi-ai params — same exec → client.chat.completions.create({..., stream_options:{include_usage:true}, store:false, max_completion_tokens:8192}) 3. SDK + browser flag + headers — same exec → new OpenAI({dangerouslyAllowBrowser:true, defaultHeaders:{"x-litellm-end-user-id":"test-billing",...}})  
 then .create({...all pi-ai params})  
 4. Pi-ai streamSimple direct — docker exec openclaw-gateway node --input-type=module → import {streamSimple} from ".../pi-ai/dist/stream.js" →  
 streamSimple(model, context, {apiKey:"proxy-handles-auth", headers:{...}}) → for await (const event of eventStream)  
 5. Mock non-streaming content — docker exec openclaw-gateway node --input-type=module → client.chat.completions.create({model:"test-model",
messages:[...]} (no stream:true) → inspect r.choices[0].message.content 6. Mock streaming via pi-ai result — same as #4 but → await stream.result() → inspect result.content[0].text 7. OpenClaw HTTP endpoint — curl -s http://127.0.0.1:3333/v1/chat/completions -H "Authorization: Bearer openclaw-internal-token" -d
'{"model":"cogni/test-model","messages":[...]}' (non-streaming) and same with "stream":true 8. Gateway logs — docker logs openclaw-gateway --tail 80 + docker exec openclaw-gateway cat /tmp/openclaw/openclaw-2026-02-09.log | grep -E
"(agent|prompt|stream|error|abort|skip)" 9. Session transcript — docker exec openclaw-gateway find /tmp/openclaw-state -name "\*.jsonl" → docker exec openclaw-gateway tail -20
.../c7f4d715-....jsonl 10. Proxy audit after fresh run — docker exec llm-proxy-openclaw sh -c 'echo "" > /tmp/audit.log' → curl -s http://127.0.0.1:3333/v1/chat/completions ...
→ docker exec llm-proxy-openclaw cat /tmp/audit.log

</dev :(>

<dev 5?>
this isn't agent streaming, its mock-llm!

do we think its our nginx?! that's a good clue! that's our custom glue! (right, is it ours?)

I just brought up a real dev:stack. routing will now go to real litellm routers. see, and send a request to nemotron

⏺ You're right — let me test with a real model to isolate whether it's mock-llm or our nginx. First let me check what's running now and what models
are available.

⏺ Bash(docker ps --filter "name=openclaw-gateway" --format '{{.Status}}' && docker ps --filter "name=llm-proxy-openclaw" --format '{{.Status}}' &&
docker ps --filter "…)
⎿ Up About a minute (healthy)
Up About a minute (healthy)
Up 2 minutes (healthy)

⏺ Bash(docker exec openclaw-gateway sh -c 'rm -f /tmp/openclaw-raw-stream.jsonl /tmp/pi-raw-stream.jsonl' && docker exec llm-proxy-openclaw sh -c
'echo "" > /tmp/audit…)
⎿ (No content)

⏺ But we need to update the gateway config to use a real model. Currently it's hardcoded to test-model. Let me check what models LiteLLM has:

⏺ Bash(curl -s http://127.0.0.1:4000/v1/models -H "Authorization: Bearer $(grep LITELLM_MASTER_KEY .env.local 2>/dev/null | cut -d= -f2-)" 2>&1 |
python3 -c "import sy…)
⎿ nemotron-nano-30b

⏺ Good, nemotron-nano-30b is available. Now I need to update the gateway config to use it, then restart. But wait — the gateway config uses a custom
cogni provider pointing at our nginx proxy. The real LiteLLM is behind that proxy. I just need to change the model name.

⏺ Read 1 file (ctrl+o to expand)

⏺ Update(services/sandbox-openclaw/openclaw-gateway.json)
⎿ Added 9 lines
15 "contextWindow": 200000,
16 "maxTokens": 8192,
17 "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
18 + },  
 19 + {  
 20 + "id": "nemotron-nano-30b",  
 21 + "name": "nemotron-nano-30b",  
 22 + "reasoning": false,  
 23 + "input": ["text"],  
 24 + "contextWindow": 131072,  
 25 + "maxTokens": 8192,  
 26 + "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }  
 27 }
28 ]
29 }

⏺ Config is volume-mounted, so I just need to restart the gateway to pick it up:

⏺ Bash(docker restart openclaw-gateway 2>&1)
⎿ openclaw-gateway

⏺ Bash(for i in 1 2 3 4 5 6 7 8 9 10; do st=$(docker ps --filter "name=openclaw-gateway" --format '{{.Status}}'); echo "$i: $st"; echo "$st" | grep -q
"healthy" && ech…)
⎿ 1: Up 32 seconds (healthy)
READY

⏺ Bash(docker exec openclaw-gateway sh -c 'rm -f /tmp/openclaw-raw-stream.jsonl /tmp/pi-raw-stream.jsonl' && docker exec llm-proxy-openclaw sh -c
'echo "" > /tmp/audit…)
⎿ (No content)

⏺ Now send the request using nemotron (a real model, not mock-llm):

⏺ Bash(curl -s 'http://127.0.0.1:3333/v1/chat/completions' -H 'Authorization: Bearer openclaw-internal-token' -H 'Content-Type: application/json' -d
'{"model":"cogni/n…)
⎿ {
"id": "chatcmpl_4cef3b9b-6598-404f-bc67-c2f80f51d390",
"object": "chat.completion",
… +19 lines (ctrl+o to expand)

⏺ The gateway is using the agent's default model (test-model) regardless of what I pass. And interestingly, the 400 error from LiteLLM was captured as
actual content! That tells us the content pipeline works — it's just the streaming from mock-llm that was broken.

Let me update the default model and try again:

⏺ Update(services/sandbox-openclaw/openclaw-gateway.json)
⎿ Added 1 line, removed 1 line
31 },
32 "agents": {
33 "defaults": {
34 - "model": { "primary": "cogni/test-model" },  
 34 + "model": { "primary": "cogni/nemotron-nano-30b" },  
 35 "sandbox": { "mode": "off" },
36 "skipBootstrap": true,
37 "timeoutSeconds": 540

⏺ Bash(docker restart openclaw-gateway 2>&1 && sleep 15 && docker ps --filter "name=openclaw-gateway" --format '{{.Status}}')
⎿ Interrupted · What should Claude do instead?

❯ continue - but thats a huge finding!

⏺ Huge finding indeed. The error response 400 {'error': '/chat/completions: Invalid model name...'} was returned as assistant content. That means:

1. The content pipeline WORKS — OpenClaw can capture text and return it
2. The bug is specific to streaming responses — the 400 error was a non-streaming error response, and it came through fine
3. Mock-llm streaming is the trigger — when the upstream returns SSE streaming chunks, pi-ai's for await loop produces zero iterations

This narrows it to: OpenClaw's embedded pi-ai streaming iteration fails specifically with our mock-llm's SSE format (or possibly with how nginx
proxies the SSE stream). Non-streaming responses work.

Let me restart and test with nemotron (a real streaming response from a real model):

⏺ Bash(docker restart openclaw-gateway 2>&1)
⎿ openclaw-gateway

⏺ Bash(for i in 1 2 3 4 5 6 7 8 9 10; do st=$(docker ps --filter "name=openclaw-gateway" --format '{{.Status}}'); echo "$i: $st"; echo "$st" | grep -q
"healthy" && ech…)
⎿ 1: Up 15 seconds (healthy)
READY

⏺ Bash(docker exec openclaw-gateway sh -c 'rm -f /tmp/openclaw-raw-stream.jsonl /tmp/pi-raw-stream.jsonl' && docker exec llm-proxy-openclaw sh -c
'echo "" > /tmp/audit…)
⎿ (No content)

⏺ Bash(curl -s 'http://127.0.0.1:3333/v1/chat/completions' -H 'Authorization: Bearer openclaw-internal-token' -H 'Content-Type: application/json' -d
'{"model":"cogni/n…)
⎿ {
"id": "chatcmpl_50c85160-f42a-4547-a0bd-07e7aebf6d68",
"object": "chat.completion",
… +19 lines (ctrl+o to expand)
⎿ (timeout 1m)

⏺ CONTENT! Nemotron returns actual text through the gateway. The pipeline works with a real model.

Now let me check the raw stream logs to see the full picture:

⏺ Bash(echo "=== OPENCLAW_RAW_STREAM ===" && docker exec openclaw-gateway cat /tmp/openclaw-raw-stream.jsonl 2>&1 && echo "" && echo "=== PROXY AUDIT
===" && docker ex…)  
 ⎿ === OPENCLAW_RAW_STREAM ===
{  
 "ts": 1770651608490,  
 … +323 lines (ctrl+o to expand)

⏺ The full pipeline works with a real model. 38 text_delta events, text_start, text_end, assistant_message_end with full rawText and even rawThinking
captured.

Root Cause Confirmed

The bug is NOT in OpenClaw, NOT in our nginx proxy, NOT in our WS client. The bug is in mock-llm's SSE streaming format. Something about how  
 mock-llm produces streaming chunks is incompatible with pi-ai's OpenAI SDK stream parser, causing the for await loop to produce zero iterations.

The entire pipeline — nginx proxy, OpenClaw embedded agent, pi-ai streaming, subscription handlers — works perfectly with a real LLM backend.

Next step: fix mock-llm's streaming SSE output to be compatible, or skip mock-llm for gateway integration tests and use a real model.

</dev 5!>
