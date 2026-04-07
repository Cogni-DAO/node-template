---
id: bug.0300
type: bug
title: "Codex executor silently drops all core__ tools — BYO-AI agents have no VCS/schedule/work-item capabilities"
status: needs_implement
priority: 0
rank: 1
estimate: 5
summary: "CodexLlmAdapter strips all LangGraph tools because Codex SDK only supports MCP for external tools. Fix: internal MCP Streamable HTTP server on separate port, started via instrumentation.ts, exposing ToolSourcePort tools to Codex via bearer-token-scoped bridge."
outcome: "Any graph running on any executor (Cogni or Codex) has access to the same core__ tools. Codex reaches them via MCP; Cogni reaches them via toolRunner.exec(). One tool plane, multiple transports."
spec_refs: [spec.tool-use]
assignees: []
credit: []
project: proj.cicd-services-gitops
branch: bug/0300-codex-core-tool-bridge
pr: 805
reviewer:
revision: 2
blocked_by:
deploy_verified: false
created: 2026-04-06
updated: 2026-04-07
labels: [ai, infra, p0, architecture]
external_refs:
---

# Codex executor silently drops all core\_\_ tools

## Observed

When a user selects ChatGPT/Codex as their AI backend and runs the `git-manager` graph:

1. Graph defines 11 tools via `GIT_MANAGER_TOOL_IDS` (VCS, schedule, work-item, repo)
2. `makeCogniGraph` resolves all 11 from `TOOL_CATALOG` — no errors
3. `CodexLlmAdapter.completionStream()` receives `params.tools` with all 11
4. **Line 92-104: adapter logs `INVARIANT_DEVIATION` warning and STRIPS ALL TOOLS**
5. Codex subprocess runs with only external MCP servers (grafana, playwright)
6. Agent responds "I only have local terminal tooling" — no VCS, no scheduling, no work items

**This is not a bug in the adapter** — Codex SDK genuinely cannot consume OpenAI function-calling format tools. Its external tool path is MCP via `config.toml`. The bug is architectural: we have no bridge between our internal tool plane and the MCP transport Codex requires.

### Evidence

- Canary logs 2026-04-06 ~21:07 UTC: `langgraph:git-manager` graph executed (12.2s), zero `core__vcs` tool calls
- Agent chat response: "For this session, I only have local terminal tooling, not the GitHub App core\_\_\* APIs"
- Same graph on 4o-mini (Cogni executor) has full tool access

### Impact

- **All BYO-AI (Codex) users** lose access to core\_\_ tools on every graph
- git-manager, pr-review, brain — any graph with tools is degraded on Codex
- Users see a working chat interface but the agent is lobotomized

## Root Cause

`CodexLlmAdapter` implements `LlmService` by spawning a Codex subprocess. Codex SDK's only external tool integration is MCP servers declared in `config.toml`. The adapter correctly identifies this mismatch but has no bridge to expose core\_\_ tools over MCP.

## Design

### Outcome

Codex-backed graph executions have access to the same core\_\_ tools as Cogni executor via an internal MCP Streamable HTTP bridge. Fail-closed if bridge unavailable.

### Approach

**Solution**: Real MCP Streamable HTTP server on a separate port (`MCP_TOOL_BRIDGE_PORT`, default 3001) using `@modelcontextprotocol/sdk` StreamableHTTPServerTransport with raw `http.createServer()`. Started via `instrumentation.ts` (once per process). Container deps wired lazily from bootstrap (dep-cruiser forbids instrumentation→bootstrap imports). Bearer token auth per-run, graph-scoped tool listing, tool execution via `toolRunner.exec()`.

**Reuses**:

- `ToolSourcePort` from container — runtime-bound tool source (per NO_DEFAULT_EXECUTABLE_CATALOG)
- `createToolRunner()` from `@cogni/ai-core` — existing execution pipeline
- `@modelcontextprotocol/sdk` v1.28.0 — already in lockfile
- `codex-mcp-config.ts` — existing config.toml generator
- `run-scope-store.ts` — already implemented (ephemeral token store)

