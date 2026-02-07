---
id: sandbox-scaling-spec
type: spec
title: Sandbox Proxy Scaling Design
status: active
spec_state: draft
trust: draft
summary: Proxy selection, per-run architecture, threat model, and decision criteria for sandboxed agent LLM gateway
read_when: Evaluating proxy architecture for sandbox agents, reviewing threat model, or planning proxy upgrade
owner: derekg1729
created: 2026-02-06
verified: 2026-02-07
tags: [sandbox, proxy, security]
---

# Sandbox Proxy Scaling Design

> Scaling strategy for sandboxed agent LLM gateway. Covers proxy selection, per-run vs shared proxy tradeoffs, trusted attribution at concurrency, and threat model.
>
> **Prerequisite**: [SANDBOXED_AGENTS.md](../SANDBOXED_AGENTS.md) for core invariants, current architecture, and phase definitions.

## Context

Sandboxed agents run in `network=none` containers and route LLM calls through a proxy that injects billing headers and API keys. This spec documents the proxy technology evaluation, the current per-run proxy architecture, and the threat model for the sandbox gateway.

## Goal

Define the proxy selection rationale, per-run proxy architecture (current), and threat model for the sandbox LLM gateway. Provide decision criteria for future proxy upgrades.

## Non-Goals

- Shared long-lived proxy implementation (see [ini.sandboxed-agents](../../work/initiatives/ini.sandboxed-agents.md))
- Signed run token scheme (P1+ reference, deferred)
- CogniGateway Node.js service (P1+ tool execution)

## Core Invariants

Proxy invariants are enforced via the parent [SANDBOXED_AGENTS.md](../SANDBOXED_AGENTS.md) invariants 1–12. Key relevant invariants:

- **SECRETS_HOST_ONLY** (inv 4): `LITELLM_MASTER_KEY` only in proxy config dir, never in sandbox-mounted directories
- **NETWORK_DEFAULT_DENY** (inv 3): Sandbox containers have `NetworkMode: 'none'`
- **BILLING_VIA_PROXY** (inv 11): All LLM calls transit proxy with billing headers injected

## Design

### OSS Proxy Comparison

Evaluated for: unix socket bind (proxy listens on socket), header strip/inject, SSE streaming, dynamic per-request headers, config complexity.

> **Note**: "Socket Bind" = proxy binds a listener to a unix socket (our use case). This is distinct from "socket upstream" (proxy connects to a backend via socket), which most proxies support but is not what we need.

| Criterion                       | nginx:alpine | OpenResty:alpine       | Envoy (distroless)       | HAProxy:alpine         | Caddy:alpine | Traefik     |
| ------------------------------- | ------------ | ---------------------- | ------------------------ | ---------------------- | ------------ | ----------- |
| **Unix Socket Bind (listener)** | Native       | Native                 | Native (pipe address)    | Native (bind)          | Supported    | **NO**      |
| **Header Strip + Inject**       | Static only  | Static + Dynamic (Lua) | Static + Limited Dynamic | Static + Dynamic (Lua) | Static only  | Static only |
| **SSE/Streaming**               | Excellent    | Excellent              | Good (needs tuning)      | Good (timeout tuning)  | Good         | Fair        |
| **Config Complexity**           | **Very Low** | Low-Moderate           | High                     | Low-Moderate           | Low          | High        |
| **Dynamic Per-Request Headers** | No           | **YES (Lua)**          | Limited                  | YES (Lua)              | No           | No          |
| **Lua/Scripting**               | None         | **Full LuaJIT**        | Limited Lua filter       | Built-in Lua 5.3       | None         | None        |

