---
id: task.0077
type: task
title: "Discord billing user attribution — identify which Discord user triggered each LLM call"
status: needs_triage
priority: 2
estimate: 2
summary: Discord messages currently bypass Cogni's per-user billing — all LLM costs are charged to the system Cogni account with no attribution to the Discord user who triggered the run. Need to propagate Discord user identity into the LLM proxy billing metadata so costs are traceable per user.
outcome: "Each LLM call triggered by a Discord message carries the Discord user ID in billing metadata (x-litellm-spend-logs-metadata). Cost-per-Discord-user queries work in the billing dashboard."
spec_refs: messenger-channels
assignees:
  - derekg1729
credit:
project: proj.messenger-channels
branch:
pr:
reviewer:
created: 2026-02-16
updated: 2026-02-16
labels: [openclaw, discord, billing, channels]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 13
---

# Discord Billing User Attribution

## Requirements

### Problem

Discord messages route through OpenClaw directly to the LLM proxy. All costs land on the system Cogni account with no record of which Discord user triggered the run. This is fine while we're small and want users, but creates two risks:

1. **No cost visibility** — can't tell if one user is burning $50/day
2. **No rate limiting lever** — can't throttle or tier individual Discord users
3. **Abuse vector** — anyone in the Discord can trigger unlimited LLM calls

### Solution Tiers

**Tier 1 (now):** Propagate Discord user ID into LLM proxy billing metadata. Read-only — just attribution, no enforcement. This lets us query cost-per-user after the fact.

**Tier 2 (later):** Enforce per-user budgets or route high-cost users to cheaper models. Could be as simple as: the Discord community agent uses `cogni/gpt-4o-mini` (free tier model) by default, and only escalates to expensive models for recognized/approved users.

**Tier 3 (much later):** Full Cogni account linking — Discord users pair with a Cogni billing account, and costs flow to their account. Requires the pairing flow that OpenClaw already supports (`openclaw pairing approve discord <code>`).

### This Task = Tier 1

- OpenClaw's message handler already extracts `author.id` (Discord user snowflake) from each message
- This identity needs to flow into the LLM proxy headers as `x-litellm-spend-logs-metadata` with a `discord_user_id` field
- OpenClaw's `spend_logs_metadata` is configurable per-session — need to confirm it propagates the message author, not just the bot identity

**Not in scope:**

- Per-user rate limiting or budget enforcement (Tier 2)
- Cogni account pairing (Tier 3)
- Changes to the Cogni billing UI (just get the data flowing first)

## Investigation Needed

- How does OpenClaw set `x-litellm-spend-logs-metadata` for Discord-initiated sessions? Check `src/discord/monitor/message-handler.ts` and the session creation path
- Does the current proxy billing pipeline (`LlmProxyManager` → `parseAuditLog`) already capture per-session metadata that includes user identity?
- Can we configure this purely via `openclaw-gateway.json` or does it need a code change in OpenClaw?

## Allowed Changes

- `services/sandbox-openclaw/openclaw-gateway.json` — billing metadata config if supported
- `services/sandbox-openclaw/openclaw-gateway.test.json` — mirror
- OpenClaw upstream issue/PR if code changes needed in OpenClaw itself

## Validation

```bash
# Send a Discord message as a known user
# Check proxy audit log for user attribution
docker exec cogni-llm-proxy-openclaw cat /tmp/audit.log | python3 -c "
import sys, json
for line in sys.stdin:
    entry = json.loads(line)
    meta = entry.get('metadata', {})
    if 'discord_user_id' in str(meta):
        print(json.dumps(meta, indent=2))
"
```

**Expected:** Audit log entries from Discord-triggered runs include `discord_user_id` matching the sender's snowflake.

## PR / Links

- Related: task.0048 (sub-agent billing attribution — separate but complementary)
- Related: bug.0066 (LiteLLM zero-cost billing — needs to be fixed for any billing to matter)
- Project: [proj.messenger-channels](../projects/proj.messenger-channels.md)

## Attribution

-
