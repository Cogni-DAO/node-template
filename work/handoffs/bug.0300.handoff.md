---
id: bug.0300.handoff
type: handoff
work_item_id: bug.0300
status: active
created: 2026-04-07
updated: 2026-04-07
branch: bug/0300-codex-core-tool-bridge
last_commit: 77a5fb00b
---

# Handoff: MCP Tool Bridge for Codex Executor (bug.0300)

## Context

- Codex executor (ChatGPT backend) silently drops all 11 core\_\_ tools — agents are lobotomized
- Root cause: Codex SDK only supports MCP for external tools; our tools use LangGraph function-calling
- Fix: internal MCP Streamable HTTP server at `127.0.0.1:1729/mcp` bridges core\_\_ tools to Codex
- Infrastructure is **working end-to-end**: bridge starts, Codex connects, tools are discovered
- Remaining issue: Codex discovers tools but tears down the MCP session before calling them

## Current State

- PR #805 open against canary: https://github.com/Cogni-DAO/node-template/pull/805
- CI: static ✅, unit ✅, component ✅, stack-test ✅, sonar ✅ (on commit `5f9f62a`)
- Architecture: 0 dep-cruiser violations, bridge lives in `adapters/server/mcp/` (correct layer)
- Local E2E verified: bridge receives 5 MCP requests (POST init, POST tools/list, GET SSE, POST, DELETE teardown)
- **Blocker**: Codex tears down the MCP session immediately after tool discovery — the DELETE happens before the model generates any response. Tools are listed but never called. Agent falls back to `gh` CLI (which fails without GH_TOKEN in sandbox)
- Spec invariant #1 updated in `docs/spec/tool-use.md` — generic boundary adapter language
- Follow-up bug.0301 filed for extracting bridge from `bootstrap/container.ts` to proper runtime

## Decisions Made

- Bearer token for scope, MCP session ID for protocol — separate concerns (see work item design)
- `ToolSourcePort` from container, not raw `TOOL_CATALOG` — per invariant #33 (NO_DEFAULT_EXECUTABLE_CATALOG)
- `adapters/server/mcp/` not `src/mcp/` — dep-cruiser confirmed this is a transport adapter, not a delivery layer
- Port 1729 default (avoids Temporal UI conflict on 3001)
- Fail-closed: throws when bridge absent + tools needed
- `networkAccessEnabled: true` in Codex thread options (required for HTTP MCP calls)

## Next Actions

- [ ] Diagnose why Codex tears down the MCP session before calling tools (the DELETE happens too early)
- [ ] Check if the `tools/list` response has schema issues that make Codex think tools are unusable
- [ ] Consider whether the per-session `McpServer` pattern is correct — Codex may expect a persistent server
- [ ] Try stateless transport (`sessionIdGenerator: undefined`) to see if Codex handles it differently
- [ ] If tools work: remove debug `REQUEST:` logging from `tool-bridge.ts`
- [ ] Propagate MCP bridge to poly/resy/node-template (operator-only currently)
- [ ] Add unit tests for `run-scope-store.ts` and `tool-bridge.ts`

## Risks / Gotchas

- The bridge starts from `bootstrap/container.ts` via `getContainer()` — this is a hosting hack (bug.0301 tracks proper fix)
- `TOOL_CATALOG` is imported in `container.ts` for Zod schema extraction only — execution goes through `ToolSourcePort`
- Debug logging (`REQUEST:` lines) is still in `tool-bridge.ts` — remove before merge
- Pre-existing: `mcp.servers.json` ENOENT error in logs is harmless (no MCP config file in dev)
- Pre-existing: `async_hooks` error from `node-shared` is a separate canary issue

## Pointers

| File / Resource                                                        | Why it matters                                      |
| ---------------------------------------------------------------------- | --------------------------------------------------- |
| `nodes/operator/app/src/adapters/server/mcp/tool-bridge.ts`            | MCP HTTP server + session management — the bridge   |
| `nodes/operator/app/src/adapters/server/mcp/run-scope-store.ts`        | Ephemeral per-run bearer token store                |
| `nodes/operator/app/src/adapters/server/ai/codex/codex-llm.adapter.ts` | Token gen, fail-closed, networkAccessEnabled        |
| `nodes/operator/app/src/adapters/server/ai/codex/codex-mcp-config.ts`  | `withInternalToolBridge()`, port config             |
| `nodes/operator/app/src/bootstrap/container.ts:274-285`                | Bridge startup + Zod schema extraction              |
| `nodes/operator/app/src/bootstrap/graph-executor.factory.ts:225`       | Threads runContext to createLlmService              |
| `nodes/operator/app/src/ports/model-provider.port.ts:61`               | Optional `runContext` param on `createLlmService()` |
| `docs/spec/tool-use.md` invariant #1                                   | Generic boundary adapter language                   |
| `work/items/bug.0300.codex-executor-drops-core-tools.md`               | Full design doc with architecture diagrams          |
| `work/items/bug.0301.mcp-tool-bridge-hosting-hack.md`                  | Follow-up: extract bridge to proper runtime         |
