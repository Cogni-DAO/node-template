# Work Items Index

> Canonical discoverability surface for all active work items.
> Agents should search this file by ID rather than listing the directory.

## Active

| Pri | Est | Status      | ID         | Title                                                                                          | Project                    | Project ID                      |
| --- | --- | ----------- | ---------- | ---------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------- |
| 0   | 2   | Done        | bug.0033   | Transient RPC errors permanently reject payments — funds taken, no credits                     | Payments Enhancements      | proj.payments-enhancements      |
| 0   | 2   | Done        | bug.0038   | Deploy pulls all 15+ images every run — SSH timeout on slow pulls                              | Reliability & Uptime       | proj.reliability                |
| 0   | 2   | Done        | bug.0015   | Deploy disk cleanup runs after pulls — disk exhaustion on 40GB VMs                             | Reliability & Uptime       | proj.reliability                |
| 0   | 2   | Done        | bug.0016   | Production compose missing OpenClaw services — silent no-op profiles                           | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 0   | 1   | Done        | bug.0049   | Deploy never syncs gateway-workspace + repo mount blocks git — agent blind and immobile        | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 0   | 2   | Done        | bug.0021   | Gateway WS client receives uncorrelated chat events — HEARTBEAT_OK leak                        | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 0   | 3   | Done        | task.0046  | System tenant bootstrap + purchase-time revenue share                                          | System Tenant & Governance | proj.system-tenant-governance   |
| 0   | 2   | Done        | task.0054  | Governance run foundation — repo-spec config + system tenant execution grant                   | System Tenant & Governance | proj.system-tenant-governance   |
| 0   | 1   | Done        | task.0052  | Get OpenClaw Grafana access — spend visibility for sandbox agents                              | Reliability & Uptime       | proj.reliability                |
| 0   | 2   | Todo        | task.0053  | Token + model optimization — stop 85K input token hemorrhage on Opus                           | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 0   | 2   | Todo        | task.0041  | Discord channel proof of life — bot connected, Cogni reads + sends via OpenClaw                | Messenger Channels         | proj.messenger-channels         |
| 0   | 2   | In Progress | task.0023  | Gateway agent system prompt — dedicated workspace, SOUL.md, heartbeat fix                      | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 0   | 1   | Backlog     | bug.0017   | Deploy does not reload Alloy when bind-mounted config changes                                  | Reliability & Uptime       | proj.reliability                |
| 0   | 1   | Backlog     | bug.0009   | OpenClaw v2026.2.4 gateway agent returns empty payloads                                        | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 0   | 3   | In Progress | task.0008  | Gateway client: correct protocol lifecycle for OpenClaw chat E2E                               | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 0   | 2   | Todo        | task.0022  | Git publish relay: credential isolation + agent-triggered host push                            | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 0   | 1   | Done        | task.0032  | Upgrade Cogni from Node 20 to Node 22 LTS                                                      | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 0   | 3   | Todo        | task.0031  | Build unified cogni-sandbox-openclaw devtools image + pnpm cache volumes                       | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 0   | 2   | Done        | bug.0071   | Governance schedule sync skips config updates — Temporal schedules stuck with stale input      | System Tenant & Governance | proj.system-tenant-governance   |
| 0   | 2   | Done        | bug.0072   | HTTP errors invisible in dashboards — no error rate metrics, agent reports 0 errors            | Reliability & Uptime       | proj.reliability                |
| 0   | 2   | Todo        | task.0070  | Governance credit health dashboard — prevent silent credit outages                             | System Tenant & Governance | proj.system-tenant-governance   |
| 1   | 3   | Todo        | story.0063 | Governance visibility dashboard — real-time AI council activity                                | System Tenant & Governance | proj.system-tenant-governance   |
| 0   | 2   | Done        | bug.0027   | Gateway billing fails in production — Docker socket ENOENT crashes all OpenClaw runs           | Payments Enhancements      | proj.payments-enhancements      |
| 0   | 2   | Backlog     | bug.0026   | Scheduler worker silently stops polling — schedules enabled but runs cease                     | Reliability & Uptime       | proj.reliability                |
| 0   | 1   | Done        | task.0029  | Callback-driven billing — LiteLLM generic_api webhook replaces log scraping                    | Unified Graph Launch       | proj.unified-graph-launch       |
| 0   | 2   | Done        | bug.0025   | Schedule creation accepts paid agents with zero credits — no credit gate                       | Unified Graph Launch       | proj.unified-graph-launch       |
| 0   | 2   | Todo        | bug.0005   | Scheduled runs invisible in Activity — no billing                                              | Unified Graph Launch       | proj.unified-graph-launch       |
| 0   | 2   | Todo        | task.0014  | VM watchdog: autoheal + HEALTHCHECK on /livez with resource limits                             | Reliability & Uptime       | proj.reliability                |
| 0   | 3   | Done        | task.0027  | Alloy infra metrics + log noise suppression + Grafana P0 alerts                                | Reliability & Uptime       | proj.reliability                |
| 0   | 1   | Backlog     | task.0028  | Create Grafana Cloud P0 alert rules (post-deploy, human)                                       | Reliability & Uptime       | proj.reliability                |
| 0   | 1   | Todo        | task.0019  | Parameterize gateway auth token — env substitution, no hardcoded secret                        | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 0   | 2   | In Progress | bug.0002   | P0 SECURITY: Deploy artifacts expose all secrets                                               | Docs System Infrastructure | proj.docs-system-infrastructure |
| 0   | 4   | In Progress | task.0001  | Docs Migration Tracker                                                                         | Docs System Infrastructure | proj.docs-system-infrastructure |
| 1   | 1   | In Progress | bug.0011   | Gateway streaming truncates output mid-sentence in UI                                          | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 1   | 2   | Done        | task.0007  | Billing enforcement decorator at GraphExecutorPort                                             | Unified Graph Launch       | proj.unified-graph-launch       |
| 1   | 3   | Todo        | task.0006  | Collapse GraphProvider — single execution interface                                            | Unified Graph Launch       | proj.unified-graph-launch       |
| 1   | 2   | Backlog     | bug.0044   | Gateway billing reader finds 0 entries in stale audit log — kills execution after graph switch | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 1   | 1   | Backlog     | bug.0036   | Chat route enqueues to closed assistant-stream controller — unhandled TypeError                |                            |                                 |
| 1   | 3   | Done        | task.0030  | Thread persistence P0 — ai_threads table, port, route bridge                                   | Thread Persistence         | proj.thread-persistence         |
| 1   | 3   | Done        | task.0042  | AI SDK streaming migration — createUIMessageStream + useChatRuntime                            | Thread Persistence         | proj.thread-persistence         |
| 0   | 3   | Todo        | bug.0056   | Thread switch aborts in-flight stream — credits consumed, response lost to user                | Thread Persistence         | proj.thread-persistence         |
| 1   | 3   | Done        | task.0035  | Thread history sidebar — list, switch, load conversations                                      | Thread Persistence         | proj.thread-persistence         |
| 1   | 3   | Todo        | task.0009  | Sandbox repo refresh: on-demand git-sync for agent workspace                                   | Sandboxed Agents           | proj.sandboxed-agents           |
| 1   | 3   | Backlog     | bug.0004   | /activity dashboard cost column broken                                                         | Payments Enhancements      | proj.payments-enhancements      |
| 1   | 1   | Todo        | task.0018  | Dynamic agent catalog in UI + OpenClaw model sync                                              | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 1   | 2   | Todo        | task.0034  | Wire OpenClaw memory search + bootstrap files for cogni-template repo context                  | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 1   | 2   | Backlog     | task.0057  | OpenClaw OSS: per-section system prompt toggles + heartbeat guard                              | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 1   | 3   | Todo        | task.0045  | Enable OpenClaw subagent spawning — upstream header fix + config + delegation                  | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 2   | 3   | Backlog     | task.0040  | Gateway memory curation worker — scan ephemeral state, persist, reset container                | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 1   | 3   | Done        | task.0010  | OpenClaw gateway model selection — session-level override                                      | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 1   | 1   | Done        | spike.0020 | Research messenger integration via OpenClaw channels                                           | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 1   | 1   | Done        | spike.0046 | Research PII-safe user context passing to OpenClaw agents                                      | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 1   | 2   | Todo        | task.0047  | OpenClaw user context v0 — inject PII-safe identity into gateway agent messages                | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 2   | 1   | Backlog     | bug.0050   | Negative credit balance breaks /credits/summary — Zod rejects balanceCredits < 0               |                            |                                 |
| 2   | 1   | Backlog     | bug.0061   | UI balance display hides negative with $0 default                                              | Payments Enhancements      | proj.payments-enhancements      |
| 2   | 1   | Backlog     | task.0064  | OpenClaw preflight cost estimate 10x audit — real token consumption                            | Reliability & Uptime       | proj.reliability                |
| 1   | 2   | Backlog     | bug.0051   | Gateway model routing has no E2E verification — spend/logs can't correlate gateway calls       | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 0   | 1   | Backlog     | bug.0067   | OpenClaw model allowlist blocks openrouter/auto — governance sessions.patch failures at 75%    | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 1   | 2   | Done        | bug.0065   | OpenClaw gateway agent uses wrong tools for governance visibility — sessions_history vs files  | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 1   | 3   | Backlog     | bug.0066   | LiteLLM reports $0 cost for gpt-4o-mini — billing creates 0-credit receipts for paid models    | Payments Enhancements      | proj.payments-enhancements      |
| 2   | 1   | Backlog     | bug.0012   | pre-commit check:docs validates all files, not just staged                                     |                            |                                 |
| 2   | 2   | Backlog     | bug.0013   | Sandbox stack tests flaky — proxy container vanishes                                           | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 2   | 2   | Backlog     | task.0055  | Dedicated DB migrator role — separate DDL from runtime DML                                     | Database Operations        | proj.database-ops               |
| 1   | 2   | Todo        | task.0043  | Wire Fumadocs docs site — render /docs and /work at /docs/\*                                   | Docs System Infrastructure | proj.docs-system-infrastructure |
| 1   | 2   | Todo        | task.0062  | Standardized LiteLLM model update workflow — REQUIRED billing validation for all new models    | Reliability & Uptime       | proj.reliability                |
| 1   | 2   | Todo        | task.0068  | Dynamic default model selection from LiteLLM config metadata                                   | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 1   | 2   | Backlog     | bug.0069   | Stack tests flaky — all 5 waitForReceipts tests time out when run as full suite                |                            |                                 |
| 1   | 1   | Backlog     | bug.0070   | OpenClaw CLI binary not executable as `openclaw` — agent CLI commands fail                     | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 2   | 3   | Todo        | task.0003  | Sweep stale doc references across the codebase                                                 | Maximize OSS Tools         | proj.maximize-oss-tools         |

> Sort: priority → status (completed last) → estimate → type

## Archived

_(none yet)_
