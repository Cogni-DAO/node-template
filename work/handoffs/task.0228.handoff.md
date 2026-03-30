---
id: task.0228.handoff
type: handoff
work_item_id: task.0228
status: active
created: 2026-03-30
updated: 2026-03-30
branch: feat/mcp-client-mvp
last_commit: d5f97c40
---

# Handoff: MCP Client MVP + Control Plane Design

## Context

- MCP (Model Context Protocol) gives agents access to external tools — browser automation (Playwright), observability (Grafana), future: GitHub, code search, etc.
- task.0228 shipped the dev-only MVP: MCP servers as Docker Compose services, Streamable HTTP transport, tools flowing through the standard toolRunner pipeline
- Two follow-up bugs filed during the work: token usage triple attestation (bug.0231) and Codex adapter silently dropping MCP tools (bug.0232)
- Architecture spec written for the full production path: deployment registry, multi-tenant credential brokering, ToolHive integration
- Project roadmap (`proj.agentic-interop`) updated with phased MCP Control Plane deliverables

## Current State

- **task.0228 (MCP MVP): PR #657 open** against staging, `pnpm check` passes, CI should be green. Status: `done`, needs merge.
  - Playwright MCP + Grafana MCP running as Docker Compose services (profile `mcp-playwright`, ports 3003/8000)
  - `McpConnectionCache` with reconnect-on-error + TTL backstop replaces forever-singleton
  - `InProcProvider` resolves MCP tools per-graph via `mcpServerIds` in catalog
  - Frontend Tester agent has tested Grafana queries and browser navigation end-to-end
- **bug.0231 (token triple attestation): filed**, `needs_triage`. App logs underreport tokens (373 vs 1622 actual). Three disagreeing sources. No code fix yet.
- **bug.0232 (Codex silent tool drop): designed**, `needs_implement`. Codex SDK natively supports MCP via `config.toml` — adapter needs to write it scoped to graph's `mcpServerIds`. Worktree at `.claude/worktrees/bug-0232-codex-mcp` has the design commit but implementation blocked by worktree build issues — work from main repo instead.
- **Spec + project updates:** committed on `feat/mcp-client-mvp` branch, not yet pushed. Includes rewritten `mcp-control-plane.md` and updated `proj.agentic-interop` roadmap.

## Decisions Made

- [mcp-control-plane.md](../../docs/spec/mcp-control-plane.md) — full spec: current state, target state, phased roadmap, invariants
- MCP_SERVERS env var (Priority 1 in `parseMcpConfigFromEnv`) bypasses config file — this is the prod deployment path (no Dockerfile changes needed)
- ToolHive (Phase 3) requires k8s migration — flagged as deferred, not blocked
- Codex MCP: inject `config.toml` at adapter boundary (`createLlmService`), NOT through `CompletionStreamParams` — design review approved this approach
- Codex MCP tool calls bypass `toolRunner.exec()` — explicit `INVARIANT_DEVIATION: TOOLS_VIA_TOOLRUNNER`, documented with mitigations

## Next Actions

- [ ] Merge PR #657 (task.0228) to staging — CI must be green
- [ ] Push pending commits on `feat/mcp-client-mvp` (spec, project, bugs — currently local only)
- [ ] Implement bug.0232: Codex MCP config.toml injection + enforcement gate + env whitelist (branch from staging after #657 merges)
- [ ] Phase 0.5: Add MCP services to prod `docker-compose.yml` + set `MCP_SERVERS` env var in CI/deploy
- [ ] Triage bug.0231: decide whether to fix SSE stream token reporting or switch app logs to billing callback as source of truth
- [ ] Wire `closeMcpConnections()` to SIGTERM/SIGINT handlers (pre-existing gap noted in review)

## Risks / Gotchas

- `config/mcp.servers.json` is NOT in the Docker image — prod uses `MCP_SERVERS` env var, not the config file
- `MCP_CONFIG_PATH=../../config/mcp.servers.json` required in `.env.local` for `pnpm dev` (CWD is `apps/web/`)
- Codex subprocess currently inherits full `process.env` including secrets — bug.0232 design includes env whitelist fix
- Grafana MCP container has no healthcheck (Go binary, no curl/wget) — relies on `restart: unless-stopped` only
- 78 MCP tools (22 playwright + 56 grafana) is a lot of context for cheaper models — monitor token pressure

## Pointers

| File / Resource                                                        | Why it matters                                                                   |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `docs/spec/mcp-control-plane.md`                                       | Full architecture spec — current state, target state, phased roadmap, invariants |
| `work/projects/proj.agentic-interop.md`                                | Project roadmap with MCP Control Plane deliverables                              |
| `work/items/bug.0232.llmservice-silently-drops-tools.md`               | Codex MCP design — ready for implementation                                      |
| `work/items/bug.0231.token-usage-triple-attestation.md`                | Token reporting discrepancy — needs triage                                       |
| `apps/web/src/bootstrap/graph-executor.factory.ts:298-480`             | `McpConnectionCache` + `ErrorDetectingMcpToolSource`                             |
| `apps/web/src/adapters/server/ai/langgraph/inproc.provider.ts:175-310` | MCP tool resolution per-graph via `resolveMcpAndExecute()`                       |
| `apps/web/src/adapters/server/ai/codex/codex-llm.adapter.ts`           | Codex adapter — where config.toml injection goes                                 |
| `packages/langgraph-graphs/src/runtime/mcp/`                           | MCP client: `loadMcpTools`, `McpToolSource`, `parseMcpConfigFromEnv`             |
| `packages/langgraph-graphs/src/catalog.ts`                             | Graph catalog with `mcpServerIds` per entry                                      |
| `config/mcp.servers.json`                                              | MCP server config (dev). Prod uses `MCP_SERVERS` env var instead                 |
| `infra/compose/runtime/docker-compose.dev.yml`                         | playwright-mcp + grafana-mcp service definitions                                 |
| `.openclaw/skills/deployment-health/queries.sh`                        | Reference for Grafana PromQL/LogQL queries used in frontend-tester prompt        |
