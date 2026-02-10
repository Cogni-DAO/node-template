---
id: messenger-integration-openclaw-channels
type: research
title: Messenger Integration via OpenClaw Channels
status: active
trust: draft
summary: Research on leveraging OpenClaw's channel plugin system for WhatsApp/Telegram tenant integrations
read_when: Planning messenger integration, evaluating WhatsApp options, or extending tenant connections for channels
owner: cogni-dev
created: 2026-02-11
verified: 2026-02-11
tags: [messenger, openclaw, research, whatsapp]
---

# Research: Messenger Integration via OpenClaw Channels

> spike: spike.0020 | date: 2026-02-11

## Question

How can Cogni maximize OpenClaw's existing channel/messaging infrastructure to let tenants integrate with messenger services (WhatsApp, Telegram, etc.)? Do we need to build our own connectionId plan for this, or can we leverage OpenClaw's channel plugin system directly? What does a v0 WhatsApp integration look like?

## Context

Cogni already runs OpenClaw as a gateway service (`openclaw-outbound-headers:latest` on `sandbox-internal`) for AI agent execution. The current integration uses OpenClaw purely as a **code agent** — sandbox containers that read/write files and call LLMs. But OpenClaw is actually a full **multi-channel messaging platform** with 15+ channel plugins, and we're not using that capability at all.

Meanwhile, the `proj.tenant-connections` project (Paused, P0 Not Started) designs a `connectionId` → broker → capability pattern for giving AI tools access to external APIs (GitHub, Bluesky, Google). This is related but distinct from messenger routing.

The user wants to enable a v0 where tenants can add a WhatsApp integration and send text messages to Cogni/OpenClaw.

## Findings

### Finding 1: OpenClaw Already Has a Complete Channel Plugin System

OpenClaw's channel architecture is far more capable than what we're currently using. Key discoveries from the OpenClaw codebase (`/Users/derek/dev/openclaw/`):

**Core channels (built-in):**

| Channel     | ID           | Protocol                        | Auth Method     |
| ----------- | ------------ | ------------------------------- | --------------- |
| WhatsApp    | `web`        | Baileys (WebSocket, unofficial) | QR code scan    |
| Telegram    | `telegram`   | Bot API polling                 | Bot token       |
| Discord     | `discord`    | Bot Framework (WebSocket)       | Bot token       |
| Slack       | `slack`      | Bot Framework (WebSocket)       | OAuth app       |
| Signal      | `signal`     | Signal Protocol                 | Phone number    |
| iMessage    | `imessage`   | Native macOS                    | System access   |
| Google Chat | `googlechat` | Google API                      | Service account |

**Extension channels (plugin directory):**
MS Teams, Matrix, LINE, Mattermost, Feishu, Zalo, Nextcloud Talk, Nostr, BlueBubbles, Voice Call

**Key files:**

- `src/channels/plugins/types.plugin.ts` — `ChannelPlugin` contract (config, gateway, outbound, status, auth, pairing, security, directory, resolver, heartbeat, actions, threading, mentions adapters)
- `src/channels/plugins/types.core.ts` — `ChannelAccountSnapshot` (enabled, configured, linked, running, connected, reconnectAttempts, lastConnectedAt, lastInboundAt, lastOutboundAt, lastError)
- `src/routing/resolve-route.ts` — Message routing engine (channel + accountId + peer → agentId + sessionKey)
- `src/gateway/server-methods/channels.ts` — Gateway HTTP methods: `channels.status`, `channels.logout`
- `src/gateway/server-methods/send.ts` — Send method with `channel` and `accountId` params

**Architecture:** Each channel is a plugin implementing a standardized adapter contract. Multi-account support is built in (each channel can have N accounts identified by `accountId`). The gateway exposes channel management via WS protocol methods.

### Finding 2: OpenClaw's Channel Model vs Cogni's ConnectionId Model

These are **related but distinct** concepts:

| Aspect              | Tenant Connections (existing spec)              | Messenger Channels (new)                    |
| ------------------- | ----------------------------------------------- | ------------------------------------------- |
| **Direction**       | Outbound API access (tools → external services) | Bidirectional message routing (users ↔ AI) |
| **Who initiates**   | AI agent (tool invocation)                      | External user (sends message)               |
| **Credential type** | OAuth tokens, API keys, app passwords           | Session state (Baileys auth), bot tokens    |
| **Lifecycle**       | Resolve at tool invocation time                 | Long-running connection (always listening)  |
| **Scope**           | Per-tool-call, per-run                          | Per-tenant, persistent                      |

**However**, the `connections` table from `tenant-connections.md` can naturally extend to store channel credentials:

