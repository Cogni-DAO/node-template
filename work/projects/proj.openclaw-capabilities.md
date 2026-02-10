---
id: proj.openclaw-capabilities
type: project
primary_charter:
title: OpenClaw Capabilities Integration
state: Active
priority: 1
estimate: 5
summary: Integrate OpenClaw's gateway protocol, agent runtime, git relay, and multi-agent capabilities into Cogni's graph execution pipeline
outcome: OpenClaw agents are fully operational via Cogni UI — gateway chat works end-to-end, billing is accurate, host-side git relay produces PRs, custom agents are configurable, and the catalog is dynamic
assignees:
  - derekg1729
created: 2026-02-09
updated: 2026-02-09
labels: [openclaw, ai-agents, sandbox]
---

# OpenClaw Capabilities Integration

> Relationship to [proj.sandboxed-agents](proj.sandboxed-agents.md): that project owns the **container sandbox layer** (Docker isolation, socket bridge, proxy plumbing, `SandboxRunnerPort`). This project owns everything **above** that layer: gateway protocol client, agent catalog wiring, UI integration, git relay, multi-agent routing, and OpenClaw-specific capabilities.

## Goal

Make OpenClaw a fully integrated, production-quality agent runtime within Cogni. Users select OpenClaw agents from the chat UI, messages flow through the gateway protocol, responses stream back with billing, and code-producing agents can create PRs via host-side git relay — all without OpenClaw's own UI or any credential leakage into containers.

## Roadmap

### Crawl (P0) — Gateway Chat E2E

**Goal:** OpenClaw agent is selectable in the Cogni UI and produces real chat responses with accurate billing. The gateway WS client correctly implements the full protocol lifecycle.

#### Gateway Client

The production WS client must implement the OpenClaw gateway protocol correctly. Reference implementation: `openclaw/src/gateway/client.ts` (upstream).

| Deliverable                                                                               | Status      | Est | Work Item |
| ----------------------------------------------------------------------------------------- | ----------- | --- | --------- |
| Gateway client `runAgent()` generator — correct ACK → deltas → final res lifecycle        | In Progress | 3   | task.0008 |
| `extractTextFromResult()` — extract content from authoritative `result.payloads`          | In Progress | 1   | task.0008 |
| `configureSession()` — per-session outboundHeaders via `sessions.patch`                   | Done        | 1   | —         |
| Stack test: gateway WS chat returns real content (not ACK JSON)                           | In Progress | 1   | task.0008 |
| Stack test: billing entries in proxy audit log after gateway call                         | In Progress | 1   | task.0008 |
| Stack test: LITELLM_MASTER_KEY not in gateway container env                               | Done        | 1   | —         |
| **Blocker:** OpenClaw v2026.2.4 agent returns empty payloads (content silently discarded) | In Progress | 1   | bug.0009  |

**Protocol state machine (from upstream `client.ts` `expectFinal` semantics):**

```
handshake: challenge → connect(auth) → hello-ok
agent call: req(agent) → ACK res(accepted) → chat delta events (0–N)
            → chat final signal (NOT terminal) → final "ok" res with result.payloads (terminal)
```

#### Gateway Service Operations

The gateway is a long-running service (externally-built image, compose-managed). It needs the same operational rigor as any other service: CI builds, model catalog, documentation, root scripts. This is a new pattern — **external image service** — not covered by the current `create-service.md` guide.

| Deliverable                                                                                                                                                                     | Status      | Est | Work Item |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --- | --------- |
| Production model catalog in `openclaw-gateway.json` — sync model list from LiteLLM config (currently only `test-model`)                                                         | Not Started | 1   | (create)  |
| Root script `sandbox:openclaw:docker:build` for ephemeral image (parity with `sandbox:docker:build`)                                                                            | Not Started | 0.5 | (create)  |
| CI: build `cogni-sandbox-openclaw` image in stack-test job (`docker/build-push-action` + GHA cache)                                                                             | Not Started | 1   | (create)  |
| CI: start `llm-proxy-openclaw` + `openclaw-gateway` in stack-test compose `up` (with `mock-llm` backend)                                                                        | Not Started | 1   | (create)  |
| Gateway stack tests (`sandbox-openclaw.stack.test.ts`) pass in CI — currently local-only, blocked by above                                                                      | Not Started | 1   | (create)  |
| Update `services/sandbox-openclaw/AGENTS.md` — document gateway mode, compose services, config, proxy                                                                           | Not Started | 0.5 | (create)  |
| Update `services-architecture.md` Existing Services table — add `openclaw-gateway` (external image), `llm-proxy-openclaw` (nginx sidecar), `sandbox-openclaw` (ephemeral image) | Not Started | 0.5 | (create)  |
| Add "External Image Service" variant to `create-service.md` — lighter checklist for pre-built images (compose + config + healthcheck + CI, no package.json/tsconfig/src)        | Not Started | 1   | (create)  |

