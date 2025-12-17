# AI Setup Spec

> [!CRITICAL]
> All AI calls must have end-to-end correlation IDs (request_id + trace_id) propagated from Next.js → LangGraph → LiteLLM → ai_invocation_summaries → Langfuse.

## Core Invariants

1. **Reproducibility**: Every AI run must capture: graph_name, graph_version (git SHA), prompt_hash (content hash), router_policy_version, resolved provider+model.

2. **Correlation**: `request_id` + `trace_id` propagate end-to-end; store `litellm_call_id` and `langfuse_trace_id` as join keys.

3. **Data Handling**: Prod redacts prompts/responses; eval runs must persist full prompt/response artifacts for debugging (local files or Langfuse datasets).

4. **Billing Separation**: `charge_receipts` stays minimal for billing/audit. `ai_invocation_summaries` captures telemetry summaries.

---

## Contracts

### Reproducibility Keys (per run/span)

| Key                     | Source           | Purpose             |
| ----------------------- | ---------------- | ------------------- |
| `graph_name`            | ai-core export   | Which workflow ran  |
| `graph_version`         | git SHA at build | Exact code version  |
| `prompt_hash`           | Content hash     | Detect prompt drift |
| `router_policy_version` | Semver or SHA    | Model routing logic |
| `provider` + `model`    | LiteLLM response | Resolved target     |

### Correlation ID Map

| ID                  | Scope                     | Purpose                                                 |
| ------------------- | ------------------------- | ------------------------------------------------------- |
| `request_id`        | One per inbound request   | Primary join across all systems                         |
| `trace_id`          | One per distributed trace | OTel backbone; 32-hex                                   |
| `span_id`           | One per operation         | Tracing UI only; **do NOT persist as durable join key** |
| `invocation_id`     | One per LLM call attempt  | Idempotency key; UNIQUE in ai_invocation_summaries      |
| `graph_run_id`      | One per graph execution   | Groups multiple LLM calls within a request              |
| `langfuse_trace_id` | Langfuse-specific         | Optional debug join; equals trace_id when enabled       |
| `litellm_call_id`   | LiteLLM call ID           | Join to /spend/logs; may be null on errors              |

**ID Categories:**

| Category                        | IDs                                           | Notes                                                 |
| ------------------------------- | --------------------------------------------- | ----------------------------------------------------- |
| **Essential (always required)** | `request_id`, `trace_id`, `invocation_id`     | Must be non-null on every ai_invocation_summaries row |
| **Essential for graphs**        | `graph_run_id`, `graph_name`, `graph_version` | Required when LLM call is within a graph execution    |
| **Nice-to-have**                | `langfuse_trace_id`, `litellm_call_id`        | Nullable; depends on external service availability    |

**ID Strategy:**

- One stable `request_id` per user-initiated request—do NOT generate new IDs per layer
- `trace_id` for distributed tracing; `span_id` changes per operation (never persist span_id)
- `request_id` attached as OTel span attribute AND forwarded in LiteLLM metadata
- `invocation_id` generated per LLM call attempt (idempotency key for retries)

### Eval Artifact Policy

| Environment   | Prompts/Responses       | Full Artifacts | Storage                          |
| ------------- | ----------------------- | -------------- | -------------------------------- |
| **prod**      | Redacted (never logged) | No             | N/A                              |
| **eval/CI**   | Full capture required   | Yes            | Local files or Langfuse datasets |
| **local dev** | Console only            | Optional       | Never committed                  |

---

## Implementation Checklist

### P0: MVP - Observability Foundation

- [x] Enforce Node runtime for AI routes (`export const runtime = 'nodejs'`)
- [x] OTel instrumentation with explicit root span at request entry (do not rely on auto-instrumentation)
- [x] Store `trace_id` deterministically from root span into RequestContext
- [x] Direct Langfuse SDK integration (not OTel exporter) to reliably obtain `langfuse_trace_id`
- [x] Propagate `reqId` + `trace_id` in LiteLLM metadata
- [x] Create `ai_invocation_summaries` table (see schema below)
- [x] Write correlation IDs to ai_invocation_summaries on every AI call

