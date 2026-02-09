---
id: billing-sandbox-spec
type: spec
title: Sandbox Billing — Proxy-Driven Audit Log Pipeline
status: active
trust: draft
summary: How LLM calls made inside sandbox containers are billed via nginx proxy audit log parsing
read_when: Working on sandbox billing, proxy configuration, or UsageFact emission for sandboxed agents
owner: derekg1729
created: 2026-02-08
verified: 2026-02-08
tags: [sandbox, billing, proxy]
---

# Sandbox Billing — Proxy-Driven Audit Log Pipeline

## How It Works

The agent never touches billing. The nginx proxy captures billing data from every LLM call, and the host reads it after the run.

```
 SANDBOX CONTAINER (network=none)          NGINX PROXY (sandbox-internal)           LiteLLM
 ┌──────────────────────────┐              ┌───────────────────────────┐            ┌────────┐
 │                          │  socat       │                           │            │        │
 │  Agent calls LLM ───────────────────►   │  1. Inject billing hdrs  │            │        │
 │  localhost:8080          │  unix sock   │  2. Forward to LiteLLM  ──────────►   │  LLM   │
 │                          │              │  3. Receive response    ◄──────────    │  call  │
 │  (repeat N times)        │              │  4. Log call_id + cost   │            │        │
 │                          │              │     to access.log        │            │        │
 └──────────────────────────┘              └───────────────────────────┘            └────────┘

 After sandbox exits, HOST reads the proxy audit log:

 ┌─────────────────────────────────────────────────────────────────────────────┐
 │  HOST                                                                      │
 │                                                                            │
 │  5. docker exec cat access.log  →  raw log lines                           │
 │  6. parseAuditLog()             →  ProxyBillingEntry[] (callId + costUsd)  │
 │  7. Attach to SandboxRunResult.proxyBillingEntries                         │
 │  8. Emit usage_report per entry →  commitUsageFact()                       │
 │                                 →  recordChargeReceipt()                   │
 └─────────────────────────────────────────────────────────────────────────────┘
```

Steps 5–8 run on ALL exit paths (success, timeout, OOM, error). LLM calls before failure are still billed.

The proxy is **ephemeral — one per run**. `LlmProxyManager.start()` generates an nginx config from the template by substituting the caller's `billingAccountId`, `runId`, and `LITELLM_MASTER_KEY`, then starts a fresh `nginx:alpine` container on the `sandbox-internal` Docker network. The sandbox and proxy share a Docker volume at `/llm-sock/` for the unix socket. On stop, the proxy container is removed.

## Component Responsibilities

| Component                      | Responsibility                                                                  | Key file                                                    |
| ------------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **Nginx proxy**                | Injects billing headers, logs `call_id` + `cost` per request                    | `platform/infra/services/sandbox-proxy/nginx.conf.template` |
| **LlmProxyManager**            | Starts/stops proxy container, parses audit log → `ProxyBillingEntry[]`          | `src/adapters/server/sandbox/llm-proxy-manager.ts`          |
| **SandboxRunnerAdapter**       | Runs sandbox container, threads billing entries into `SandboxRunResult`         | `src/adapters/server/sandbox/sandbox-runner.adapter.ts`     |
| **SandboxGraphProvider**       | Emits `usage_report` AiEvent per billing entry (with `usageUnitId` + `costUsd`) | `src/adapters/server/sandbox/sandbox-graph.provider.ts`     |
| **billing.ts**                 | Consumes `usage_report` → `commitUsageFact()` → `recordChargeReceipt()`         | `src/features/ai/services/billing.ts`                       |
| **Agent (run.mjs / OpenClaw)** | Billing-ignorant. Still captures `litellmCallId` in stdout for debug only.      | `services/sandbox-runtime/agent/run.mjs`                    |

## Invariants

1. **BILLING_FROM_PROXY_NOT_AGENT** — Billing data comes from the nginx audit log, never from agent stdout.
2. **UNIFORM_MECHANISM** — Single-call (run.mjs) and multi-call (OpenClaw) agents use the identical billing path. No branching.
3. **USAGE_UNIT_IS_LITELLM_CALL_ID** — `usageUnitId` sourced from `x-litellm-call-id` response header captured in audit log.
4. **COST_FROM_RESPONSE_HEADER** — `costUsd` sourced from `x-litellm-response-cost`. When absent, billing.ts logs CRITICAL but still records (degraded mode).
5. **BILLING_ON_ALL_PATHS** — Billing entries collected on timeout, OOM, and error paths.
6. **SECRETS_HOST_ONLY** — `LITELLM_MASTER_KEY` exists only in proxy container. Sandbox never sees it.
7. **HOST_INJECTS_BILLING_HEADER** — Proxy unconditionally overwrites `x-litellm-end-user-id` and `x-litellm-spend-logs-metadata`. Sandbox cannot spoof billing identity.

## Audit Log Format

Nginx key=value format. `parseAuditLog()` extracts two fields per line:

- `litellm_call_id=<value>` → `ProxyBillingEntry.litellmCallId` (lines with `-` or absent are skipped — health checks)
- `litellm_response_cost=<value>` → `ProxyBillingEntry.costUsd` (parseFloat; undefined if `-` or NaN)

`copyLogFromContainer()` uses `demuxDockerStream()` to strip Docker multiplexed frame headers before writing to disk.

## Port Types

```typescript
// src/ports/sandbox-runner.port.ts

interface ProxyBillingEntry {
  readonly litellmCallId: string; // x-litellm-call-id
  readonly costUsd?: number; // x-litellm-response-cost
}

interface SandboxRunResult {
  // ...stdout, stderr, exitCode, etc.
  readonly proxyBillingEntries?: readonly ProxyBillingEntry[];
}
```

## Comparison with In-Proc

Both paths produce the same `UsageFact` shape. The difference is where headers are captured:

- **In-proc:** `InProcCompletionUnitAdapter` reads LiteLLM response headers directly, emits `usage_report` immediately.
- **Sandbox:** Nginx proxy writes headers to audit log. Host parses log post-run, `SandboxGraphProvider` emits `usage_report` per entry.