**Disqualified**: Traefik -- cannot bind a listener to a unix socket in Docker ([known panic](https://github.com/traefik/traefik/issues/10924)).

**Eliminated**: Envoy (over-engineered for this use case, verbose YAML, limited Lua). Caddy (no scripting runtime, requires custom Go module for dynamic headers).

**Viable at scale**: nginx:alpine (static config only), **OpenResty:alpine** (dynamic + static), HAProxy:alpine (dynamic + static).

### Selection

| Phase              | Proxy                        | Why                                                                                                                 |
| ------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **P0.5** (current) | `nginx:alpine`               | Simplest. Static config via `envsubst`. 10 MB. Config-only, no code.                                                |
| **P1+** (scale)    | `openresty/openresty:alpine` | Drop-in nginx superset. Existing `nginx.conf.template` works unmodified. Add Lua only when dynamic behavior needed. |

OpenResty is preferred over HAProxy for the upgrade path because: (1) existing nginx config works unchanged, (2) richer Lua ecosystem (`lua-resty-hmac`, `lua-resty-jwt`), (3) better community docs for unix socket + SSE + header injection pattern.

### Per-Run Proxy (P0.5 — Current)

One `nginx:alpine` container per sandbox run, with runId/attempt/key baked into static config via `envsubst`.

| Property             | Value                                                |
| -------------------- | ---------------------------------------------------- |
| Attribution trust    | Trivial -- runId in static config, cannot be spoofed |
| Container overhead   | ~2-5 MB RAM, ~100-200ms startup per proxy            |
| Concurrency ceiling  | ~50 simultaneous runs practical                      |
| Audit isolation      | Natural -- one log file per run                      |
| Secret scoping       | Each proxy has its own `LITELLM_MASTER_KEY` copy     |
| Failure blast radius | Proxy crash kills one run                            |

**Verdict**: Correct for P0.5. Overhead negligible for single-digit concurrency. Simplicity advantage is overwhelming.

### Threat Model

All mitigations assume core invariants from [SANDBOXED_AGENTS.md](../SANDBOXED_AGENTS.md) are enforced.

| Attack                              | Mitigation                                                                   | Enforcement Point                                             | Residual Risk                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Exfiltrate `LITELLM_MASTER_KEY`     | Key only in proxy config dir (`conf/`), never in sandbox-mounted `sock/` dir | LlmProxyManager split: `sock/` shared, `conf/` proxy-only     | None -- key physically absent from sandbox                             |
| Bypass attribution (spoof identity) | Per-run: static config overwrites all `x-litellm-*` headers. Shared: HMAC    | nginx `proxy_set_header` override / OpenResty `access_by_lua` | None -- unconditional override or cryptographic verification           |
| Reach internet from sandbox         | `NetworkMode: 'none'` -- no network stack                                    | SandboxRunnerAdapter container creation                       | None -- kernel-enforced                                                |
| Pivot to Docker socket              | Socket not mounted, `CapDrop: ALL`, `no-new-privileges`                      | SandboxRunnerAdapter security hardening                       | None -- socket physically absent                                       |
| Poison audit logs                   | Logs written by proxy container, not sandbox                                 | nginx `access_log` in proxy container                         | Low -- sandbox could inflate volume via high request count             |
| Consume unbounded LLM tokens        | P0.5: sandbox timeout. P1+: rate limiting in proxy                           | Container `maxRuntimeSec` / OpenResty `lua-resty-limit-req`   | **Accepted in P0.5**. LiteLLM per-key spend limits as backstop         |
| Cross-run traffic via shared socket | Per-run: unique socket dir. Shared: HMAC token scoped to runId               | Filesystem isolation / token expiry + signature               | None with per-run. Low with shared (token replay within expiry window) |
| Fork bomb / resource exhaustion     | `PidsLimit: 256`, `maxMemoryMb`, `maxRuntimeSec`                             | Docker container resource limits                              | Low -- limits kernel-enforced                                          |
| Exfiltrate workspace data via LLM   | Not mitigated -- inherent to running an agent with LLM access                | None                                                          | **Accepted**. Data classification deferred to P2                       |

### Decision Criteria (Ranked)

1. **Fewest moving parts** -- count processes/containers/config surfaces
2. **Security posture** -- secrets containment, spoof resistance, egress control
3. **Attribution correctness** -- trusted runId/attempt, never client-asserted
4. **Hermetic reproducibility** -- Docker-only dev + CI parity
5. **Scalability** -- supports long-running sandboxes and concurrent runs

## Acceptance Checks

**Automated:**

- `pnpm check:docs` — validates spec frontmatter and required headings

**Manual:**

1. Verify per-run proxy creates one nginx container per sandbox run
2. Verify proxy injects `x-litellm-end-user-id` and `x-litellm-spend-logs-metadata` headers
3. Verify `LITELLM_MASTER_KEY` is not accessible from sandbox container

## Open Questions

None — all design decisions resolved for P0.5. Future proxy upgrade decisions tracked in [ini.sandboxed-agents](../../work/initiatives/ini.sandboxed-agents.md).

## Related

- **Initiative:** [ini.sandboxed-agents](../../work/initiatives/ini.sandboxed-agents.md) — Proxy scaling migration plan, shared proxy, signed run tokens
- [Sandboxed Agents](../SANDBOXED_AGENTS.md) — Core sandbox invariants 1–12, phase definitions (pending migration)
- [OpenClaw Sandbox Spec](openclaw-sandbox-spec.md) — Invariants 13-19, container image, LLM protocol
- [OpenClaw Sandbox Controls](openclaw-sandbox-controls.md) — Invariants 20-25, dynamic catalog, git relay
- [External Executor Billing](external-executor-billing.md) — Reconciliation pattern, billing invariants