#### P0 Known Issues

- [x] Stack test for telemetry writes (`tests/stack/ai/ai-telemetry.stack.test.ts` validates `ai_invocation_summaries` rows)

#### Chores

- [ ] Observability instrumentation [observability.md](../.agent/workflows/observability.md)
- [ ] Documentation updates [document.md](../.agent/workflows/document.md)

### P1: First LangGraph Graph

Create `packages/ai-core` with one working graph that demonstrates the full correlation flow.

#### P1 Deliverables

- [ ] Create `packages/ai-core` scaffold per [PACKAGES_ARCHITECTURE.md](PACKAGES_ARCHITECTURE.md)
- [ ] Move `src/shared/ai/prompt-hash.ts` → `packages/ai-core/src/hashing/prompt-hash.ts`
- [ ] Define canonical `AiCoreLlmPort` in `packages/ai-core/src/ports/llm.port.ts`
- [ ] Update `src/ports/llm.port.ts` to re-export from `@cogni/ai-core`
- [ ] Implement first graph (`packages/ai-core/src/graphs/review.graph.ts`)
- [ ] Create orchestration service (`src/features/ai/services/review.ts`)
- [ ] Add TypeScript conformance test (`tests/contract/ai-core-port-conformance.contract.ts`)
- [ ] Add dependency-cruiser rule: ai-core must not import from `src/`

#### P1 Invariants (Blocking for Merge)

- [ ] **GRAPH_CALLER_TYPE_REQUIRED**: Graph APIs must require `graphRunId` at the type level (not optional). Use distinct caller types: `AiCoreLlmCaller` (base) vs `GraphLlmCaller extends AiCoreLlmCaller` with required `graphRunId`.
- [ ] **PROMPT_HASH_VERSION_IN_PAYLOAD**: `prompt_hash_version: 'v1'` must be embedded inside the canonical payload that is hashed, not just exported as a constant.
- [ ] **HASHING_SINGLE_CALL_SITE**: Only `litellm.adapter.ts` computes `promptHash`. Graph code must NOT compute or re-compute it—adapter returns it in `AiCoreLlmResult.promptHash`.
- [ ] **GRAPH_METADATA_ENFORCED**: If `caller.graphRunId` is present, then `graph_name` and `graph_version` must be non-null on `ai_invocation_summaries` rows. Enforced by telemetry writer validation.
- [ ] **SINGLE_SOURCE_CONTRACTS**: `@cogni/ai-core` is canonical home for LLM port + prompt hash. App re-exports; no parallel definitions.

#### P1 File Pointers

| File                                          | Purpose                                              |
| --------------------------------------------- | ---------------------------------------------------- |
| `packages/ai-core/src/ports/llm.port.ts`      | Canonical `AiCoreLlmPort`, `GraphLlmCaller` types    |
| `packages/ai-core/src/hashing/prompt-hash.ts` | `computePromptHash()`, `PROMPT_HASH_VERSION`         |
| `packages/ai-core/src/graphs/review.graph.ts` | First graph with DI config pattern                   |
| `src/ports/llm.port.ts`                       | Re-exports from ai-core + app streaming extension    |
| `src/features/ai/services/review.ts`          | Orchestration: generates `graphRunId`, bridges ports |
| `src/adapters/server/ai/litellm.adapter.ts`   | Sole `promptHash` computation site                   |

### P2: First Eval Runner

Build eval harness to validate graph outputs against golden fixtures.

#### P2 Deliverables

- [ ] Create `evals/` directory structure
- [ ] Implement `evals/runner.ts` harness (load fixtures, run graph, compare goldens)
- [ ] Add 3-5 fixtures for review graph (`evals/fixtures/review-*.json`)
- [ ] Create corresponding goldens (`evals/goldens/review-*.golden.json`)
- [ ] Add `evals/scripts/update-goldens.ts` with explicit `--update` flag
- [ ] CI gate: fail if goldens change without `--update-goldens` flag

#### P2 Invariants