**Rejected**:

- **Next.js API route**: SDK's `StreamableHTTPServerTransport.handleRequest()` needs `IncomingMessage`/`ServerResponse`. App Router provides Web API `Request`/`Response`. Incompatible.
- **Hand-rolled JSON-RPC**: Protocol non-compliant. Partial MCP imitation that would break on batching, SSE, session management.
- **New `packages/mcp-server`**: Violates PURE_LIBRARY — needs process lifecycle, env vars, DI container.
- **Sidecar/standalone service**: Unnecessary complexity for same-process, same-trust-boundary bridge.

### Architecture

```
Process boot (instrumentation.ts register()):
  startMcpHttpServer(3001)
  → http.createServer on 127.0.0.1:3001
  → StreamableHTTPServerTransport bound to POST/GET/DELETE /mcp
  → McpServer created (tools not yet registered — deps lazy)

Bootstrap (container.ts, after container built):
  setMcpDeps({ toolSource: container.toolSource })
  → Registers tools from ToolSourcePort.listToolSpecs()
  → MCP server can now handle tool calls

Per Codex run (CodexLlmAdapter.completionStream()):
  1. isMcpBridgeReady() → if false + tools needed → ERROR (fail-closed)
  2. generateRunToken({runId, userId, graphId, toolIds}) → bearer token
  3. withInternalToolBridge(mcpConfig, 3001) → adds cogni_tools to config.toml
  4. COGNI_MCP_TOKEN=<token> in scoped env via bearerTokenEnvVar
  5. Codex subprocess spawns

MCP request flow (per-request, no shared mutable state):
  1. HTTP handler receives (req: IncomingMessage, res: ServerResponse)
  2. Extract bearer token from req.headers.authorization
  3. resolveRunToken(token) → RunScope {runId, userId, graphId, toolIds}
  4. Set req.auth = { token, clientId: "codex", scopes: [], extra: { runScope } }
     (StreamableHTTPServerTransport reads req.auth per SDK API)
  5. transport.handleRequest(req, res)
  6. Transport propagates req.auth → extra.authInfo in tool callbacks
  7. Tool callback reads extra.authInfo.extra.runScope → RunScope

  tools/list:
    → ToolSourcePort.listToolSpecs() filtered to scope.toolIds
    → Graph-scoped, not full catalog

  tools/call:
    → Verify toolName in scope.toolIds
    → createToolRunner(toolSource, emit, {policy, ctx: {runId}})
    → toolRunner.exec(toolName, args)
    → validation → policy → execution → redaction
    → MCP tool_result

Run cleanup (finally block):
  deleteRunToken(token)
```

### Auth Model

- **Bearer token** (`Authorization` header) → resolves `RunScope`. Ephemeral per-run, crypto-random UUID, in-memory Map with TTL. Auth/scope mechanism.
- **MCP Session ID** (`Mcp-Session-Id` header) → managed by `StreamableHTTPServerTransport`. Separate protocol concern. Do not conflate with bearer token.
- Binding: `127.0.0.1` only, same trust boundary. Origin validation via transport config.

### Fail-Closed Policy

If bridge unavailable (not started, deps not wired) and Codex run has tools:

- **Error**, not warn — run MUST fail with clear message
- `isMcpBridgeReady()` checked before Codex subprocess spawn
- Log: `error` when bridge absent + tools needed; `info` when bridge active

### Concurrency

- `run-scope-store` Map: safe in single-threaded Node.js event loop
- Per-tool-call `toolRunner` instance: no shared state between requests
- Per-run bearer token: concurrent Codex sessions use different tokens
- Auth context on `req` object: per-request, not module-global
- `StreamableHTTPServerTransport` manages its own session state per MCP protocol

### Lifecycle

