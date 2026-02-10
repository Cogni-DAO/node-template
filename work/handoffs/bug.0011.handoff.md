---
id: bug.0011.handoff
type: handoff
work_item_id: bug.0011
status: active
created: 2026-02-10
updated: 2026-02-10
branch: feat/concurrent-openclaw
last_commit: b320e206
---

# Handoff: Gateway Streaming Truncation (bug.0011)

## Context

- OpenClaw gateway chat responses are truncated mid-sentence in the Cogni UI
- Root cause: `route.ts` silently dropped `assistant_final` events — the authoritative full text from `AiEvent` contract (`ASSISTANT_FINAL_REQUIRED`) was never delivered to the client
- Gateway client's diff-based delta logic (`openclaw-gateway-client.ts:282-295`) loses text across multi-turn LLM calls when accumulated text resets between turns
- LangGraph inproc is unaffected — its deltas are reliable, so `assistant_final` reconciliation is a no-op
- Reconciliation fix is committed and tested (6/6 contract tests), but gateway deltas are still fundamentally broken for multi-turn (P0 remaining)

## Current State

- **Committed** (`b320e206`): route.ts captures `assistant_final`, appends remainder if deltas are a prefix, logs error if missing, flush barrier before `message-finish`
- **Committed** (`299d3a1f`): gateway client WS `terminalSeen` tracking + proxy timeout 300s→3600s
- **Contract test** 6/6 passing: truncated, full-delivery, severely truncated, zero-delta, no-final, usage propagation
- **Real-stack validated**: reconciliation fires correctly (logs confirm `ai.chat_reconcile_appending_remainder`)
- **NOT fixed**: gateway client produces `accLen:0` in multi-turn (zero progressive streaming — user sees blank, then full text dump at end)
- **NOT fixed**: possible agent input poisoning — multi-turn agent returned JSON parse error, may be receiving corrupted chat history
- **NOT fixed**: hardcoded `openclaw-internal-token` — OpenClaw supports `${VAR}` substitution in config natively; use compose env + gitignored `.env` instead of custom renderer

## Decisions Made

- `assistant_final` is authoritative per `AiEvent` contract (`packages/ai-core/src/events/ai-events.ts:74-86`) — route.ts is the translator, not the client
- Server-side prefix-check reconciliation chosen over client-side SSE overwrite — keeps fix at the `AiEvent→SSE` boundary without protocol changes
- Flush barrier (`setTimeout(0)`) required before `message-finish` — ReadableStream backpressure can drop reconciliation text

## Next Actions

- [ ] Fix gateway client delta logic for multi-turn: `prevText` reset at line 285 causes zero deltas when accumulated text resets between turns
- [ ] Investigate agent input poisoning: multi-turn agent returned JSON parse error as response — check what chat history is sent
- [ ] Parameterize gateway auth token: set `gateway.auth.token` to `"${OPENCLAW_GATEWAY_TOKEN}"` in `openclaw-gateway.json`, provide via compose env / `.env` (gitignored). OpenClaw expands `${VAR}` at config load. Guard against config writeback expanding secrets (see OpenClaw issue #9813)
- [ ] CI: build `cogni-sandbox-openclaw` image + start `sandbox-openclaw` compose profile in stack-test job
- [ ] CI: gateway stack tests (`sandbox-openclaw.stack.test.ts`) currently local-only, blocked by above

## Risks / Gotchas

- Reconciliation only works for prefix case — if deltas and final diverge (multi-turn chain-of-thought), it logs `ai.chat_reconcile_content_diverged` but cannot fix the text
- OpenClaw config writeback can expand `${VAR}` to plaintext — ensure config file is read-only or use `$include` for secret-bearing fields
- The 1 failing stack test (`sandbox-llm-roundtrip-billing`) is pre-existing (ephemeral billing), not related to this work

## Pointers

| File / Resource                                                  | Why it matters                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| `src/app/api/v1/ai/chat/route.ts:461-590`                        | The fix: `assistant_final` handler + reconciliation + flush barrier |
| `tests/contract/app/ai.chat.sse-reconciliation.test.ts`          | Contract test enforcing SSE text === `assistant_final` content      |
| `src/adapters/server/sandbox/openclaw-gateway-client.ts:282-295` | Diff-based delta logic — the source of multi-turn text loss         |
| `packages/ai-core/src/events/ai-events.ts:74-86`                 | `AssistantFinalEvent` type + `ASSISTANT_FINAL_REQUIRED` invariant   |
| `src/adapters/server/sandbox/sandbox-graph.provider.ts:430-488`  | `createGatewayExecution()` — yields deltas then `assistant_final`   |
| `services/sandbox-openclaw/openclaw-gateway.json:58`             | Hardcoded auth token to parameterize                                |
| `work/items/bug.0011.gateway-streaming-truncation.md`            | Canonical bug with root cause, fix details, real-stack validation   |
| `work/projects/proj.openclaw-capabilities.md`                    | Gateway Service Operations table — CI/CD roadmap                    |
