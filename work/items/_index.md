# Work Items Index

> Canonical discoverability surface for all active work items.
> Agents should search this file by ID rather than listing the directory.

## Active

| Pri | Rank | Est | Status          | ID         | Title                                                                                          | Project                    | Project ID                      |
| --- | ---- | --- | --------------- | ---------- | ---------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------- |
| 0   | 1    | 2   | needs_design    | bug.0002   | P0 SECURITY: Deploy artifacts expose all secrets                                               | Docs System Infrastructure | proj.docs-system-infrastructure |
| 0   | 2    | 2   | needs_design    | bug.0059   | Operator logs show only 'internal' — root cause dropped in LiteLLM adapter                     | Reliability & Uptime       | proj.reliability                |
| 0   | 3    | 2   | needs_design    | bug.0062   | OpenClaw gateway: single webchat message triggers multi-call GOVERN loop (call storm)          | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 0   | 4    | 2   | needs_design    | bug.0037   | Gateway proxy billing records $0 cost — streaming header absent                                | Payments Enhancements      | proj.payments-enhancements      |
| 0   | 5    | 3   | needs_design    | bug.0056   | Thread switch aborts in-flight stream — credits consumed, response lost to user                | Thread Persistence         | proj.thread-persistence         |
| 0   | 6    | 2   | needs_triage    | bug.0088   | Subagent LLM calls invisible in /activity — child session missing outboundHeaders              | OpenClaw Capabilities      | proj.openclaw-capabilities      |
|     |      |     | needs_triage    | bug.0091   | OpenClaw workspace path ≠ git repo path causes agent CWD mismatch                              | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 0   | 7    | 1   | needs_triage    | bug.0067   | OpenClaw model allowlist blocks openrouter/auto — governance sessions.patch failures at 75%    | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 0   | 8    | 2   | needs_design    | task.0053  | Token + model optimization — stop 85K input token hemorrhage on Opus                           | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 0   | 9    | 2   | needs_design    | task.0023  | Gateway agent workspace — dedicated context, SOUL.md, heartbeat fix                            | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 0   | 10   | 1   | needs_design    | task.0019  | Parameterize gateway auth token — env substitution, no hardcoded secret                        | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 0   | 11   | 2   | needs_design    | task.0014  | VM watchdog: autoheal + HEALTHCHECK on /livez with resource limits                             | Reliability & Uptime       | proj.reliability                |
| 0   | 12   | 1   | needs_triage    | bug.0017   | Deploy does not reload Alloy when bind-mounted config changes                                  | Reliability & Uptime       | proj.reliability                |
| 0   | 13   | 2   | needs_triage    | bug.0026   | Scheduler worker silently stops polling — schedules enabled but runs cease                     | Reliability & Uptime       | proj.reliability                |
| 0   | 14   | 2   | needs_triage    | task.0024  | Deploy-time config reconciliation — hash-based apply for bind-mounted services                 | Reliability & Uptime       | proj.reliability                |
| 0   | 15   | 2   | needs_design    | task.0022  | Git publish relay: credential isolation + agent-triggered host push                            | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 0   | 16   | 3   | needs_design    | task.0083  | Governance health brief endpoint — replace broken queries.sh with app-served health data       | System Tenant & Governance | proj.system-tenant-governance   |
| 0   | 17   | 3   | needs_design    | task.0031  | Build unified cogni-sandbox-openclaw devtools image + pnpm cache volumes                       | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 0   | 18   | 3   | needs_design    | task.0008  | Gateway client: correct protocol lifecycle for OpenClaw chat E2E                               | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 0   | 19   | 2   | needs_design    | task.0084  | Operator wallet provisioning + wiring into existing payment flow                               | AI Operator Wallet         | proj.ai-operator-wallet         |
| 0   | 20   | 2   | needs_design    | task.0085  | DAO treasury USDC sweep from operator wallet                                                   | AI Operator Wallet         | proj.ai-operator-wallet         |
| 0   | 21   | 3   | needs_design    | task.0086  | OpenRouter credit top-up via operator wallet                                                   | AI Operator Wallet         | proj.ai-operator-wallet         |
| 0   | 22   | 1   | needs_triage    | task.0028  | Create Grafana Cloud P0 alert rules (post-deploy, human)                                       | Reliability & Uptime       | proj.reliability                |
| 0   | 23   | 2   | needs_design    | task.0078  | OpenClaw reasoning token streaming — display model thinking in collapsible UI                  | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 0   | 24   | 4   | needs_design    | task.0001  | Docs Migration Tracker                                                                         | Docs System Infrastructure | proj.docs-system-infrastructure |
| 1   | 1    | 2   | needs_design    | bug.0060   | Cost authority bug: OpenRouter billed cost not flowing through LiteLLM callback                | Payments Enhancements      | proj.payments-enhancements      |
| 1   | 2    | 3   | needs_triage    | bug.0066   | LiteLLM reports $0 cost for gpt-4o-mini — billing creates 0-credit receipts                    | Payments Enhancements      | proj.payments-enhancements      |
| 1   | 3    | 1   | needs_design    | bug.0011   | Gateway streaming truncates output mid-sentence in UI                                          | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 1   | 4    | 1   | needs_design    | bug.0009   | OpenClaw v2026.2.4 gateway agent returns empty payloads                                        | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 1   | 5    | 2   | needs_triage    | bug.0044   | Gateway billing reader finds 0 entries in stale audit log — kills execution after graph switch | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 1   | 6    | 1   | needs_triage    | bug.0036   | Chat route enqueues to closed assistant-stream controller — unhandled TypeError                |                            |                                 |
| 1   | 7    | 2   | needs_triage    | bug.0051   | Gateway model routing has no E2E verification — spend/logs can't correlate gateway calls       | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 1   | 8    | 3   | needs_triage    | bug.0004   | /activity dashboard cost column broken                                                         | Payments Enhancements      | proj.payments-enhancements      |
| 1   | 9    | 2   | needs_design    | task.0062  | Standardized LiteLLM model update workflow — REQUIRED billing validation for all new models    | Reliability & Uptime       | proj.reliability                |
| 1   | 10   | 3   | needs_design    | task.0045  | Enable OpenClaw subagent spawning — upstream header fix + config + delegation                  | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 1   | 11   | 2   | needs_design    | task.0034  | Wire OpenClaw memory search + bootstrap files for cogni-template repo context                  | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 1   | 12   | 1   | needs_design    | task.0018  | Dynamic agent catalog in UI + OpenClaw model sync                                              | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 1   | 13   | 2   | needs_design    | task.0068  | Dynamic default model selection from LiteLLM config metadata                                   | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 1   | 14   | 2   | needs_triage    | task.0057  | OpenClaw OSS: per-section system prompt toggles + heartbeat guard                              | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 1   | 15   | 3   | needs_design    | task.0006  | Collapse GraphProvider — single execution interface                                            | Unified Graph Launch       | proj.unified-graph-launch       |
| 1   | 16   | 3   | needs_design    | task.0009  | Sandbox repo refresh: on-demand git-sync for agent workspace                                   | Sandboxed Agents           | proj.sandboxed-agents           |
| 1   | 17   | 2   | needs_design    | task.0043  | Wire Fumadocs docs site — render /docs and /work at /docs/\*                                   | Docs System Infrastructure | proj.docs-system-infrastructure |
| 1   | 18   | 2   | needs_design    | task.0047  | OpenClaw user context v0 — inject PII-safe identity into gateway agent messages                | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 1   | 19   | 2   | needs_triage    | task.0075  | Governance scheduled runs post status updates to Discord channel                               | Messenger Channels         | proj.messenger-channels         |
| 1   | 20   | 2   | needs_triage    | task.0076  | Dedicated Discord community agent — separate agent config with Discord-specific personality    | Messenger Channels         | proj.messenger-channels         |
| 1   | 21   | 2   | needs_design    | task.0038  | Rename tests/integration → tests/component with dependency-class subdirs                       |                            |                                 |
| 1   | 22   | 3   | needs_triage    | story.0063 | Governance visibility dashboard — real-time AI council activity                                | System Tenant & Governance | proj.system-tenant-governance   |
| 1   | 23   | 2   | needs_implement | task.0089  | Subject DID + linked DIDs — schema, derivation, session integration                            | Decentralized Identity     | proj.decentralized-identity     |
| 1   | 24   | 5   | needs_triage    | story.0081 | Work receipts, transparency log, and deterministic epoch payouts                               | Transparent Credit Payouts | proj.transparent-credit-payouts |
| 2   | 1    | 1   | needs_triage    | bug.0050   | Negative credit balance breaks /credits/summary — Zod rejects balanceCredits < 0               |                            |                                 |
| 2   | 2    | 1   | needs_design    | bug.0061   | UI balance display hides negative with $0 default                                              | Payments Enhancements      | proj.payments-enhancements      |
| 2   | 3    | 1   | needs_triage    | bug.0012   | pre-commit check:docs validates all files, not just staged                                     |                            |                                 |
| 2   | 4    | 2   | needs_triage    | bug.0013   | Sandbox stack tests flaky — proxy container vanishes                                           | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 2   | 5    | 2   | needs_triage    | bug.0069   | Stack tests flaky — all 5 waitForReceipts tests time out when run as full suite                |                            |                                 |
| 2   | 6    | 1   | needs_triage    | bug.0070   | OpenClaw CLI binary not executable as `openclaw` — agent CLI commands fail                     | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 2   | 7    | 1   | needs_triage    | bug.0034   | Secrets redaction uses regex on serialized JSON — adopt fast-redact                            |                            |                                 |
| 2   | 8    | 1   | needs_design    | task.0064  | OpenClaw preflight cost estimate 10x audit — real token consumption                            | Reliability & Uptime       | proj.reliability                |
| 2   | 9    | 2   | needs_design    | task.0039  | Billing reconciler — LiteLLM spend/logs polling in scheduler worker                            | Unified Graph Launch       | proj.unified-graph-launch       |
| 2   | 10   | 2   | needs_triage    | task.0055  | Dedicated DB migrator role — separate DDL from runtime DML                                     | Database Operations        | proj.database-ops               |
| 2   | 11   | 2   | needs_triage    | task.0048  | Sub-agent billing attribution — track which sub-agent made each LLM call                       | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 2   | 12   | 3   | needs_triage    | task.0040  | Gateway memory curation worker — scan ephemeral state, persist, reset container                | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 2   | 13   | 2   | needs_triage    | task.0077  | Discord billing user attribution — identify which Discord user triggered each LLM call         | Messenger Channels         | proj.messenger-channels         |
| 2   | 14   | 2   | needs_design    | task.0079  | Create bot-generated Discord invite link for website                                           | Messenger Channels         | proj.messenger-channels         |
| 2   | 15   | 2   | needs_design    | task.0036  | pnpm store CI/CD optimization                                                                  |                            |                                 |
| 2   | 16   | 3   | needs_design    | task.0003  | Sweep stale doc references across the codebase                                                 | Maximize OSS Tools         | proj.maximize-oss-tools         |
| 2   | 17   | 1   | needs_research  | spike.0037 | Research Tailscale/Headscale mesh VPN for Cogni infrastructure                                 |                            |                                 |