**Key distinction**: `openclaw-gateway` uses `openclaw-outbound-headers:latest` (built in the OpenClaw repo, published to GHCR). We don't own that Dockerfile — we configure it via bind-mounted `openclaw-gateway.json` and deploy via compose. `cogni-sandbox-openclaw` (ephemeral) is the image we DO build from `services/sandbox-openclaw/Dockerfile`. Both need CI coverage.

#### Agent Catalog + UI Wiring

| Deliverable                                                                       | Status | Est | Work Item |
| --------------------------------------------------------------------------------- | ------ | --- | --------- |
| `sandbox:openclaw` in `SANDBOX_AGENTS` registry (gateway execution mode)          | Done   | 1   | —         |
| `sandbox:openclaw` in `SandboxAgentCatalogProvider` descriptors                   | Done   | 1   | —         |
| `sandbox:openclaw` selectable in ChatComposerExtras (hardcoded, temporary)        | Done   | 1   | —         |
| Proxy billing reader for gateway mode (`ProxyBillingReader.readEntries`)          | Done   | 1   | —         |
| Bootstrap wiring: `LazySandboxGraphProvider` with gateway client + billing reader | Done   | 1   | —         |

### Walk (P1) — Robustness + Dynamic Catalog + Git Relay

**Goal:** Gateway client is production-grade (persistent connection, reconnect, liveness). UI discovers agents from API instead of hardcoded list. Code-producing agents create PRs via host-side git relay.

#### Gateway Client Hardening

Model after upstream `openclaw/src/gateway/client.ts` features:

| Deliverable                                                                                    | Status      | Est | Work Item            |
| ---------------------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Persistent WS connection — connect once at bootstrap, reuse for all calls                      | Not Started | 2   | (create at P1 start) |
| Generic `request<T>(method, params, { expectFinal })` replacing per-method bespoke WS handling | Not Started | 2   | (create at P1 start) |
| `pending` map with `flushPendingErrors` on close (upstream lines 82, 362-367)                  | Not Started | 1   | (create at P1 start) |
| Auto-reconnect with exponential backoff (upstream `scheduleReconnect`, lines 349-360)          | Not Started | 2   | (create at P1 start) |
| Tick-based liveness detection (upstream `startTickWatch`, lines 369-386)                       | Not Started | 1   | (create at P1 start) |

**Features from upstream we do NOT need:** device identity/keypair signing, TLS fingerprint pinning, device auth token store/rotate (all server-to-server token auth is sufficient).

#### Dynamic Agent Catalog

Per [openclaw-sandbox-controls.md](../../docs/spec/openclaw-sandbox-controls.md) invariant CATALOG_FROM_API:

| Deliverable                                                                          | Status      | Est | Work Item            |
| ------------------------------------------------------------------------------------ | ----------- | --- | -------------------- |
| Replace hardcoded `AVAILABLE_GRAPHS` in `ChatComposerExtras` with `useAgents()` hook | Not Started | 2   | (create at P1 start) |
| Deduplicate agent name/description — catalog should derive from execution registry   | Not Started | 1   | (create at P1 start) |

#### Host-Side Git Relay

Per [openclaw-sandbox-controls.md](../../docs/spec/openclaw-sandbox-controls.md) invariant HOST_SIDE_GIT_RELAY:

| Deliverable                                                                | Status      | Est | Work Item            |
| -------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Pre-run host clone into workspace (`git clone --depth=1`)                  | Not Started | 2   | (create at P1 start) |
| Post-run host reads git log/diff for changes                               | Not Started | 1   | (create at P1 start) |
| Host pushes branch `sandbox/${runId}` using `GITHUB_TOKEN`                 | Not Started | 2   | (create at P1 start) |
| Host creates PR via GitHub API if requested                                | Not Started | 2   | (create at P1 start) |
| Return PR URL in `GraphFinal.content`                                      | Not Started | 1   | (create at P1 start) |
| Defer workspace cleanup until push completes (WORKSPACE_SURVIVES_FOR_PUSH) | Not Started | 1   | (create at P1 start) |

### Run (P2+) — Multi-Agent, Custom Skills, Dashboard

**Goal:** Full OpenClaw capability surface — multi-agent routing, custom skill bundles, persistent sessions, and observability dashboard.

#### Multi-Agent + Custom Agents

