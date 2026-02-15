---
id: bug.0069
type: bug
title: Stack tests flaky — all 5 waitForReceipts tests time out when run as full suite
status: Backlog
priority: 1
estimate: 2
summary: The 5 stack tests that poll for async LiteLLM billing callbacks via waitForReceipts() pass in isolation but intermittently time out during full suite runs due to callback latency accumulation.
outcome: Full stack test suite passes reliably without flaky billing test failures
spec_refs: []
assignees: []
credit:
project:
branch:
pr:
reviewer:
created: 2026-02-15
updated: 2026-02-15
labels: [testing, billing, flaky]
external_refs:
---

# Stack tests flaky — all 5 waitForReceipts tests time out when run as full suite

## Requirements

### Observed

Exactly 5 stack tests fail intermittently when run as the full 45-file suite. They share a single trait: all use `waitForReceipts()` (`tests/helpers/poll-db.ts:34`) to poll the DB for charge_receipt rows written by the async LiteLLM `generic_api` callback (POST to `/api/internal/billing/ingest`).

**Failing tests:**

1. `tests/stack/ai/billing-idempotency.stack.test.ts:43` — 10s timeout
2. `tests/stack/ai/chat-streaming.stack.test.ts:201` — 8s `waitForReceipts` within 10s test timeout
3. `tests/stack/ai/completion-billing.stack.test.ts:107` — 30s `waitForReceipts` within 45s test timeout
4. `tests/stack/ai/streaming-side-effects.stack.test.ts:53` — 10s timeout
5. `tests/stack/internal/internal-runs-billing.stack.test.ts:56` — 10s timeout

**Error pattern (identical for all 5):**

```
waitForReceipts: timed out after Xms — expected ≥1 receipts for billing account <id>, found 0.
This likely means the LiteLLM callback (POST /api/internal/billing/ingest) did not fire.
```

**Key evidence:**

- All 5 pass when run in isolation: `pnpm dotenv -e .env.test -- npx vitest run <file> --config vitest.stack.config.mts`
- All 5 pass when run together (just the 5 files)
- All 5 intermittently fail during full 45-test suite run
- `completion-billing` has a generous 30s polling timeout and STILL fails — this is not merely a tight timeout issue
- No other stack tests use `waitForReceipts` — the 5 failing tests are exactly the 5 consumers
- When run in isolation, these tests complete in 1.5–5.2s (well within timeouts)

### Expected

Full stack test suite (`pnpm dotenv -e .env.test -- npx vitest run --config vitest.stack.config.mts`) should pass reliably on every run, including the 5 billing callback tests.

### Root Cause Analysis

The tests depend on an **out-of-process async callback chain**:

```
test (in-process) → Next.js route handler (in-process)
    → LiteLLM proxy (Docker container) → mock-llm (Docker container)
    → LiteLLM success_callback (Docker → app server HTTP POST)
    → /api/internal/billing/ingest writes charge_receipt to DB
    → waitForReceipts polls DB
```

When 45 tests run sequentially (`vitest.stack.config.mts:51` sets `sequence: { concurrent: false }`), earlier AI tests (e.g., `ai-telemetry`, `chat-model-validation`, `litellm-call-id-mapping`) also make LLM calls through LiteLLM. Under cumulative load:

1. **LiteLLM callback queue backs up** — the `generic_api` success_callback fires asynchronously after each LLM response. Queued callbacks from prior tests may delay delivery for current test.
2. **Event loop contention** — test runs in-process Next.js route handlers while the external LiteLLM callback needs the same Node.js event loop to serve its HTTP POST.
3. **DB is reset only once** (`tests/stack/setup/reset-db.ts`) at suite start — no per-test cleanup. Late-arriving callbacks from prior tests could write stale receipts.

The intermittent nature confirms this is a timing/resource contention issue, not a logic bug.

### Impact

- **CI reliability**: Flaky failures require manual reruns, slowing development
- **Developer trust**: Engineers stop trusting the test suite and may ignore real failures
- **Billing invariant coverage**: These 5 tests guard critical invariants (CALLBACK_IS_SOLE_WRITER, IDEMPOTENT_CHARGES, STREAMING_SIDE_EFFECTS_ONCE)

## Allowed Changes

- `tests/helpers/poll-db.ts` — increase timeouts, add backoff, improve diagnostics
- `tests/stack/ai/*.stack.test.ts` — adjust test-level timeouts
- `tests/stack/internal/internal-runs-billing.stack.test.ts` — adjust test-level timeout
- `vitest.stack.config.mts` — test ordering, pool configuration
- New: `tests/stack/setup/drain-litellm-callbacks.ts` — optional globalSetup/teardown to drain pending callbacks between files

## Plan

- [ ] **Quick fix — increase timeouts**: Set `waitForReceipts` default to 30s and test-level timeouts to 45s for all 5 affected tests. This is a band-aid but immediately reduces flake rate.
- [ ] **Add diagnostic logging to waitForReceipts**: On timeout, log the LiteLLM container health and last callback timestamps to distinguish "callback never fired" from "callback arrived late"
- [ ] **Investigate callback drain**: After each test file that makes LLM calls, add a brief drain period (e.g., 2s sleep in afterAll) to let pending LiteLLM callbacks settle before the next file runs
- [ ] **Long-term: consider in-process callback mode for tests**: Instead of relying on the async Docker→app HTTP callback, have tests call the billing ingest endpoint directly with the expected payload after the LLM call completes. This eliminates the async gap entirely but requires refactoring the 5 tests.

## Validation

**Command:**

```bash
# Run full suite 3 times — all must pass
for i in 1 2 3; do
  pnpm dotenv -e .env.test -- npx vitest run --config vitest.stack.config.mts || exit 1
done
```

**Expected:** All 45 test files pass on all 3 runs.

## Review Checklist

- [ ] **Work Item:** `bug.0069` linked in PR body
- [ ] **Spec:** billing invariants (CALLBACK_IS_SOLE_WRITER, IDEMPOTENT_CHARGES) still verified
- [ ] **Tests:** flaky tests stabilized without reducing coverage
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Related: bug.0013 (sandbox stack tests flaky — separate issue, Docker container disappearance)

## Attribution

- Reported: derekg1729
- Investigation: Claude Code agent
