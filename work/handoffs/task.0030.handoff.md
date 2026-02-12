---
id: task.0030.handoff
type: handoff
work_item_id: task.0030
status: active
created: 2026-02-11
updated: 2026-02-11
branch: feat/thread-persistence
last_commit: 4b855d48
---

# Handoff: Thread Persistence P0

## Context

- The platform had **no server-side message persistence** — the client sent full conversation history every request, allowing fabrication of assistant/tool messages
- P0 adds server-authoritative persistence: `ai_threads` table with `UIMessage[]` JSONB, tenant-scoped RLS, optimistic concurrency
- P0 is **backend-only** — the existing client transport (`useDataStreamRuntime` + `createAssistantStreamResponse`) is unchanged
- The route extracts the last user message from client payload, ignores all other client history, loads authoritative thread from DB
- A design review was performed and three high/medium findings were fixed in `97cda922` + `4b855d48`

## Current State

- **Done:** DB schema + migration, `ThreadPersistencePort` + adapter, `uiMessagesToMessageDtos()` mapper, secrets redaction, route refactor with two-phase save, UIMessage accumulator, contract updates, multi-turn stack test
- **Done (review fixes):** Phase 2 persist moved out of `createAssistantStreamResponse` callback (disconnect-safe via deferred promise); `listThreads` uses `jsonb_array_length()` instead of fetching full JSONB; PII-masking renamed to secrets-redaction (`redactSecretsInMessages`)
- **Skipped:** `chat-tool-replay` stack tests — P0 ignores client history; these are P1 (`4219fc31`)
- **Filed:** `bug.0033` (stream controller closed after finalization), `bug.0034` (adopt fast-redact for structured tool-arg redaction)
- **Not done:** Remaining acceptance-check tests (tool persistence, disconnect safety, tenant isolation, billing unchanged, messages-grow-only, thread limit), adapter concurrency unit tests, PR creation
- **`pnpm check` passes** — typecheck, lint, format, unit tests, contract tests, arch check all green

## Decisions Made

- **Optimistic concurrency, NOT FOR UPDATE** — `saveThread()` checks `jsonb_array_length(messages) = expectedMessageCount`; on mismatch throws `ThreadConflictError`, caller retries once. See `fee4a7af`.
- **Two-phase persist** — user message saved before graph execution (phase 1), assistant message saved after pump completion (phase 2). Phase 2 is detached from stream callback via deferred promise (`97cda922`).
- **Secrets redaction, NOT PII masking** — module renamed to `secrets-redaction.ts` with `redactSecretsInMessages()`. Regex targets credentials only. `bug.0034` filed for structured `fast-redact` adoption (`4b855d48`).
- **UIMessage[] JSONB per thread** — not normalized rows; tool parts embedded in assistant message parts
- **stateKey: `nanoid(21)`** — validation tightened to `^[a-zA-Z0-9_-]{1,128}$`
- **MAX_THREAD_MESSAGES = 200** — adapter rejects saves exceeding limit
- Review findings tracked in [task.0030 § Code Review Findings](../items/task.0030.thread-persistence-p0.md)

## Next Actions

- [ ] Write remaining stack/contract tests per spec § Acceptance Checks:
  - [ ] Tool persistence (tool-call parts in persisted UIMessage)
  - [ ] Disconnect safety (phase 2 persist completes despite client abort)
  - [ ] Tenant isolation (user A cannot read user B threads)
  - [ ] Billing unchanged (usage_report still fires correctly)
  - [ ] Messages grow only (optimistic concurrency rejects shrink)
  - [ ] Thread message limit (MAX_THREAD_MESSAGES = 200)
- [ ] Add unit tests for adapter optimistic concurrency paths (conflict, first-write INSERT, race)
- [ ] Run `pnpm check:full` for CI-parity validation
- [ ] Create PR against `staging`

## Risks / Gotchas

- **bug.0033**: `controller.enqueue()` after stream close produces unhandled TypeError. Persistence works despite this — bug is in stream finalization only.
- **Two-phase save means user message persists even if execution fails** — intentional (the user DID send it).
- **Stack test depends on working LiteLLM mock** — `test-model` auth must work for stream to complete and phase 2 persist to fire.
- **Secrets redaction is best-effort regex** — stored content must still be treated as sensitive via RLS + retention. `bug.0034` tracks structured redaction improvement.
- **`softDelete`/`listThreads` not called by route in P0** — present in port for completeness but exercised only by future UI.

## Pointers

| File / Resource                                                                                                                          | Why it matters                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [`docs/spec/thread-persistence.md`](../../docs/spec/thread-persistence.md)                                                               | Canonical spec — invariants, schema, port, acceptance checks         |
| [`work/items/task.0030.thread-persistence-p0.md`](../items/task.0030.thread-persistence-p0.md)                                           | Task with deliverables, scope boundaries, review findings            |
| [`src/app/api/v1/ai/chat/route.ts`](../../src/app/api/v1/ai/chat/route.ts)                                                               | Chat route — two-phase save, UIMessage accumulator, detached persist |
| [`src/ports/thread-persistence.port.ts`](../../src/ports/thread-persistence.port.ts)                                                     | Port interface + `ThreadConflictError`                               |
| [`src/adapters/server/ai/thread-persistence.adapter.ts`](../../src/adapters/server/ai/thread-persistence.adapter.ts)                     | Optimistic concurrency adapter                                       |
| [`src/features/ai/services/mappers.ts`](../../src/features/ai/services/mappers.ts)                                                       | `uiMessagesToMessageDtos()` — UIMessage[] → MessageDto[]             |
| [`src/features/ai/services/secrets-redaction.ts`](../../src/features/ai/services/secrets-redaction.ts)                                   | `redactSecretsInMessages()` — credential redaction before persist    |
| [`packages/db-schema/src/ai-threads.ts`](../../packages/db-schema/src/ai-threads.ts)                                                     | Drizzle schema for `ai_threads` table                                |
| [`tests/stack/ai/thread-persistence.stack.test.ts`](../../tests/stack/ai/thread-persistence.stack.test.ts)                               | Multi-turn persistence stack test                                    |
| [`work/items/bug.0033.stream-controller-closed-after-finalization.md`](../items/bug.0033.stream-controller-closed-after-finalization.md) | Related bug — controller lifecycle                                   |
| [`work/items/bug.0034.adopt-fast-redact-for-structured-secrets.md`](../items/bug.0034.adopt-fast-redact-for-structured-secrets.md)       | Follow-up — structured redaction                                     |
