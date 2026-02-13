---
id: task.0041
type: task
title: Discord channel proof of life — bot connected, Cogni reads + sends via OpenClaw gateway
status: Todo
priority: 0
estimate: 2
summary: Create a Discord bot, enable channel support in the OpenClaw gateway config, connect the bot, and verify Cogni can receive inbound Discord messages and send AI responses in a group channel
outcome: A Discord bot is live in a server channel; inbound messages route to the OpenClaw agent; agent responds via the LLM proxy; billing is captured in the proxy audit log
spec_refs: messenger-channels
assignees:
  - derekg1729
credit:
project: proj.messenger-channels
branch:
pr:
reviewer:
created: 2026-02-13
updated: 2026-02-13
labels: [openclaw, messenger, discord, channels]
external_refs:
---

# Discord Channel Proof of Life — Bot Connected, Cogni Reads + Sends via OpenClaw Gateway

## Requirements

- A Discord bot application exists (created via Discord Developer Portal)
- Gateway config (`openclaw-gateway.json`) has a `channels:` section with Discord enabled
- `message` and `sessions_send` removed from tool deny list in gateway config
- Gateway compose service has a named Docker volume for `OPENCLAW_STATE_DIR` (not `/tmp` — per spec STATE_DIR_VOLUME_REQUIRED)
- The bot token is passed to the gateway via environment variable (not hardcoded in config)
- The bot joins a Discord server and listens in a group channel
- Inbound messages in the channel route to the OpenClaw agent
- The agent calls the LLM via `llm-proxy-openclaw:8080` and responds in-channel
- LLM calls appear in the proxy audit log with billing headers (per spec MESSENGER_BILLING_VIA_PROXY)
- Gateway restart reconnects the Discord bot automatically (per spec GATEWAY_RESTART_RECONNECTS)

**Not in scope for this task:**

- Cogni HTTP proxy endpoints (`/api/v1/channels/*`) — separate task
- `channel_registrations` DB table — separate task
- AES-256-GCM credential encryption — separate task
- Channel management UI — separate task
- Multi-tenant accountId namespacing — single-tenant proof of life only
- Individual user DM auth — group channel is sufficient

## Allowed Changes

- `services/sandbox-openclaw/openclaw-gateway.json` — add `channels:` section, update `tools.deny`
- `services/sandbox-openclaw/openclaw-gateway.test.json` — mirror changes (parity)
- `platform/infra/services/runtime/docker-compose.yml` — add named volume for STATE_DIR, update `openclaw-gateway` env
- `platform/infra/services/runtime/docker-compose.dev.yml` — mirror compose changes
- `src/shared/env/server.ts` — add `DISCORD_BOT_TOKEN` env var (optional, for gateway injection)
- `.env.local.example` — document new env var
- `docs/spec/messenger-channels.md` — update Open Questions if resolved during this work

## Plan

- [ ] **1. Create Discord bot application** (manual, Discord Developer Portal)
  - Go to https://discord.com/developers/applications
  - Create new application, add Bot
  - Enable "Message Content Intent" in Bot settings (required to read message text)
  - Generate bot token — store in `.env.local` as `DISCORD_BOT_TOKEN`
  - Generate invite URL with permissions: Send Messages, Read Message History, Read Messages
  - Invite bot to a test Discord server

- [ ] **2. Update gateway config — enable Discord channel**
  - In `openclaw-gateway.json`, add `channels:` section:
    ```json
    "channels": {
      "discord": {
        "enabled": true,
        "accounts": {
          "default": {
            "token": "${DISCORD_BOT_TOKEN}"
          }
        }
      }
    }
    ```
  - Remove `"message"` and `"sessions_send"` from `tools.deny`
  - Keep `"sessions_spawn"` denied (no sub-agents needed)
  - Mirror changes in `openclaw-gateway.test.json`

- [ ] **3. Update compose — STATE_DIR volume + bot token env**
  - In `docker-compose.yml` and `docker-compose.dev.yml`:
    - Add named volume `openclaw_state` (or similar)
    - Mount to `OPENCLAW_STATE_DIR` path in `openclaw-gateway` service
    - Replace `/tmp/openclaw-state` with the named volume mount path
    - Add `DISCORD_BOT_TOKEN` to gateway service environment (passed through from host)
  - Add volume to the `volumes:` top-level section

- [ ] **4. Verify gateway starts with channel enabled**
  - `pnpm dev:stack` (or `docker compose up` in runtime dir)
  - Check gateway logs for Discord channel initialization
  - Confirm bot appears "Online" in the Discord server

- [ ] **5. Test inbound message → agent response**
  - Send a message in the Discord channel mentioning the bot (or DM if configured)
  - Verify OpenClaw routes the message to the `main` agent
  - Verify the agent calls the LLM via the proxy
  - Verify the bot responds in the Discord channel
  - Check proxy audit log for the LLM call with billing headers

- [ ] **6. Test gateway restart reconnect**
  - `docker compose restart openclaw-gateway`
  - Wait for reconnect (~5-10s)
  - Send another Discord message
  - Verify response works without re-configuring the bot

- [ ] **7. Document env var in .env.local.example**
  - Add `DISCORD_BOT_TOKEN=` with comment explaining where to get it

## Validation

**Command:**

```bash
# Start the stack with Discord bot token
DISCORD_BOT_TOKEN=<token> pnpm dev:stack

# Check gateway logs for Discord channel start
docker logs cogni-openclaw-gateway 2>&1 | grep -i discord

# After sending a Discord message, check proxy audit log
docker exec cogni-llm-proxy-openclaw cat /tmp/audit.log | tail -5
```

**Expected:**

- Gateway logs show Discord channel starting and connecting
- Discord bot responds to messages in the server channel
- Proxy audit log shows LLM call with `x-litellm-end-user-id` header
- After `docker compose restart openclaw-gateway`, bot reconnects and responds again

## Review Checklist

- [ ] **Work Item:** `task.0041` linked in PR body
- [ ] **Spec:** CHANNELS_ENABLED_IN_GATEWAY, STATE_DIR_VOLUME_REQUIRED, GATEWAY_RESTART_RECONNECTS, MESSENGER_BILLING_VIA_PROXY upheld
- [ ] **Tests:** Manual verification documented (no automated tests for this infra-only task)
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
