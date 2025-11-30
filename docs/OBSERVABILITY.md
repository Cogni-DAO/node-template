# Observability: Structured Logging with Pino

**Status:** V1 in progress (stdout JSON)

**Purpose:** Centralized structured logging with request context, stable event schemas, and collector-based shipping to Loki. Isolates cross-cutting observability concerns in `shared/observability`.

---

## 1. Implementation Checklist

### V1: Structured Logging (In Progress)

**Module Structure:**

- [x] Create `shared/observability/logging/logger.ts` (makeLogger, makeNoopLogger)
- [x] Create `shared/observability/logging/redact.ts` (security-sensitive paths)
- [x] Create `shared/observability/logging/events.ts` (AI + Payments event schemas)
- [x] Create `shared/observability/logging/helpers.ts` (logRequestStart/End/Error)
- [x] Create `shared/observability/context/types.ts` (RequestContext + structural Clock)
- [x] Create `shared/observability/context/factory.ts` (createRequestContext with reqId validation)
- [x] Create `shared/observability/index.ts` (unified entry point)

**Container Changes:**

- [x] Add `log: Logger` to Container interface
- [x] Singleton pattern: `getContainer()` + `resetContainer()`
- [x] Startup log on init: `{ env, logLevel, pretty }`
- [x] Import from `@/shared/observability` not `@/shared/logging`

**AI Completion Route:**

- [x] Instrument `app/api/v1/ai/completion/route.ts`
  - Request start/end/error with standardized helpers
  - Pass ctx to facade
  - Remove console.log/error calls
- [x] Update `app/_facades/ai/completion.server.ts`
  - Accept ctx parameter
  - Enrich with userId, billingAccountId
- [x] Update `features/ai/services/completion.ts`
  - Accept ctx parameter
  - Log before/after LLM call with AiLlmCallEvent schema
  - Replace console.warn/error with ctx.log

**Payments Routes:**

- [ ] Instrument `app/api/v1/payments/intents/route.ts` (routeId: "payments.intents")
- [ ] Instrument `app/api/v1/payments/credits/summary/route.ts` (routeId: "payments.credits_summary")
- [ ] Instrument `app/api/v1/payments/credits/confirm/route.ts` (routeId: "payments.credits_confirm")
- [ ] Instrument `app/api/v1/payments/attempts/[id]/route.ts` (routeId: "payments.attempt_status")
- [ ] Instrument `app/api/v1/payments/attempts/[id]/submit/route.ts` (routeId: "payments.attempt_submit")

**Tests:**

- [ ] Fix container.spec.ts (test getContainer singleton, expect `log` property)
- [ ] Fix completion facade tests (pass ctx parameter)
- [ ] Fix completion feature tests (pass ctx parameter)
- [ ] All tests use `makeNoopLogger()` or `pino({ enabled: false })`

---

### V2: Log Collection & Observability (Deferred)

**Promtail Configuration:**

- [ ] Define scrape_configs for app container logs
- [ ] Configure Docker socket mounts (`/var/run/docker.sock`, `/var/lib/docker/containers`)
- [ ] Add labels: `{ app, env, service }`
- [ ] Add JSON pipeline stages for field extraction
- [ ] Validate logs arrive in Loki

**Loki Integration:**

- [ ] Wire Promtail → Loki in docker-compose
- [ ] Validate JSON fields are queryable (not just labels)
- [ ] Create sample queries for common patterns

**Dashboards:**

- [ ] Grafana: Request rate by routeId
- [ ] Grafana: Error rate by errorCode
- [ ] Grafana: LLM call latency + cost
- [ ] Grafana: Payment state transitions

**Alerting:**

- [ ] Alert on error rate spike
- [ ] Alert on missing provider cost headers
- [ ] Alert on payment verification failures

**Tracing (Future):**

- [ ] OpenTelemetry integration (traceId, spanId)
- [ ] Distributed tracing across services

---

## 2. V1 Guarantees

**What V1 Provides:**

- Structured JSON logs to stdout (source of truth)
- Request correlation via reqId (honors incoming `x-request-id`)
- Consistent event schemas for AI + Payments domains
- Redaction of sensitive fields (tokens, headers, wallet keys)
- Development mode: pretty output with pino-pretty
- Test mode: logs disabled (`enabled: false`)
- Container singleton: one logger per process

**What V1 Does NOT Provide:**

- Log aggregation (Promtail/Loki wiring incomplete)
- Dashboards or alerting
- Distributed tracing
- Log retention policies

---

## 3. Architecture