| Deliverable                                                                         | Status      | Est | Work Item            |
| ----------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| OpenClaw multi-agent routing (`--agent` selection per-run via `agents.list` config) | Not Started | 2   | (create at P2 start) |
| Skills audit: identify sandbox-compatible skills, bundle curated set into image     | Not Started | 2   | (create at P2 start) |
| Dashboard-driven agent + skill creation (config changes via git commit)             | Not Started | 3   | (create at P2 start) |
| Persistent sessions: workspace volume across runs for DAO agents                    | Not Started | 2   | (create at P2 start) |
| Conversation continuity: inject prior messages as workspace context files           | Not Started | 2   | (create at P2 start) |

#### Credential Evolution

Per [openclaw-sandbox-controls.md](../../docs/spec/openclaw-sandbox-controls.md) invariant ENV_CREDENTIALS_FIRST:

| Deliverable                                                                        | Status      | Est | Work Item            |
| ---------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Upgrade from `GITHUB_TOKEN` to GitHub App installation auth via `ConnectionBroker` | Not Started | 3   | (create at P2 start) |
| Multi-tenant: per billing account GitHub App installations                         | Not Started | 2   | (create at P2 start) |

#### Observability

| Deliverable                                                               | Status      | Est | Work Item            |
| ------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Sandbox dashboard (`/sandbox` page): run history, per-run detail view     | Not Started | 3   | (create at P2 start) |
| Prometheus counters: `sandbox_runs_total`, `sandbox_run_duration_seconds` | Not Started | 1   | (create at P2 start) |

## Constraints

- All credential-bearing operations on host, never in sandbox or gateway container (links to SECRETS_HOST_ONLY, HOST_SIDE_GIT_RELAY in specs)
- Chat UI fetches agent list from API — no hardcoded arrays long-term (links to CATALOG_FROM_API)
- Dashboard and controls are Cogni-native Next.js — no OpenClaw Lit UI (links to COGNI_NATIVE_UI)
- Gateway client must not block on upstream OpenClaw package — our client implements the protocol directly, using upstream as reference only
- P1 uses `GITHUB_TOKEN` env var; `ConnectionBroker` deferred to P2

## Dependencies

- [x] Sandbox container infrastructure operational (proj.sandboxed-agents P0–P0.75)
- [x] OpenClaw gateway + proxy containers running (`docker compose` services)
- [x] Agent catalog API: `GET /api/v1/ai/agents` (existing)
- [x] Billing pipeline: proxy audit log → `ProxyBillingReader` → `usage_report` → `charge_receipts`
- [ ] `GITHUB_TOKEN` provisioning for P1 git relay
- [ ] `ConnectionBroker` for P2 credential evolution (proj.tenant-connections)

## As-Built Specs

- [openclaw-sandbox-controls.md](../../docs/spec/openclaw-sandbox-controls.md) — Invariants 20-25: git relay, dynamic catalog, credential strategy, anti-patterns
- [openclaw-sandbox-spec.md](../../docs/spec/openclaw-sandbox-spec.md) — Invariants 13-19: container image, LLM protocol, I/O protocol, billing
- [sandboxed-agents.md](../../docs/spec/sandboxed-agents.md) — Invariants 1-12: core sandbox architecture, socket bridge

## Design Notes

### Gateway Client: Build vs Reuse

**Upstream** (`openclaw/src/gateway/client.ts`, ~440 lines):

- Persistent connection with reconnect + backoff
- `request<T>(method, params, { expectFinal })` — generic req/res correlation
- `expectFinal` skips ACK (status=accepted), waits for real terminal response
- Tick-based liveness detection (2× tick interval → close + reconnect)
- Heavily coupled to OpenClaw internals: device identity signing, TLS fingerprint pinning, AJV validators

**Our client** (`src/adapters/server/sandbox/openclaw-gateway-client.ts`, ~500 lines):

- One WS per call (P0), should become persistent (P1)
- `runAgent()` AsyncGenerator yields typed events: accepted, text_delta, chat_final, chat_error
- Correct protocol lifecycle as of unstaged changes (ACK → deltas → chat final signal → final "ok" res)
- No device auth, no TLS pinning needed (server-to-server, localhost/docker-internal)

**Decision:** Build our own, modeled on upstream's `pending` map + `expectFinal` + reconnect patterns. Upstream is not consumable as a library (deeply coupled internals, not exported from package). P0 ships the generator pattern; P1 refactors to persistent connection.

### Research Artifacts

- [openclaw-gateway-header-injection.md](../../docs/research/openclaw-gateway-header-injection.md) — outboundHeaders investigation
- [openclaw-gateway-integration-handoff.md](../../docs/research/openclaw-gateway-integration-handoff.md) — protocol reverse-engineering, frame sequences
