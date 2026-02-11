---
id: billing-ingest-spec
type: spec
title: "Billing Ingest: Callback-Driven, Port-Level Billing"
status: draft
spec_state: draft
trust: draft
summary: "Canonicalize billing at GraphExecutorPort: LiteLLM callback writes receipts, adapters only emit usage_unit_created{call_id}, decorator enforces receipt barrier."
read_when: Working on billing pipeline, LiteLLM integration, sandbox billing, or charge receipt reconciliation.
implements: proj.unified-graph-launch
owner: derekg1729
created: 2026-02-11
verified:
tags: [billing, litellm, sandbox]
---

# Billing Ingest: Callback-Driven, Port-Level Billing

> Billing is canonicalized at GraphExecutorPort. Adapters never implement billing — they only emit `usage_unit_created{call_id}`. Cost data comes from a single source (LiteLLM callback). The decorator enforces a receipt barrier by call_id before yielding final success.

### Key References

|             |                                                                               |                                                     |
| ----------- | ----------------------------------------------------------------------------- | --------------------------------------------------- |
| **Project** | [proj.unified-graph-launch](../../work/projects/proj.unified-graph-launch.md) | Unified execution roadmap                           |
| **Spec**    | [billing-evolution](./billing-evolution.md)                                   | Charge receipt schema, credit unit                  |
| **Spec**    | [billing-sandbox](./billing-sandbox.md)                                       | Current proxy audit log pipeline (to be superseded) |
| **Spec**    | [external-executor-billing](./external-executor-billing.md)                   | Reconciliation design                               |

## Core Primitive

**`litellm_call_id`** (`x-litellm-call-id` response header) is the universal billing tracking key. LiteLLM assigns it per-call, includes it in response headers _and_ callback payloads. Every component — adapter, ingest endpoint, receipt barrier — keys off this single ID.

## Invariants

| Rule                                  | Constraint                                                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ONE_BILLING_PATH                      | All billing confirmation is receipt-existence by `litellm_call_id`. No adapter-specific billing logic, no log parsing, no cost extraction in adapters. |
| ADAPTERS_NEVER_BILL                   | Adapters only emit `usage_unit_created{call_id, runId, billingAccountId, model?}`. They never parse cost data, read logs, or write receipts.           |
| COST_ORACLE_IS_LITELLM                | Cost comes from LiteLLM callback payload (`response_cost`), not from nginx logs, response headers, or adapter-side computation.                        |
| CHARGE_RECEIPTS_IDEMPOTENT_BY_CALL_ID | `UNIQUE(source_system, source_reference)` where `source_reference` includes `litellm_call_id`. Duplicate callbacks are no-ops (HTTP 409).              |
| BILLING_FAILURE_STILL_BLOCKS          | Missing receipt at end-of-run = run failure. The decorator enforces this, not adapters.                                                                |
| CALLBACK_AUTHENTICATED                | Ingest endpoint requires `Authorization: Bearer BILLING_INGEST_TOKEN`.                                                                                 |
| INGEST_ENDPOINT_IS_INTERNAL           | `/api/internal/billing/ingest` — internal Docker network only, not exposed through Caddy.                                                              |
| NO_DOCKER_SOCK_IN_APP                 | App container never mounts docker.sock or uses dockerode for billing. (Preserved from bug.0027 bridge fix.)                                            |

## Design

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ ADAPTER (any executor type)                                         │
│                                                                     │
│  1. Makes LLM call through LiteLLM proxy                           │
│  2. Reads x-litellm-call-id from response header                   │
│  3. Emits: usage_unit_created { call_id, runId, billingAccountId }  │
│  4. Adapter is DONE with billing. No cost parsing. No log reads.   │
└──────────────────────┬──────────────────────────────────────────────┘
                       │ (stream event)
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│ BillingGraphExecutorDecorator (at GraphExecutorPort level)           │
│                                                                     │
│  1. Collects call_ids from usage_unit_created events                │
│  2. Consumes these events (not yielded downstream)                  │
│  3. At end-of-run: polls ReceiptBarrierPort for all call_ids        │
│  4. All receipts found → success                                    │
│  5. Any receipt missing after bounded poll (≤3s) → fail run         │
└─────────────────────────────────────────────────────────────────────┘

                    ┌── callback fires in parallel ──┐
                    ▼                                 │