- [ ] **GOLDEN_UPDATE_POLICY**: Never silently update goldens to make CI pass. Requires commit message explaining why.
- [ ] **STRUCTURED_OUTPUT_VALIDATION**: All AI responses must validate against Zod schema before golden comparison.
- [ ] **DETERMINISTIC_COMPARE**: Golden matching uses explicit tolerances (exact, subset, numeric delta).
- [ ] **EVAL_ARTIFACT_CAPTURE**: Eval runs must persist full prompt/response artifacts (local files or Langfuse datasets).

#### P2 File Pointers

| File                              | Purpose                     |
| --------------------------------- | --------------------------- |
| `evals/runner.ts`                 | Test harness entry point    |
| `evals/fixtures/`                 | Input test cases            |
| `evals/goldens/`                  | Expected outputs            |
| `evals/scripts/update-goldens.ts` | Explicit golden update tool |

### P3: Future (Do NOT Build Yet)

- [ ] Evaluate ClickHouse/data lake after eval loop works
- [ ] PostHog analytics (requires stable correlation IDs first)
- [ ] Tempo distributed tracing (after OTel foundation stable)
- [ ] **Do NOT build preemptively**

---

## File Pointers (P0 Scope)

| File                                        | Change                                   |
| ------------------------------------------- | ---------------------------------------- |
| `src/shared/observability/server/otel.ts`   | New: OTel SDK init + context propagation |
| `src/adapters/server/ai/litellm.adapter.ts` | Attach trace_id to LiteLLM metadata      |
| `src/shared/db/schema.ai.ts`                | New: ai_invocation_summaries table       |
| `src/features/ai/services/completion.ts`    | Write to ai_invocation_summaries         |
| `src/bootstrap/container.ts`                | Wire Langfuse sink                       |

---

## Schema: `ai_invocation_summaries`

**Purpose:** Covers both direct LLM calls and LangGraph runs. Clearly not billing; clearly not full telemetry.

| Column                  | Type        | Notes                                                |
| ----------------------- | ----------- | ---------------------------------------------------- |
| `id`                    | uuid        | PK                                                   |
| `invocation_id`         | text        | NOT NULL, UNIQUE (idempotency key per LLM call)      |
| `request_id`            | text        | NOT NULL (multiple rows per request allowed)         |
| `trace_id`              | text        | NOT NULL (from explicit root span)                   |
| `langfuse_trace_id`     | text        | Nullable, debug URL                                  |
| `litellm_call_id`       | text        | Nullable, join to /spend/logs                        |
| `prompt_hash`           | text        | NOT NULL, SHA-256 of canonical payload               |
| `router_policy_version` | text        | NOT NULL, semver or git SHA                          |
| `graph_run_id`          | text        | Nullable (identifies graph execution within request) |
| `graph_name`            | text        | Nullable (null = direct LLM call)                    |
| `graph_version`         | text        | Nullable, git SHA                                    |
| `provider`              | text        | NOT NULL, e.g., "openai", "anthropic"                |
| `model`                 | text        | Resolved model ID                                    |
| `tokens_in`             | int         | Nullable                                             |
| `tokens_out`            | int         | Nullable                                             |
| `tokens_total`          | int         | Nullable                                             |
| `provider_cost_usd`     | numeric     | Nullable                                             |
| `latency_ms`            | int         | Call duration                                        |
| `status`                | text        | "success" / "error"                                  |
| `error_code`            | text        | Nullable                                             |
| `created_at`            | timestamptz |                                                      |

**Uniqueness:** `UNIQUE(invocation_id)` — UUID generated per LLM call attempt serves as idempotency key (better than `request_id + litellm_call_id` since `litellm_call_id` is null on errors).

**Do NOT add:** prompts, responses, full metadata blobs.

---

## LiteLLM Ownership Policy

**LiteLLM is canonical for:**

- Detailed spend logs (`/spend/logs`)
- Per-call telemetry history
- Deep analytics queries

**Local store captures:**

- Only what's available at call-time (headers, stream usage)
- Correlation IDs for resilience
- Summary for Activity dashboard fallback

