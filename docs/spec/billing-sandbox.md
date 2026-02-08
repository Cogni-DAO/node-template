---
id: billing-sandbox-spec
type: spec
title: Sandbox Billing — Proxy-Driven Audit Log Pipeline
status: active
trust: verified
summary: How LLM calls made inside sandbox containers are billed via nginx proxy audit log parsing
read_when: Working on sandbox billing, proxy configuration, or UsageFact emission for sandboxed agents
owner: derekg1729
created: 2026-02-08
verified: 2026-02-08
tags: [sandbox, billing, proxy]
---

# Sandbox Billing — Proxy-Driven Audit Log Pipeline

## Data Flow

```
┌──────────────────────────────────────────────────────────────────┐
│  SANDBOX CONTAINER (network=none)                                │
│                                                                  │
│  Agent (run.mjs or OpenClaw) calls LLM via localhost:8080        │
│  socat bridges localhost:8080 → unix socket in /llm-sock/        │
└──────────────┬───────────────────────────────────────────────────┘
               │ unix socket (Docker volume)
               ▼
┌──────────────────────────────────────────────────────────────────┐
│  NGINX PROXY CONTAINER (sandbox-internal network)                │
│                                                                  │
│  Injects (overwrites client values):                             │
│    Authorization: Bearer $LITELLM_MASTER_KEY                     │
│    x-litellm-end-user-id: $BILLING_ACCOUNT_ID                   │
│    x-litellm-spend-logs-metadata: {run_id, attempt, graph_id}   │
│                                                                  │
│  Forwards to LiteLLM, receives response headers:                 │
│    x-litellm-call-id        → written to audit log               │
│    x-litellm-response-cost  → written to audit log               │
│                                                                  │
│  Audit log line per request:                                     │
│    $time litellm_call_id=$ID litellm_response_cost=$COST ...     │
└──────────────┬───────────────────────────────────────────────────┘
               │ audit log collected via docker exec cat
               ▼
┌──────────────────────────────────────────────────────────────────┐
│  HOST — LlmProxyManager.stop()                                   │
│                                                                  │
│  1. copyLogFromContainer() — demux Docker stream, write to disk  │
│  2. parseAuditLog() — extract {litellmCallId, costUsd} per line  │
│  3. Return ProxyStopResult { billingEntries, logPath }           │
└──────────────┬───────────────────────────────────────────────────┘
               │ ProxyBillingEntry[]
               ▼
┌──────────────────────────────────────────────────────────────────┐
│  HOST — SandboxRunnerAdapter.runOnce()                            │
│                                                                  │
│  Attaches billingEntries to SandboxRunResult                     │
│  (collected on ALL paths: success, timeout, OOM, error)          │
└──────────────┬───────────────────────────────────────────────────┘
               │ SandboxRunResult.proxyBillingEntries
               ▼
┌──────────────────────────────────────────────────────────────────┐
│  HOST — SandboxGraphProvider.createExecution()                    │
│                                                                  │
│  For each billing entry:                                         │
│    yield { type: "usage_report", fact: UsageFact }               │
│      usageUnitId  = entry.litellmCallId                          │
│      costUsd      = entry.costUsd                                │
│      executorType = "sandbox"                                    │
│      source       = "litellm"                                    │
└──────────────┬───────────────────────────────────────────────────┘
               │ AiEvent stream
               ▼
┌──────────────────────────────────────────────────────────────────┐
│  BILLING — commitUsageFact()                                     │
│                                                                  │
│  Idempotency key: ${runId}/${attempt}/${usageUnitId}             │
│  → calculateDefaultLlmCharge(costUsd)                            │
│  → accountService.recordChargeReceipt()                          │
└──────────────────────────────────────────────────────────────────┘
```

## Key Files

| Layer            | File                                                        | What it does                                                                    |
| ---------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Proxy config     | `platform/infra/services/sandbox-proxy/nginx.conf.template` | Header injection + audit log format                                             |
| Port types       | `src/ports/sandbox-runner.port.ts`                          | `ProxyBillingEntry`, `SandboxRunResult.proxyBillingEntries`                     |
| Proxy lifecycle  | `src/adapters/server/sandbox/llm-proxy-manager.ts`          | `stop()` → `parseAuditLog()` → `ProxyStopResult`                                |
| Container runner | `src/adapters/server/sandbox/sandbox-runner.adapter.ts`     | Threads billing entries through `SandboxRunResult`                              |
| Graph provider   | `src/adapters/server/sandbox/sandbox-graph.provider.ts`     | Emits `usage_report` per billing entry                                          |
| Billing consumer | `src/features/ai/services/billing.ts`                       | `commitUsageFact()` → `recordChargeReceipt()`                                   |
| Agent script     | `services/sandbox-runtime/agent/run.mjs`                    | Still captures `litellmCallId` in stdout (debug only, billing does not read it) |

## Invariants

1. **BILLING_FROM_PROXY_NOT_AGENT** — Billing data comes from the nginx audit log, never from agent stdout. The agent is billing-ignorant.

2. **UNIFORM_MECHANISM** — Single-call agents (run.mjs) and multi-call agents (OpenClaw) use the identical billing path. No `if (multiCall)` branching.

3. **USAGE_UNIT_IS_LITELLM_CALL_ID** — `usageUnitId` on every `UsageFact` is sourced from `x-litellm-call-id` response header, captured in the proxy audit log.

4. **COST_FROM_RESPONSE_HEADER** — `costUsd` is sourced from `x-litellm-response-cost` response header. When absent, billing.ts logs CRITICAL but still records the receipt (degraded mode).

5. **BILLING_ON_ALL_PATHS** — Proxy billing entries are collected even on timeout, OOM, and error paths. LLM calls that happened before failure are still billed.

6. **SECRETS_HOST_ONLY** — `LITELLM_MASTER_KEY` exists only in the proxy container. The sandbox container never sees it.

7. **HOST_INJECTS_BILLING_HEADER** — The proxy unconditionally overwrites `x-litellm-end-user-id` and `x-litellm-spend-logs-metadata`. The sandbox cannot spoof billing identity.

## How the Audit Log is Parsed

The nginx access log uses a key=value format. `LlmProxyManager.parseAuditLog()` extracts:

- `litellm_call_id=<value>` → `ProxyBillingEntry.litellmCallId` (skip if `-` or absent)
- `litellm_response_cost=<value>` → `ProxyBillingEntry.costUsd` (parseFloat, undefined if `-` or NaN)

Health check requests (`/health`) produce no `litellm_call_id` and are filtered out.

Docker exec with `hijack:true` returns multiplexed stream frames (8-byte headers). `LlmProxyManager.demuxDockerStream()` strips these before writing the log to disk, so `parseAuditLog()` reads clean text.

## Comparison with In-Proc Billing

| Aspect                 | In-proc (LangGraph)                     | Sandbox                                              |
| ---------------------- | --------------------------------------- | ---------------------------------------------------- |
| LLM call               | `LiteLlmAdapter` on host                | Agent inside container via proxy                     |
| Header capture         | Adapter reads response headers directly | Proxy writes headers to audit log                    |
| `usageUnitId` source   | `x-litellm-call-id` from response       | `litellm_call_id=` from audit log                    |
| `costUsd` source       | `x-litellm-response-cost` from response | `litellm_response_cost=` from audit log              |
| `usage_report` emitter | `InProcCompletionUnitAdapter`           | `SandboxGraphProvider`                               |
| Timing                 | Immediate (same process)                | Post-run (after container exits, before proxy stops) |