┌─────────────────────────────────────────────────────────────────────┐
│ LiteLLM Proxy (cost oracle)                                         │
│                                                                     │
│  On every successful LLM call:                                      │
│  1. Computes response_cost                                          │
│  2. Fires success_callback → POST /api/internal/billing/ingest      │
│     { call_id, response_cost, model, end_user,                      │
│       metadata: { run_id, graph_id } }                              │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│ BillingIngestPort: POST /api/internal/billing/ingest                │
│                                                                     │
│  1. Validate payload (Zod)                                          │
│  2. commitUsageFact() → recordChargeReceipt()                       │
│  3. UPSERT by (source_system, source_reference=call_id)             │
│  4. Return 200 OK / 409 Conflict (duplicate)                        │
└─────────────────────────────────────────────────────────────────────┘
```

### Two Ports

| Port                   | Purpose                                                                         | Implementation                                                              |
| ---------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **BillingIngestPort**  | Accept LiteLLM callback payloads, write charge_receipts via `commitUsageFact()` | `POST /api/internal/billing/ingest` (shared-secret auth)                    |
| **ReceiptBarrierPort** | Poll/check receipt existence for a set of call_ids                              | `SELECT EXISTS` by `(source_system, source_reference)` containing `call_id` |

### Adapter Contract

Adapters emit a single event type for billing:

```typescript
// What adapters emit — nothing else billing-related
yield {
  type: "usage_unit_created",
  callId: litellmCallId,      // x-litellm-call-id from response header
  runId,
  billingAccountId,
  model,                       // optional — for observability, not billing
};
```

Adapters do NOT:

- Parse `response_cost` or `providerCostUsd`
- Read nginx audit logs or billing files
- Construct `UsageFact` with cost fields
- Call `commitUsageFact()` or `recordChargeReceipt()`

### Decorator Change

The existing `BillingGraphExecutorDecorator` currently intercepts `usage_report` events and writes receipts inline during stream consumption. After this change:

1. Intercepts `usage_unit_created` events (renamed from `usage_report`)
2. Collects call_ids into a set
3. At end-of-stream: polls `ReceiptBarrierPort` for all collected call_ids
4. Bounded retry: up to 3s (callback usually arrives before the stream even finishes)
5. Missing receipts → throw, failing the run

### How Executors Get call_id

All executor types already have access to `x-litellm-call-id`:

| Executor                 | call_id source                                                    |
| ------------------------ | ----------------------------------------------------------------- |
| **InProc**               | `x-litellm-call-id` response header (already extracted)           |
| **Sandbox (ephemeral)**  | `x-litellm-call-id` response header via proxy (already forwarded) |
| **Gateway (OpenClaw)**   | `x-litellm-call-id` response header via proxy (already forwarded) |
| **External (LangGraph)** | `spend_logs.request_id` or callback metadata                      |

### Callback Payload Schema

```typescript
const BillingIngestPayload = z.object({
  call_id: z.string().min(1), // x-litellm-call-id
  response_cost: z.number().nonneg(), // USD cost computed by LiteLLM
  model: z.string().min(1), // Resolved model name
  end_user: z.string().min(1), // billingAccountId
  metadata: z.object({
    run_id: z.string().min(1), // Graph run correlation
    graph_id: z.string().optional(), // e.g. "sandbox:openclaw"
    attempt: z.number().int().min(0).default(0),
  }),
  input_tokens: z.number().int().optional(),
  output_tokens: z.number().int().optional(),
  provider: z.string().optional(),
});
```

### LiteLLM Configuration

```yaml
litellm_settings:
  success_callback: ["langfuse", "webhook"]
  webhook_url: "http://app:3000/api/internal/billing/ingest"
  webhook_headers:
    Authorization: "Bearer ${BILLING_INGEST_TOKEN}"
```

## Goal

Canonicalize billing at GraphExecutorPort so adapters never implement billing. Single stable path: LiteLLM callback writes receipts; decorator enforces receipt barrier by call_id. This eliminates all log-scraping billing paths and makes billing work identically across all executor types and deployment topologies.

## Non-Goals

- Redesigning the charge_receipts schema (reuse existing table and idempotency)
- Changing the credit unit standard or markup policy
- Building a standalone billing microservice (internal API route)
- Real-time billing UI updates
- Modifying the unified graph launch workflow architecture

## Migration Path

Callback and log-scraping paths can coexist briefly during cutover:

1. **Add `usage_unit_created` event type** — adapters emit alongside existing `usage_report`. Decorator collects both.
2. **Add ingest endpoint + LiteLLM callback** — receipts now created by callback. Safe to run alongside existing path (idempotent by call_id).
3. **Add ReceiptBarrierPort** — decorator polls for receipt existence at end-of-run.
4. **Strip billing from adapters** — remove cost extraction, log reads, `UsageFact` construction with cost fields. Adapters emit only `usage_unit_created`.
5. **Delete old paths** — `ProxyBillingReader`, billing volumes, `proxyBillingEntries` from `SandboxRunResult`, `usage_report` event type.

Steps 1-2 can ship independently; each is safe alongside the existing path.

## Open Questions

- [ ] Does LiteLLM's webhook callback include `metadata` from `x-litellm-spend-logs-metadata`? Need to verify the exact payload shape for the `metadata.run_id` field. If not, fall back to LiteLLM DB query by `call_id`.
- [ ] Should the ingest endpoint accept LiteLLM's native callback format directly, or use a custom callback class that reshapes the payload?
- [ ] For the gateway (OpenClaw) executor: how does the gateway container surface `x-litellm-call-id` back to the app? Currently it's in the nginx audit log — with callback-driven billing, does the gateway WS event stream need to carry call_ids?

## Related

- [billing-evolution](./billing-evolution.md) — Charge receipt schema, credit unit standard
- [billing-sandbox](./billing-sandbox.md) — Current proxy audit log pipeline (to be superseded)
- [external-executor-billing](./external-executor-billing.md) — Reconciliation design (converges with this spec)
- [openclaw-sandbox-spec](./openclaw-sandbox-spec.md) — Gateway billing architecture
- [proj.unified-graph-launch](../../work/projects/proj.unified-graph-launch.md) — Unified execution roadmap