- `provider: "openclaw:whatsapp"` / `provider: "openclaw:telegram"`
- `credential_type: "channel_session"` / `credential_type: "bot_token"`
- `encrypted_credentials`: AEAD-encrypted Baileys auth state or bot token
- Tenant-scoped, audit-logged, same AEAD encryption

**Conclusion: We DO need the connectionId plan**, but we extend it for messenger channels rather than building a parallel system. The connection broker resolves channel credentials and passes them to OpenClaw gateway configuration, not to tool invocations.

### Finding 3: WhatsApp Integration Options

Three viable paths for WhatsApp, with very different trade-offs:

**Option A: OpenClaw Baileys Channel (unofficial protocol)**

- **What**: OpenClaw's built-in `web` channel uses `@whiskeysockets/baileys` — direct WebSocket connection to WhatsApp servers, no browser needed. QR code scan auth. Multi-account support built in.
- **Pros**: Already implemented in OpenClaw. No Meta business verification. Free (no per-message costs). Fully self-hosted. Fast to deploy.
- **Cons**: Violates WhatsApp ToS — risk of account bans. Protocol can break on WhatsApp updates. GPL-3.0 license (Baileys). No SLA. Not suitable for commercial/customer-facing use.
- **OSS tools**: `@whiskeysockets/baileys` (TypeScript, GPL-3.0, actively maintained, ~5k stars)
- **Fit with our system**: Perfect for v0/dev/internal. OpenClaw already wires it. We just need to expose channel config and message routing through Cogni.

**Option B: WhatsApp Cloud API (official, Meta-hosted)**

- **What**: Meta's official REST API. Webhook-based inbound. Template-based outbound (outside 24h window). Requires Meta Business Manager verification.
- **Pros**: Official, no ban risk. Production-ready. Free service replies (within 24h window). Reliable.
- **Cons**: Requires Meta Business verification (~14 days). Template approval for proactive messages. Not fully self-hosted (Meta infrastructure in the loop). Per-message costs for marketing/utility. Need HTTPS webhook endpoint.
- **OSS tools**: `whatsapp-api-js` (TypeScript, MIT, server-agnostic Cloud API wrapper). Meta's official SDK is abandoned.
- **Fit with our system**: Would need a new channel plugin for OpenClaw, or a Cogni-native adapter that bypasses OpenClaw for WhatsApp specifically. Better for production.

**Option C: Evolution API (self-hosted gateway, supports both)**

- **What**: Self-hosted WhatsApp gateway that supports both Baileys (unofficial) AND Cloud API (official). REST API layer. Built-in AI integrations (OpenAI, Dify).
- **Pros**: Can start with Baileys, switch to Cloud API for production. TypeScript. Apache-2.0. Docker deployment. Has built-in Typebot/Chatwoot integrations.
- **Cons**: Another service to run. Less integrated with OpenClaw's channel model. May duplicate functionality we already have via OpenClaw.
- **OSS tools**: `EvolutionAPI/evolution-api` (~5.2k stars, Apache-2.0, actively maintained)
- **Fit with our system**: Useful if we want WhatsApp without OpenClaw's full channel system, but redundant since OpenClaw already has Baileys.

### Finding 4: Multi-Messenger Abstraction Landscape

| Solution                 | Platforms                                      | Node.js Native | Self-Hosted             | Maturity    | License                  |
| ------------------------ | ---------------------------------------------- | -------------- | ----------------------- | ----------- | ------------------------ |
| **OpenClaw channels**    | 15+ (WA, TG, Discord, Slack, Signal, Teams...) | Yes (TS)       | Yes                     | High        | Proprietary (GHCR image) |
| Matterbridge             | 30+ platforms                                  | No (Go)        | Yes                     | High        | Apache-2.0               |
| Matrix + mautrix bridges | WA, TG, Discord, Slack, Signal                 | No (Go)        | Yes                     | High        | AGPL-3.0                 |
| Evolution API            | WA (+ planned)                                 | Yes (TS)       | Yes                     | Medium-High | Apache-2.0               |
| n8n nodes                | WA, TG, Slack, Discord                         | Yes (TS)       | Yes                     | High        | Fair Source              |
| Botpress                 | ~10 channels                                   | Yes (TS)       | Partial (cloud-shifted) | High        | MIT (v12)                |

**Key insight**: OpenClaw already IS the multi-messenger abstraction layer we'd otherwise need to build or integrate. It has more channel plugins than any Node.js-native alternative, and we're already running it.

### Finding 5: Architecture for Messenger Integration via OpenClaw Gateway

