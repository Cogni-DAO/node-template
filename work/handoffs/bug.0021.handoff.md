---
id: "bug.0021.handoff"
type: handoff
work_item_id: "bug.0021"
status: active
created: 2026-02-11
updated: 2026-02-11
branch: "fix/openclaw-gateway-connectivity"
last_commit: "cb7cc3d0"
---

# Handoff: Gateway WS event isolation — HEARTBEAT_OK contamination fix

## Context

- OpenClaw gateway broadcasts `chat` events to **all** connected WS clients via `broadcast("chat", payload)` in `server-chat.ts:251`. Our client processed every chat event without filtering, so heartbeat runs, other users' runs, or any concurrent agent activity could leak into any user's response stream.
- The heartbeat mechanism (`heartbeat-wake.ts`) retries every 1 second when the agent lane is busy. The moment a user's call completes, the queued heartbeat fires immediately, causing `HEARTBEAT_OK` to appear as the chat response (~30-50% of rapid follow-up messages).
- Fix strategy: (1) disable heartbeats in config, (2) hard-filter chat events by `sessionKey` — fail closed, no defense-in-depth token stripping.
- Work item: `bug.0021` — P0 correctness and isolation violation.

## Current State

- **Done — config fix**: `heartbeat.every: "0"` added to `agents.defaults` in both `openclaw-gateway.json` and `openclaw-gateway.test.json`. This disables the heartbeat runner entirely (`resolveHeartbeatIntervalMs` returns `null` for `ms <= 0`).
- **Done — client sessionKey filter**: `sessionKey` is now **required** in `RunAgentOptions` (TypeScript compile-time enforcement). The chat event handler in `runAgent()` drops any frame where `payload.sessionKey` is missing or doesn't match `opts.sessionKey`. Fail-closed — no fallback.
- **Done — params always include sessionKey**: `sessionKey` is always sent in the `agent.chat` request params (was previously conditional).
- **Not done — cross-run isolation test**: Need 1 unit test simulating two concurrent WS sessions with interleaved chat events, asserting zero cross-run tokens. See task #4 in the plan.
- **Not done — final validation**: `pnpm check`, work item status update, `_index.md` project column fix.
- **Not committed**: All changes are staged but no commit has been created yet.

## Decisions Made

- **Fail-closed filtering** (user directive): if `opts.sessionKey` is absent → compile error (required field). If `payload.sessionKey` is absent → drop frame. If mismatch → drop frame. No silent skip.
- **No HEARTBEAT_OK token stripping** (user directive): user explicitly rejected defense-in-depth stripping. The sessionKey filter is the single mechanism.
- **sessionKey over runId**: `sessionKey` chosen as the correlation key because it's more specific (`agent:main:${billingAccountId}:${runId}`) and is already constructed by `sandbox-graph.provider.ts:458`.
- Bug.0021 plan P1 items (concurrency isolation test, heartbeat contamination regression test) are follow-up — not in scope for this PR.

## Next Actions

- [ ] Write cross-run isolation test: two simulated WS sessions, interleaved chat events with different sessionKeys, assert each client receives only its own events (zero cross-run tokens)
- [ ] Run `pnpm check` — verify clean state (two pre-existing failures in `scripts/` format and `.worktrees` root-layout are known and unrelated)
- [ ] Update `bug.0021` status to `In Progress`, set `project: proj.openclaw-capabilities`
- [ ] Update `_index.md` — ensure bug.0021 row has correct project column
- [ ] Run `pnpm lint:fix && pnpm format` on all touched files
- [ ] Commit all changes
- [ ] Run `/review-implementation bug.0021` before PR

## Risks / Gotchas

- **OpenClaw broadcasts are unauthenticated by sessionKey** — the gateway does not restrict which WS clients receive which chat events. All isolation is client-side. If a future OpenClaw update changes the payload shape (removes `sessionKey` from chat events), the filter will silently drop ALL events. Monitor for this.
- **Only one caller exists** (`sandbox-graph.provider.ts:481`) — `sessionKey` is always provided there. If new callers are added, TypeScript will enforce the required field, but the session key must be constructed correctly.
- **Pre-existing test failures**: `pnpm check` has 2 known failures unrelated to this work (scripts/ formatting, .worktrees root-layout). Don't chase these.

## Pointers

| File / Resource                                                     | Why it matters                                                    |
| ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `src/adapters/server/sandbox/openclaw-gateway-client.ts:297-315`    | Chat event filter — the core fix. `WS_EVENT_CAUSALITY` invariant. |
| `src/adapters/server/sandbox/sandbox-graph.provider.ts:458,481`     | Only caller — constructs sessionKey and passes it to `runAgent()` |
| `services/sandbox-openclaw/openclaw-gateway.json:159-164`           | Heartbeat disable config                                          |
| `work/items/bug.0021.ws-event-isolation-heartbeat-contamination.md` | Full root cause analysis, plan, and validation steps              |
| OpenClaw `src/gateway/server-chat.ts:230-252`                       | Upstream broadcast mechanism — confirms `sessionKey` in payload   |
| OpenClaw `src/infra/heartbeat-wake.ts:39-43`                        | 1-second retry loop causing the race condition                    |