### Cross-Cutting Observability Layer

**Location:** `src/shared/observability/`

**Purpose:** Isolate cross-cutting concerns (logging, context, events) in one coherent boundary.

**Why not `shared/logging` + `bootstrap/context`?**

- RequestContext is a cross-cutting concern, not a DI concern
- Mixing request context into bootstrap spreads coupling
- Future tracing work would require similar context propagation
- Unified observability module prevents refactor storm

**Import Rules:**

- `observability/` can import: `@/shared/auth`, `@/shared/env`
- `observability/` CANNOT import: `@/ports`, `@/bootstrap`, `@/core`, `@/features`
- **Structural typing**: Clock interface defined in observability (any `{ now(): Date }` satisfies)

### RequestContext Design

**Type:** `shared/observability/context/types.ts`

```typescript
export interface Clock {
  now(): Date; // Structural - ports/Clock satisfies this
}

export interface RequestContext {
  log: Logger; // Child logger with reqId, route, method bound
  reqId: string; // Request correlation ID (validated)
  session?: SessionUser; // Authenticated user (optional)
  clock: Clock; // Time provider (testable)
}
```

**Factory:** `shared/observability/context/factory.ts`

```typescript
export function createRequestContext(
  deps: { baseLog: Logger; clock: Clock }, // No Container dependency
  request: Request,
  meta: { routeId: string; session?: SessionUser }
): RequestContext;
```

**Key Design:**

- No Container dependency (only `baseLog` + `clock`)
- Prevents coupling to entire DI graph
- Reusable in non-HTTP entry points (jobs, daemons)

### Container Integration

**Container exports Logger:**

```typescript
export interface Container {
  log: Logger; // Base app logger
  // ... other ports
}

export function getContainer(): Container; // Singleton
export function resetContainer(): void; // Tests only
```

**Route handler usage:**

```typescript
const container = getContainer();
const ctx = createRequestContext(
  { baseLog: container.log, clock: container.clock },
  request,
  { routeId: "ai.completion", session }
);
```

**NO re-exports from container**: Routes import from `@/shared/observability`, not `@/bootstrap/container`.

### Ports Stay Pure

**Port interfaces do NOT include Logger:**

```typescript
// ❌ Wrong - leaks observability into domain contract
export interface LlmService {
  completion(messages, caller, log: Logger): Promise<LlmResult>;
}

// ✅ Correct - port stays pure
export interface LlmService {
  completion(messages, caller): Promise<LlmResult>;
}
```

**Logging at feature layer:**

```typescript
// Feature service wraps adapter call with logging
export async function execute(..., ctx: RequestContext) {
  const log = ctx.log.child({ feature: "ai.completion" });

  log.debug("calling LLM");
  const result = await llmService.completion(messages, caller);  // No logger
  log.info(llmEvent, "LLM response received");

  return result;
}
```

---

## 4. Event Schemas

### HTTP Request Events

**All routes emit these:**

```typescript
// Start
logRequestStart(ctx.log)
→ { reqId, route, method, msg: "request received" }

// End
logRequestEnd(ctx.log, { status, durationMs })
→ { reqId, route, method, status, durationMs, msg: "request complete" }
→ Level: status >= 500 ? error : status >= 400 ? warn : info

// Error
logRequestError(ctx.log, error, errorCode)
→ { reqId, route, method, err, errorCode, msg: "request failed" }
```

**Guaranteed Fields:**

- `reqId` - Request correlation ID
- `route` - Stable route identifier (e.g., "ai.completion")
- `method` - HTTP method
- `status` - HTTP status code (on end)
- `durationMs` - Request duration (on end)
- `errorCode` - Stable error code (on error)

### AI Domain Events

```typescript
export interface AiLlmCallEvent {
  event: "ai.llm_call";
  routeId: string;
  reqId: string;
  billingAccountId: string;
  model?: string;
  durationMs: number;
  tokensUsed?: number;
  providerCostUsd?: number;
}
```

**Usage:**

```typescript
const llmEvent: AiLlmCallEvent = { ... };
log.info(llmEvent, "LLM response received");
```

### Payments Domain Events

```typescript
export type PaymentsEventType =
  | "payments.intent_created"
  | "payments.state_transition"
  | "payments.verified"
  | "payments.confirmed";

export interface PaymentsIntentCreatedEvent {
  event: "payments.intent_created";
  routeId: string;
  reqId: string;
  attemptId: string;
  chainId: number;
  durationMs: number;
}

// Similar for other payment events
```

---