> Sort: priority ASC → rank ASC

## Done

| Pri | ID         | Title                                                                                | Project                    | Project ID                      |
| --- | ---------- | ------------------------------------------------------------------------------------ | -------------------------- | ------------------------------- |
| 0   | bug.0005   | Scheduled runs invisible in Activity — no billing                                    | Unified Graph Launch       | proj.unified-graph-launch       |
| 0   | bug.0015   | Deploy disk cleanup runs after pulls — disk exhaustion on 40GB VMs                   | Reliability & Uptime       | proj.reliability                |
| 0   | bug.0016   | Production compose missing OpenClaw services — silent no-op profiles                 | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 0   | bug.0021   | Gateway WS client receives uncorrelated chat events — HEARTBEAT_OK leak              | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 0   | bug.0025   | Schedule creation accepts paid agents with zero credits — no credit gate             | Unified Graph Launch       | proj.unified-graph-launch       |
| 0   | bug.0027   | Gateway billing fails in production — Docker socket ENOENT crashes all OpenClaw runs | Payments Enhancements      | proj.payments-enhancements      |
| 0   | bug.0033   | Transient RPC errors permanently reject payments — funds taken, no credits           | Payments Enhancements      | proj.payments-enhancements      |
| 0   | bug.0038   | Deploy pulls all 15+ images every run — SSH timeout on slow pulls                    | Reliability & Uptime       | proj.reliability                |
| 0   | bug.0049   | Deploy never syncs gateway-workspace + repo mount blocks git                         | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 0   | bug.0071   | Governance schedule sync skips config updates — Temporal stuck with stale input      | System Tenant & Governance | proj.system-tenant-governance   |
| 0   | bug.0072   | HTTP errors invisible in dashboards — no error rate metrics                          | Reliability & Uptime       | proj.reliability                |
| 0   | bug.0073   | Discord gateway receives zero dispatch events — MESSAGE_CREATE never delivered       | Messenger Channels         | proj.messenger-channels         |
| 0   | task.0027  | Alloy infra metrics + log noise suppression + Grafana P0 alerts                      | Reliability & Uptime       | proj.reliability                |
| 0   | task.0029  | Callback-driven billing — LiteLLM generic_api webhook replaces log scraping          | Unified Graph Launch       | proj.unified-graph-launch       |
| 0   | task.0032  | Upgrade Cogni from Node 20 to Node 22 LTS                                            | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 0   | task.0041  | Discord channel proof of life — bot connected, Cogni reads + sends via OpenClaw      | Messenger Channels         | proj.messenger-channels         |
| 0   | task.0046  | System tenant bootstrap + purchase-time revenue share                                | System Tenant & Governance | proj.system-tenant-governance   |
| 0   | task.0052  | Get OpenClaw Grafana access — spend visibility for sandbox agents                    | Reliability & Uptime       | proj.reliability                |
| 0   | task.0054  | Governance run foundation — repo-spec config + system tenant execution grant         | System Tenant & Governance | proj.system-tenant-governance   |
| 0   | task.0070  | Governance credit health dashboard — prevent silent credit outages                   | System Tenant & Governance | proj.system-tenant-governance   |
| 1   | bug.0065   | OpenClaw gateway agent uses wrong tools for governance visibility                    | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 1   | bug.0078   | OpenClaw subagent spawn fails with "pairing required" — LAN IP resolution            | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 1   | bug.0087   | Governance runs invisible in Langfuse Sessions — missing sessionId                   | System Tenant & Governance | proj.system-tenant-governance   |
| 1   | spike.0020 | Research messenger integration via OpenClaw channels                                 | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 1   | spike.0046 | Research PII-safe user context passing to OpenClaw agents                            | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 1   | spike.0080 | Research current identity system + design minimal DID-first refactor                 | Decentralized Identity     | proj.decentralized-identity     |
| 1   | story.0079 | DID-first identity — decentralized member identifiers with verifiable account links  | Decentralized Identity     | proj.decentralized-identity     |
| 1   | spike.0082 | Design transparency log storage, receipt signing, and distribution engine            | Transparent Credit Payouts | proj.transparent-credit-payouts |
| 1   | task.0007  | Billing enforcement decorator at GraphExecutorPort                                   | Unified Graph Launch       | proj.unified-graph-launch       |
| 1   | task.0010  | OpenClaw gateway model selection — session-level override                            | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 1   | task.0030  | Thread persistence P0 — ai_threads table, port, route bridge                         | Thread Persistence         | proj.thread-persistence         |
| 1   | task.0035  | Thread history sidebar — list, switch, load conversations                            | Thread Persistence         | proj.thread-persistence         |
| 1   | task.0042  | AI SDK streaming migration — createUIMessageStream + useChatRuntime                  | Thread Persistence         | proj.thread-persistence         |
| 1   | task.0074  | OpenClaw streaming status events — surface agent activity in UI                      | OpenClaw Capabilities      | proj.openclaw-capabilities      |

> Sort: priority ASC → ID ASC

## Archived

_(none yet)_