**Avoid:**

- Replicating LiteLLM spend/log tables locally
- Activity dashboards hard-depending on LiteLLM uptime without fallback

---

## Design Decisions

### 1. Package Location

| Component            | Location                        | Rationale                        |
| -------------------- | ------------------------------- | -------------------------------- |
| LangGraph graphs     | `packages/ai-core`              | Pure logic, no HTTP/DB           |
| Prompt templates     | `packages/ai-core/src/prompts/` | Versioned text files             |
| Tool contracts       | `packages/ai-core/src/tools/`   | Schema + handler interface       |
| Tool implementations | `src/adapters/tools/`           | IO + policy + instrumentation    |
| Route handlers       | `src/app/`                      | Thin entrypoints calling ai-core |

**Rule:** `packages/ai-core` MUST NOT import from `src/`. See [PACKAGES_ARCHITECTURE.md](PACKAGES_ARCHITECTURE.md).

### 2. Tool Structure

**Per-tool files:**

- `packages/ai-core/src/tools/<tool>.tool.ts` - Contract: name, schema (Zod), typed handler interface, parsing helpers
- `src/adapters/tools/<tool>.impl.ts` - Implementation: IO, policy checks, instrumentation

**Single registry:**

- `src/features/ai/tool-registry.ts` - Binds tool contracts to implementations (DI wiring)

**Ports guidance:** One port per external system, NOT per tool.

| Port              | Backs Tools            |
| ----------------- | ---------------------- |
| `KnowledgePort`   | RAG search, doc lookup |
| `WebResearchPort` | Web search, URL fetch  |
| `RepoPort`        | Code search, file read |
| `McpPort`         | MCP server calls       |

**Anti-patterns:**

- One port interface per tool when multiple tools hit same backend
- Putting IO inside ai-core tool definitions
- Tool contracts without schemas (breaks evals)

### 3. Correlation Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│ REQUEST ENTRY (Next.js middleware)                                  │
│ 1. Generate request_id (UUID)                                       │
│ 2. Start OTel span → trace_id                                       │
│ 3. Attach to RequestContext                                         │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ LLM CALL (completion.ts → litellm.adapter.ts)                       │
│ - Pass request_id, trace_id in LiteLLM metadata                     │
│ - Receive litellmCallId from response                               │
│ - Create Langfuse trace/span → langfuse_trace_id                    │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ PERSISTENCE                                                         │
│ charge_receipts: billing only (chargedCredits, responseCostUsd)     │
│ ai_invocation_summaries: telemetry + correlation IDs                │
└─────────────────────────────────────────────────────────────────────┘
```

### 4. Eval Harness Requirements

**Structured outputs:** All AI responses must validate against Zod schema.

**Deterministic compare:** Golden matching uses explicit tolerances:

```json
{
  "decision": "exact",
  "key_findings": "subset",
  "confidence": 0.1
}
```

**Golden update policy:** Never silently update to make CI pass. Requires commit message explaining why.

---

## Anti-Patterns to Avoid

1. **No data lake before evals work** - ClickHouse/PostHog wait for stable correlation IDs
2. **No graphs in app routes** - LangGraph stays in `packages/ai-core`, never absorbs HTTP/DB
3. **No LiteLLM-only telemetry** - Always have local summary fallback + correlation IDs
4. **No port-per-tool** - Ports per external system, tools compose on top
5. **No IO in ai-core** - Tool contracts define schemas; implementations live in adapters

---

## Related Docs

- [LANGGRAPH_AI.md](LANGGRAPH_AI.md) - LangGraph architecture, port definitions, flow diagrams
- [AI_EVALS.md](AI_EVALS.md) - Eval harness structure, CI gates
- [PACKAGES_ARCHITECTURE.md](PACKAGES_ARCHITECTURE.md) - Package creation rules
- [ARCHITECTURE.md](ARCHITECTURE.md) - Hexagonal layers

---

**Last Updated**: 2025-12-17
**Status**: P0 Complete, P1/P2 Design Approved