## 5. Security: Redaction

**Redacted Paths:**

```typescript
export const REDACT_PATHS = [
  // Auth & secrets
  "password",
  "token",
  "access_token",
  "refresh_token",
  "secret",
  "apiKey",
  "api_key",
  "AUTH_SECRET",
  // HTTP headers
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers.set-cookie",
  "headers.authorization",
  "headers.cookie",
  // Wallet/crypto
  "privateKey",
  "mnemonic",
  "seed",
];
```

**Important:** Do NOT redact "url" globally - it nukes queryability. Only redact known secret-bearing keys.

**ReqId Validation:**

```typescript
const MAX_REQ_ID_LENGTH = 64;
const REQ_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
```

Prevents log injection attacks via `x-request-id` header.

---

## 6. Loki Labels vs JSON Fields

**Low Cardinality (Promtail labels):**

- `app` = "cogni-template"
- `env` = "test" | "production"
- `service` = "cogni-template"

**High Cardinality (JSON fields, queryable):**

- `reqId`, `userId`, `billingAccountId`, `attemptId`, `paymentAttemptId`, `txHash`

**Rationale:** Promtail already configured to parse JSON. Fields are searchable via Loki's JSON parser without exploding label cardinality.

---

## 7. Log Levels

| Level     | Use                                                                   |
| --------- | --------------------------------------------------------------------- |
| **info**  | Business events: request complete, payment confirmed, LLM response    |
| **warn**  | Recoverable anomalies: auth failure, insufficient credits, rate limit |
| **error** | Failures: include `{ err }` serialization + errorCode                 |
| **debug** | Diagnostics: off by default (enable via PINO_LOG_LEVEL=debug)         |

**Prohibited:**

- Request/response bodies
- Message content (counts only)
- URLs with secrets
- Personally identifiable information

---

## 8. Testing Strategy

**Unit Tests:**

```typescript
import { makeNoopLogger } from "@/shared/observability";

const ctx: RequestContext = {
  log: makeNoopLogger(),
  reqId: "test-req-123",
  clock: mockClock,
};

// Assert behavior via returned values/errors, not log output
```

**Container Tests:**

```typescript
import { getContainer, resetContainer } from "@/bootstrap/container";

afterEach(() => {
  resetContainer(); // Clear singleton between tests
});

it("returns singleton", () => {
  const c1 = getContainer();
  const c2 = getContainer();
  expect(c1).toBe(c2); // Same instance
});
```

---

## 9. Validation (V1)

### Local Development

```bash
# Start dev stack
pnpm dev:stack

# Make request (logs appear in terminal with pino-pretty)
curl -X POST http://localhost:3000/api/v1/ai/completion \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "test"}]}'
```

**Expected logs:**

```
[timestamp] INFO: container initialized (env: production, logLevel: info, pretty: true)
[timestamp] INFO: request received (reqId: ..., route: ai.completion, method: POST)
[timestamp] INFO: LLM response received (event: ai.llm_call, durationMs: ..., tokensUsed: ...)
[timestamp] INFO: request complete (status: 200, durationMs: ...)
```

### Docker (Production Simulation)

```bash
# Start production stack
pnpm docker:stack

# View logs (JSON format)
docker compose -f platform/infra/services/runtime/docker-compose.yml logs app | jq

# Validate JSON structure
docker compose -f platform/infra/services/runtime/docker-compose.yml logs app \
  | jq -r 'select(.msg == "request complete") | {reqId, route, status, durationMs}'
```

### Test Mode

```bash
# Run tests (no log output)
pnpm test

# Logs are disabled (enabled: false)
# Tests assert behavior, not log content
```

---

## 10. V2: Log Collection (Deferred)

**Current State:**

- Promtail container exists in `platform/infra/services/runtime/docker-compose.yml`
- Promtail config exists in `platform/infra/services/runtime/configs/promtail-config.yaml`
- **NOT WIRED**: No scrape config for app container, no labels, no JSON pipeline

**What V2 Requires:**

### Promtail Wiring

- [ ] Update `promtail-config.yaml` with app container scrape job
- [ ] Add scrape_configs with Docker service discovery
- [ ] Configure labels: `{ app: "cogni-template", env, service }`
- [ ] Add JSON pipeline stages for field extraction
- [ ] Mount `/var/run/docker.sock` and `/var/lib/docker/containers` in Promtail service

### Loki Queries

