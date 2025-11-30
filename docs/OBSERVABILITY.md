# Observability: Structured Logging

**Status:** V1 complete (AI completion instrumented), V2 deferred (log collection)

**Purpose:** Centralized Pino logging with request context, stable event schemas, and stdout JSON for collector-based shipping.

---

## 1. Implementation Checklist

### V1: Structured Logging Foundation

**Module Structure:**

- [x] `shared/observability/logging/logger.ts` - makeLogger, makeNoopLogger
- [x] `shared/observability/logging/redact.ts` - Security-sensitive paths
- [x] `shared/observability/logging/events.ts` - AI + Payments event schemas
- [x] `shared/observability/logging/helpers.ts` - logRequestStart/End/Error
- [x] `shared/observability/context/types.ts` - RequestContext + structural Clock
- [x] `shared/observability/context/factory.ts` - createRequestContext with reqId validation
- [x] `shared/observability/index.ts` - Unified entry point

**Container:**

- [x] Add `log: Logger` to Container interface
- [x] Singleton: `getContainer()` + `resetContainer()`
- [x] Startup log: `{ env, logLevel, pretty }`
- [x] Replace `createContainer()` calls with `getContainer()`

**AI Completion:**

- [x] Instrument `app/api/v1/ai/completion/route.ts` with request/error logging
- [x] Update `app/_facades/ai/completion.server.ts` to accept/enrich ctx
- [x] Update `features/ai/services/completion.ts` to log LLM calls with AiLlmCallEvent
- [x] Remove console.log/error calls

**Tests:**

- [x] Update container.spec.ts for singleton pattern
- [x] Update facade/feature tests to pass ctx parameter
- [x] All tests use makeNoopLogger()
- [x] Remove console.log from adapters (DB, LiteLLM, Fake)

**Payments Routes (Deferred):**

- [ ] `app/api/v1/payments/intents/route.ts` (routeId: "payments.intents")
- [ ] `app/api/v1/payments/credits/summary/route.ts` (routeId: "payments.credits_summary")
- [ ] `app/api/v1/payments/credits/confirm/route.ts` (routeId: "payments.credits_confirm")
- [ ] `app/api/v1/payments/attempts/[id]/route.ts` (routeId: "payments.attempt_status")
- [ ] `app/api/v1/payments/attempts/[id]/submit/route.ts` (routeId: "payments.attempt_submit")

---

### V2: Log Collection (Deferred)

- [ ] Wire Promtail scrape config for app container
- [ ] Configure Docker socket mounts + labels
- [ ] Add JSON pipeline stages
- [ ] Validate logs in Loki
- [ ] Create Grafana dashboards
- [ ] Add alerting rules

---

## 2. Architecture

**Observability Layer:** `src/shared/observability/`

- Cross-cutting concern (logging, context, events)
- Imports allowed: `@/shared/auth`, `@/shared/env`
- Imports prohibited: `@/ports`, `@/bootstrap`, `@/core`, `@/features`
- Structural Clock: `{ now(): string }` - ports/Clock satisfies this

**RequestContext:**

- Type: `{ log, reqId, session?, clock }`
- Factory: `createRequestContext({ baseLog, clock }, request, { routeId, session })`
- No Container dependency - decouples from DI graph

**Container Integration:**

- Exports `log: Logger` in Container interface
- Routes call `getContainer()` for singleton
- Pass `{ baseLog: container.log, clock: container.clock }` to createRequestContext

**Ports Stay Pure:**

- No Logger in port interfaces (e.g., LlmService)
- Logging at feature layer before/after port calls
- Adapters remain testable without mock loggers

---

## 3. Key Files

**Observability Module:**

- `src/shared/observability/logging/logger.ts` - Logger factory
- `src/shared/observability/logging/events.ts` - Event schemas (AiLlmCallEvent, PaymentsEvent)
- `src/shared/observability/logging/helpers.ts` - logRequestStart/End/Error
- `src/shared/observability/context/factory.ts` - createRequestContext (reqId validation)
- `src/shared/observability/context/types.ts` - RequestContext + structural Clock

**Container:**

- `src/bootstrap/container.ts` - Singleton with logger

**Instrumented Routes:**

- `src/app/api/v1/ai/completion/route.ts` - Request/error logging
- `src/app/_facades/ai/completion.server.ts` - Context enrichment
- `src/features/ai/services/completion.ts` - LLM call event logging

**Tests:**

- `tests/unit/bootstrap/container.spec.ts` - Singleton pattern tests
- `tests/unit/features/ai/services/completion.test.ts` - Feature tests with ctx
- `tests/setup.ts` - Sets `VITEST=true` to suppress logs

---

## 4. Invariants

**Boundary:**

- `observability/` has no imports from `ports/`, `bootstrap/`, `core/`, `features/`
- Structural Clock interface prevents port dependency
- RequestContext factory takes `{ baseLog, clock }` not Container

**Wiring:**

- Container is module singleton (one logger per process)
- Routes import from `@/shared/observability` not `@/bootstrap/container`
- Ports stay pure (no Logger in port interfaces)

**Logging:**

- Every route: logRequestStart() at entry, logRequestEnd() on all exit paths
- Errors: logRequestError() with stable errorCode + { err } object
- Events: Typed schemas (AiLlmCallEvent, PaymentsEvent) with consistent fields
- Security: reqId validated (max 64 chars, alphanumeric + `_-`)

**Test Silence:**

- makeLogger() checks `VITEST=true || NODE_ENV=test` (VITEST is canonical test-runner signal)
- Silences logs regardless of APP_ENV (which controls adapter wiring only)
- Container tests can set APP_ENV=production to test real adapters without log noise
- All console.log/warn removed from adapters (policy: no console.\* in src/)

---

## 5. Event Schemas

**HTTP Request Events:**

- `logRequestStart(ctx.log)` → `{ reqId, route, method, msg: "request received" }`
- `logRequestEnd(ctx.log, { status, durationMs })` → info/warn/error by status
- `logRequestError(ctx.log, error, errorCode)` → `{ err, errorCode }`

**AI Domain:**

- `AiLlmCallEvent` → `{ event: "ai.llm_call", routeId, reqId, billingAccountId, model?, durationMs, tokensUsed?, providerCostUsd? }`

**Payments Domain:**

- `PaymentsIntentCreatedEvent` → `{ event: "payments.intent_created", routeId, reqId, attemptId, chainId, durationMs }`
- `PaymentsStateTransitionEvent`, `PaymentsVerifiedEvent`, `PaymentsConfirmedEvent` → Similar schema

**Location:** `src/shared/observability/logging/events.ts`

---

## 6. Security

**Redaction:**

- Paths: password, token, apiKey, authorization, cookie, privateKey, mnemonic
- Location: `src/shared/observability/logging/redact.ts`
- Important: Does NOT redact "url" globally (preserves queryability)

**ReqId Validation:**

- Max 64 chars, `/^[a-zA-Z0-9_-]+$/`
- Prevents log injection via `x-request-id` header
- Location: `src/shared/observability/context/factory.ts:21-37`

---

## 7. Known Issues

**V1 Cleanup:**

- [ ] Complete payment route instrumentation (5 routes)

**V2 (Future PR):**

- [ ] Wire Promtail scrape config
- [ ] Validate Loki pipeline
- [ ] Grafana dashboards + alerting