The current OpenClaw gateway integration is one-directional: Cogni sends agent tasks → OpenClaw executes → returns results. For messenger integration, we need bidirectional flow:

```
INBOUND:
  WhatsApp user sends message
    → OpenClaw gateway receives (Baileys listener)
    → OpenClaw routes to agent (resolve-route.ts)
    → Agent processes (LLM calls via proxy)
    → Agent responds
    → OpenClaw sends response back to WhatsApp
    → Cogni captures billing (proxy audit log)

OUTBOUND (Cogni-initiated):
  Cogni graph/tool invokes send
    → WS call to OpenClaw gateway: send({channel, accountId, text})
    → OpenClaw delivers via channel plugin
```

**Critical architectural question: Where does the "agent" live?**

Two sub-options:

**5a: OpenClaw-native agent (self-contained)**

- OpenClaw's agent handles the full conversation loop internally
- Cogni just provides the LLM proxy (billing) and channel config
- Cogni is a control plane, not a message handler
- Pro: Simplest. OpenClaw already does this. Zero new code for message handling.
- Con: Cogni doesn't see individual messages, only LLM calls. No Cogni-side conversation persistence. Hard to integrate Cogni tools/graphs.

**5b: Cogni-mediated agent (bridge pattern)**

- OpenClaw channels receive messages but forward them to Cogni
- Cogni runs its own graph execution with the message
- Response sent back to OpenClaw for outbound delivery
- Pro: Full Cogni integration (billing, tools, connections, conversation persistence, UI visibility).
- Con: More complex. Need a webhook/event bridge between OpenClaw and Cogni.

**Recommendation: Start with 5a for v0, migrate to 5b for v1.**

For v0, the OpenClaw gateway already handles the full loop — it receives WhatsApp messages, routes to an agent, the agent calls the LLM (through our proxy for billing), and sends the response back. All we need to add is:

1. Channel configuration UI (enable WhatsApp, show QR code, manage accounts)
2. Channel config persistence (connections table)
3. Agent behavior configuration (system prompt, tool access)
4. Billing attribution (already works via proxy audit log)

### Finding 6: What's Currently Disabled That We Need

In our OpenClaw config (`openclaw-sandbox-spec.md`), we explicitly disable messenger-related features:

```json
"tools": {
  "deny": [
    "message",           // ← need to ENABLE for messenger
    "sessions_send",     // ← need to ENABLE for multi-session
    "group:web",         // ← may need for link previews
  ]
}
```

And the gateway config:

```json
"gateway": {
  "mode": "local"  // ← need "gateway" mode with channel config
}
```

For messenger integration, we need a **separate OpenClaw gateway config** that enables channels and messaging tools while still routing LLM calls through our proxy. This is distinct from the sandbox config (which runs in `network=none` containers).

The good news: the gateway service already runs separately from sandboxes. We just need to extend its configuration.

## Recommendation

**Leverage OpenClaw's channel system. Don't build our own.**

The path of least resistance and maximum capability is:

1. **Use OpenClaw gateway as the messenger backbone** — it already has 15+ channel plugins, battle-tested protocol implementations, multi-account support, and message routing.

2. **Extend the `connections` table** (from `proj.tenant-connections`) to store channel credentials — same AEAD encryption, same tenant scoping, but `provider: "openclaw:whatsapp"` and `credential_type: "channel_session"`.