- [ ] Validate logs arrive: `{app="cogni-template"}`
- [ ] Query by route: `{app="cogni-template"} | json | route="ai.completion"`
- [ ] Query errors: `{app="cogni-template"} | json | errorCode="INSUFFICIENT_CREDITS"`
- [ ] Query slow requests: `{app="cogni-template"} | json | durationMs > 1000`

### Dashboards

- [ ] Grafana: Request rate by route
- [ ] Grafana: Error rate by errorCode
- [ ] Grafana: p50/p95/p99 latency by route
- [ ] Grafana: LLM call cost + tokens
- [ ] Grafana: Payment verification success rate

---

## 11. Usage Examples

### Route Handler

```typescript
import { getContainer } from "@/bootstrap/container";
import {
  createRequestContext,
  logRequestStart,
  logRequestEnd,
  logRequestError,
} from "@/shared/observability";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const container = getContainer();
  const sessionUser = await getSessionUser();

  const ctx = createRequestContext(
    { baseLog: container.log, clock: container.clock },
    request,
    { routeId: "payments.intents", session: sessionUser ?? undefined }
  );

  logRequestStart(ctx.log);
  const start = Date.now();

  try {
    const result = await facade(input, ctx);
    logRequestEnd(ctx.log, { status: 200, durationMs: Date.now() - start });
    return NextResponse.json(result);
  } catch (error) {
    logRequestError(ctx.log, error, "PAYMENT_CREATION_FAILED");
    logRequestEnd(ctx.log, { status: 500, durationMs: Date.now() - start });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
```

### Feature Service

```typescript
import type { RequestContext, AiLlmCallEvent } from "@/shared/observability";

export async function execute(..., ctx: RequestContext) {
  const log = ctx.log.child({ feature: "ai.completion" });

  log.debug({ messageCount }, "calling LLM");
  const start = Date.now();

  const result = await llmService.completion(messages, caller);

  const llmEvent: AiLlmCallEvent = {
    event: "ai.llm_call",
    routeId: ctx.log.bindings().route as string,
    reqId: ctx.reqId,
    billingAccountId: caller.billingAccountId,
    model: result.providerMeta?.model,
    durationMs: Date.now() - start,
    tokensUsed: result.usage?.totalTokens,
    providerCostUsd: result.providerCostUsd,
  };
  log.info(llmEvent, "LLM response received");

  return result;
}
```

---

## 12. Architecture Rationale

### Why `shared/observability` Not `bootstrap/context`?

**Problem with bootstrap placement:**

- RequestContext is a cross-cutting concern, not a DI concern
- Re-exporting from container makes bootstrap a god-module
- Spreads coupling: routes need bootstrap types for context creation
- Blocks reuse in non-HTTP entry points without pulling entire DI graph

**Solution:**

- `shared/observability` is the sanctioned cross-cutting layer
- No imports from ports/bootstrap (structural Clock interface)
- Container provides `log` and `clock`, but context module doesn't depend on Container type
- Routes import from `@/shared/observability` only

### Why Pass `{ baseLog, clock }` Not `Container`?

**Decoupling:**

- Context creation doesn't need entire DI graph
- Testable without mock container
- Reusable in background jobs, daemons, CLI tools

**Testability:**

```typescript
const ctx = createRequestContext(
  { baseLog: makeNoopLogger(), clock: fakeClock },
  request,
  { routeId: "test.route" }
);
```

### Why No Logger in Port Interfaces?

**Hexagonal Architecture:**

- Ports define domain contracts, not infrastructure concerns
- Logger is observability (cross-cutting), not business logic
- Feature layer logs before/after port calls (wrapped at use-case boundary)
- Adapters remain testable without mock loggers

**Alternatives Rejected:**

- ❌ Pass logger to every port method → leaks infrastructure
- ❌ Global logger singleton → breaks testability
- ✅ Feature layer logs around port calls → clean separation

---

## 13. Known Issues & TODOs

**V1 (Must Fix Before Merge):**

- [ ] Fix container tests for singleton pattern
- [ ] Fix facade/feature tests to pass ctx parameter
- [ ] Complete payment route instrumentation (5 routes)
- [ ] Add HTTP event types to helpers (http.request_start/end/error)

**V2 (Future PR):**

- [ ] Wire Promtail scrape config
- [ ] Validate Loki pipeline
- [ ] Create Grafana dashboards
- [ ] Add alerting rules
- [ ] Document query patterns

**Future Enhancements:**

- [ ] OpenTelemetry tracing (traceId, spanId)
- [ ] Sampling for high-volume routes
- [ ] Log-based metrics (error rate, latency histograms)
- [ ] Correlation with payment events table