| Phase            | Hook                                 | Action                                            |
| ---------------- | ------------------------------------ | ------------------------------------------------- |
| Process boot     | `instrumentation.ts register()`      | `startMcpHttpServer(port)`                        |
| Container init   | `bootstrap/container.ts`             | `setMcpDeps({toolSource})` — lazy wiring          |
| Per-run          | `CodexLlmAdapter.completionStream()` | `generateRunToken()` + `withInternalToolBridge()` |
| Run end          | `runCodexExec()` finally block       | `deleteRunToken()`                                |
| Process shutdown | SIGTERM handler                      | Close HTTP server                                 |

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] TOOLS_VIA_TOOLRUNNER: all tool calls route through toolRunner.exec() (spec.tool-use #1)
- [ ] NO_DEFAULT_EXECUTABLE_CATALOG: bridge uses ToolSourcePort from container, not raw TOOL_CATALOG (#33)
- [ ] DENY_BY_DEFAULT: graph-scoped policy from scope.toolIds (#20)
- [ ] GRAPH_SCOPED_TOOLS: tools/list filtered to run's toolIds
- [ ] EPHEMERAL_TOKEN: per-run UUID, TTL, deleted in finally
- [ ] FAIL_CLOSED: error when bridge absent + tools needed
- [ ] AUTH_MODEL_SEPARATION: bearer token for scope, MCP session ID for protocol
- [ ] CODEX_ENV_SCOPED: only COGNI_MCP_TOKEN in env whitelist
- [ ] NO_SHARED_MUTABLE_CONTEXT: auth propagated per-request via req.auth, not module globals

### Files

**Rewrite**:

- `nodes/*/app/src/mcp/server.ts` — McpServer + http.createServer + StreamableHTTPServerTransport + lazy deps

**Keep**:

- `nodes/*/app/src/mcp/run-scope-store.ts` — already correct

**Delete**:

- `nodes/*/app/src/app/api/internal/mcp/route.ts` — replaced by raw HTTP server

**Modify**:

- `nodes/*/app/src/instrumentation.ts` — add `startMcpHttpServer()` call
- `nodes/*/app/src/bootstrap/container.ts` — add `setMcpDeps()` call
- `nodes/*/app/src/adapters/server/ai/codex/codex-mcp-config.ts` — port 3001, `withInternalToolBridge()`
- `nodes/*/app/src/adapters/server/ai/codex/codex-llm.adapter.ts` — fail-closed + hasMcpBridge fix

### What this does NOT change

- `@cogni/ai-tools` — stays protocol-agnostic, no MCP imports
- `@cogni/ai-core` — toolRunner unchanged
- `@cogni/langgraph-graphs` — graph definitions unchanged, Cogni executor path unchanged
- Graph catalog — no graph changes needed
- Policy enforcement — still in toolRunner via existing pipeline
- Billing — Codex is user-funded ($0 platform cost), no billing changes

## Allowed Changes

- `nodes/*/app/src/mcp/server.ts`
- `nodes/*/app/src/instrumentation.ts`
- `nodes/*/app/src/bootstrap/container.ts`
- `nodes/*/app/src/adapters/server/ai/codex/codex-mcp-config.ts`
- `nodes/*/app/src/adapters/server/ai/codex/codex-llm.adapter.ts`
- `nodes/*/app/src/app/api/internal/mcp/` (delete)

## Validation

1. `pnpm check:fast` passes
2. Local E2E: `pnpm dev:stack` → MCP server on 3001 → Codex chat with git-manager → tools work
3. Fail-closed: stop bridge → Codex run with tools → clear error

## PR / Links

- PR #805: https://github.com/Cogni-DAO/node-template/pull/805
- Canary logs 2026-04-06 ~21:07 UTC: git-manager graph executed with zero tool calls via Codex
- Handoff: [handoff](../handoffs/bug.0300.handoff.md)

## Attribution

- Discovered during deployment monitoring session 2026-04-06
- Root cause traced through CodexLlmAdapter → config.toml → MCP-only tool path
