---
id: task.0023
type: task
title: "Gateway agent system prompt — dedicated workspace, SOUL.md, and upstream heartbeat prompt fix"
status: Todo
priority: 0
estimate: 2
summary: The OpenClaw gateway agent reads the wrong AGENTS.md (repo root coding-agent meta-prompt), has no SOUL.md, and OpenClaw injects HEARTBEAT_OK instructions into every non-minimal system prompt regardless of heartbeat config. The LLM hallucinates HEARTBEAT_OK as a chat response because the system prompt tells it to.
outcome: Gateway agent has a dedicated workspace with purpose-built AGENTS.md + SOUL.md; heartbeat instructions are absent from the system prompt when heartbeats are disabled; the LLM never hallucinates HEARTBEAT_OK.
spec_refs: openclaw-sandbox-spec
assignees: derekg1729
credit:
project: proj.openclaw-capabilities
branch:
pr:
reviewer:
created: 2026-02-11
updated: 2026-02-11
labels: [openclaw, correctness, system-prompt]
external_refs:
---

# Gateway agent system prompt — dedicated workspace, SOUL.md, and upstream heartbeat prompt fix

## Requirements

### Problem

Three compounding issues cause the gateway agent to produce bad responses:

1. **Wrong AGENTS.md**: The gateway agent workspace is `/repo/current` (the full Cogni repo). OpenClaw reads `AGENTS.md` from workspace root — this is our repo-wide coding-agent meta-prompt (`pnpm check`, "spec first", API contracts, etc.), not appropriate for a chat agent.

2. **No SOUL.md**: No personality file exists. OpenClaw's default persona is generic.

3. **HEARTBEAT_OK in system prompt**: OpenClaw `src/agents/system-prompt.ts:590-600` unconditionally injects heartbeat instructions into every non-minimal session:
   ```
   ## Heartbeats
   <heartbeat prompt>
   If you receive a heartbeat poll... reply exactly:
   HEARTBEAT_OK
   ```
   This is guarded by `promptMode` (not `heartbeat.every`), so `heartbeat.every: "0"` disables the runner but leaves the instruction in the prompt. The LLM (confirmed: gemini-2.5-flash) hallucinates HEARTBEAT_OK as a chat response.

### Acceptance Criteria

- [ ] Gateway agent has a **dedicated workspace directory** with its own `AGENTS.md` and `SOUL.md` — does NOT read the repo root `AGENTS.md`
- [ ] `AGENTS.md` is appropriate for a chat agent (not a coding-agent meta-prompt)
- [ ] `SOUL.md` defines the agent personality (concise, helpful, technical)
- [ ] The system prompt seen by the LLM does NOT contain `HEARTBEAT_OK` or heartbeat instructions
- [ ] Upstream OpenClaw PR filed (or local workaround applied) to make heartbeat prompt section conditional
- [ ] Manual test: send 5 rapid follow-up messages via UI, zero HEARTBEAT_OK responses

## Allowed Changes

### Cogni repo (this PR)

- `services/sandbox-openclaw/gateway-workspace/` — new directory: `AGENTS.md`, `SOUL.md`
- `services/sandbox-openclaw/openclaw-gateway.json` — update `agents.list[0].workspace` path
- `services/sandbox-openclaw/openclaw-gateway.test.json` — same
- `docker-compose*.yml` — add volume mount for gateway workspace dir if needed
- `services/sandbox-openclaw/AGENTS.md` — update to document gateway workspace

### OpenClaw repo (upstream PR, separate)

- `src/agents/system-prompt.ts` — make heartbeat section conditional on heartbeat being enabled
- `src/agents/pi-embedded-runner/run/attempt.ts` — pass heartbeat-enabled flag to prompt builder

## Plan

### Part A: Gateway workspace (this repo)

- [ ] Create `services/sandbox-openclaw/gateway-workspace/AGENTS.md` — chat-appropriate operating instructions (sandbox constraints, no internet, LLM routes through proxy, focus on user's question)
- [ ] Create `services/sandbox-openclaw/gateway-workspace/SOUL.md` — personality (concise, technical, helpful)
- [ ] Update `openclaw-gateway.json`: change `agents.list[0].workspace` from `/repo/current` to `/workspace/gateway` (or similar path inside container)
- [ ] Update `openclaw-gateway.test.json`: same workspace change
- [ ] Update compose volume mounts: bind-mount `services/sandbox-openclaw/gateway-workspace/` into the gateway container at the workspace path
- [ ] Verify: `docker restart openclaw-gateway && docker exec openclaw-gateway cat /workspace/gateway/AGENTS.md` shows the new file
- [ ] Manual test: send 5 messages via UI, verify responses are coherent and HEARTBEAT_OK-free

### Part B: Upstream OpenClaw fix (separate PR in openclaw repo)

- [ ] In `src/agents/system-prompt.ts:589-600`: wrap heartbeat section in a check for whether heartbeat is actually enabled (e.g., pass `heartbeatEnabled: boolean` to `buildAgentSystemPrompt`)
- [ ] In `src/agents/pi-embedded-runner/run/attempt.ts`: resolve heartbeat config and pass `heartbeatEnabled: resolvedInterval != null` (or `resolvedInterval > 0`)
- [ ] Test: with `heartbeat.every: "0"`, system prompt must NOT contain `HEARTBEAT_OK`
- [ ] File PR in `openclaw` repo

## Validation

**Command (after Part A):**

```bash
# Verify workspace files mounted
docker restart openclaw-gateway && sleep 5
docker exec openclaw-gateway cat /workspace/gateway/AGENTS.md
docker exec openclaw-gateway cat /workspace/gateway/SOUL.md

# Verify heartbeat still disabled
docker logs openclaw-gateway 2>&1 | grep -i heartbeat
# Expected: "heartbeat: disabled"

# Manual UI test: send 5 rapid messages, check for HEARTBEAT_OK
```

**Expected:** Workspace files present, heartbeat disabled, zero HEARTBEAT_OK in responses.

## Review Checklist

- [ ] **Work Item:** `task.0023` linked in PR body
- [ ] **Spec:** Workspace behavior files match spec guidance (openclaw-sandbox-spec.md lines 518-548)
- [ ] **Tests:** Manual validation (5-message rapid-fire, zero HEARTBEAT_OK)
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Related: bug.0021 (HEARTBEAT_OK contamination root cause), task.0008 (gateway protocol lifecycle)
- OpenClaw system prompt: `src/agents/system-prompt.ts:590-600`
- OpenClaw heartbeat prompt resolution: `src/auto-reply/heartbeat.ts:54-57`
- Spec reference: `docs/spec/openclaw-sandbox-spec.md:518-548` (workspace behavior files)

## Attribution

- Investigation: claude-opus-4.6 + derekg1729