3. **Start with v0: WhatsApp via Baileys** (OpenClaw's `web` channel) — no Meta business verification needed, fully self-hosted, zero WhatsApp-specific code to write. Accept the ToS risk for internal/dev use.

4. **Build a minimal Cogni → OpenClaw channel management bridge** — proxy `channels.status`, login (QR code), and config management through Cogni's API. Expose in UI.

5. **Defer Cogni-mediated message handling (5b) to v1** — for v0, let OpenClaw own the full conversation loop. Cogni provides the LLM proxy (billing), channel config persistence, and UI.

6. **Defer WhatsApp Cloud API to v1** — when/if production commercial use requires official API compliance.

**Trade-offs accepted:**

- v0 uses unofficial WhatsApp protocol (ban risk, ToS violation) — acceptable for internal/DAO use
- v0 has no Cogni-side conversation persistence — messages exist in OpenClaw sessions only
- v0 agents are OpenClaw-native, not Cogni graphs — limits tool integration initially

## Open Questions

1. **OpenClaw licensing**: OpenClaw is published via GHCR image. What license governs its use as a messenger gateway for Cogni tenants? Is there a commercial license concern?

2. **Baileys session state persistence**: OpenClaw stores Baileys auth state in `OPENCLAW_STATE_DIR`. How do we persist this across gateway restarts? Docker volume? Connections table? Need to verify the auth state format and size.

3. **Multi-tenant channel isolation**: Can a single OpenClaw gateway instance serve multiple tenants with separate WhatsApp accounts? Or does each tenant need their own gateway instance? OpenClaw supports multi-account per channel, but tenant isolation (billing, message routing) may require instance-per-tenant.

4. **Inbound message → Cogni event pipeline**: Even in v0 (OpenClaw-native agent), how does Cogni know a conversation happened for billing/audit? The proxy audit log captures LLM calls, but we have no visibility into message content or conversation metadata. Is proxy-level billing sufficient?

5. **Gateway restart impact on WhatsApp sessions**: When the OpenClaw gateway container restarts, do active WhatsApp sessions reconnect automatically? Or does the user need to re-scan the QR code? This affects reliability SLA.

6. **Telegram/Discord/Slack priority**: WhatsApp is v0, but which channel is v0.1? Telegram (bot token, simplest auth) is likely the easiest next step since it just needs a bot token — no QR code, no session state.

## Proposed Layout

### Project: `proj.messenger-integration`

**Goal:** Enable Cogni tenants to connect messaging platforms (WhatsApp, Telegram, etc.) and interact with AI agents via text messages.

**Phases:**

- **Crawl (P0):** OpenClaw gateway channel management — enable channels in gateway config, channel status API, QR login proxy for WhatsApp, channel credential persistence in connections table
- **Walk (P1):** Cogni-mediated messaging — inbound message bridge (OpenClaw → Cogni), Cogni graph execution for messenger conversations, conversation persistence, Telegram bot token channel
- **Run (P2):** WhatsApp Cloud API (official), multi-tenant channel isolation, channel management UI, proactive messaging (Cogni → user), message templates

### Specs

| Spec                                | Purpose                                                                                                                   | Status                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `tenant-connections.md` (extend)    | Add `provider: "openclaw:*"` and `credential_type: "channel_session"` patterns                                            | Existing, needs update  |
| `messenger-channels.md` (new)       | Channel lifecycle, inbound/outbound message flow, OpenClaw gateway bridge invariants, billing for messenger conversations | New                     |
| `openclaw-sandbox-spec.md` (update) | Separate gateway config for messenger mode vs sandbox mode                                                                | Existing, needs section |

### Tasks (rough, PR-sized)

1. **`task.XXXX` — Gateway channel config: enable WhatsApp in OpenClaw gateway compose** — Update gateway config to enable `web` channel, add `channels` section to `openclaw.json` template, verify Baileys connects
2. **`task.XXXX` — Channel status API: proxy `channels.status` through Cogni API** — New endpoint `GET /api/v1/channels/status` that calls OpenClaw gateway WS method
3. **`task.XXXX` — WhatsApp QR login flow: proxy QR through Cogni UI** — New endpoint for `webLoginStart`/`webLoginWait`, UI component showing QR code
4. **`task.XXXX` — Extend connections table for channel credentials** — Add `provider: "openclaw:whatsapp"` support, persist Baileys auth state
5. **`task.XXXX` — Channel management UI page** — Next.js page showing connected channels, status, connect/disconnect actions

### Dependencies

- `proj.tenant-connections` P0 (connection model, AEAD storage) — needed for credential persistence
- `task.0008` (gateway client protocol) — needed for WS communication with OpenClaw gateway
- `task.0019` (gateway auth parameterize) — needed for secure gateway access

### Relationship to Existing Projects

- **`proj.tenant-connections`** — Messenger channels are a new `provider` type in the connections model. P0 of tenant-connections (connection table + broker) should be built first or concurrently.
- **`proj.openclaw-capabilities`** — Messenger integration extends the OpenClaw gateway capabilities. The gateway client work (`task.0008`) is a prerequisite.
- **`proj.sandboxed-agents`** — Separate concern. Sandbox = code agents in `network=none` containers. Messenger = long-running gateway with network access. Different configs, same OpenClaw runtime.

## Related

- [Tenant Connections Spec](../spec/tenant-connections.md) — connectionId model, connection broker
- [Tenant Connections Project](../../work/projects/proj.tenant-connections.md) — AEAD storage, grant intersection roadmap
- [OpenClaw Sandbox Spec](../spec/openclaw-sandbox-spec.md) — current OpenClaw integration (sandbox mode)
- [OpenClaw Sandbox Controls](../spec/openclaw-sandbox-controls.md) — agent registry, credential strategy
- OpenClaw channel plugins: `/Users/derek/dev/openclaw/src/channels/plugins/`
- OpenClaw gateway methods: `/Users/derek/dev/openclaw/src/gateway/server-methods/channels.ts`
