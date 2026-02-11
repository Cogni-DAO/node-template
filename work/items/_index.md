# Work Items Index

> Canonical discoverability surface for all active work items.
> Agents should search this file by ID rather than listing the directory.

## Active

| Pri | Est | Status      | ID         | Title                                                                                | Project                    | Project ID                      |
| --- | --- | ----------- | ---------- | ------------------------------------------------------------------------------------ | -------------------------- | ------------------------------- |
| 0   | 2   | Done        | bug.0015   | Deploy disk cleanup runs after pulls — disk exhaustion on 40GB VMs                   | Reliability & Uptime       | proj.reliability                |
| 0   | 2   | Done        | bug.0016   | Production compose missing OpenClaw services — silent no-op profiles                 | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 0   | 2   | Done        | bug.0021   | Gateway WS client receives uncorrelated chat events — HEARTBEAT_OK leak              | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 0   | 2   | Todo        | task.0023  | Gateway agent system prompt — dedicated workspace, SOUL.md, heartbeat fix            | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 0   | 1   | Backlog     | bug.0017   | Deploy does not reload Alloy when bind-mounted config changes                        | Reliability & Uptime       | proj.reliability                |
| 0   | 1   | Backlog     | bug.0009   | OpenClaw v2026.2.4 gateway agent returns empty payloads                              | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 0   | 3   | In Progress | task.0008  | Gateway client: correct protocol lifecycle for OpenClaw chat E2E                     | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 0   | 3   | Todo        | task.0022  | Git relay MVP: host-side clone → agent commit → host push + PR                       | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 0   | 2   | Done        | bug.0027   | Gateway billing fails in production — Docker socket ENOENT crashes all OpenClaw runs | Payments Enhancements      | proj.payments-enhancements      |
| 0   | 2   | Backlog     | bug.0026   | Scheduler worker silently stops polling — schedules enabled but runs cease           | Reliability & Uptime       | proj.reliability                |
| 0   | 3   | Todo        | task.0029  | Canonicalize billing at GraphExecutorPort — callback + receipt barrier               | Unified Graph Launch       | proj.unified-graph-launch       |
| 0   | 2   | Backlog     | bug.0025   | Schedule creation accepts paid agents with zero credits — no credit gate             | Unified Graph Launch       | proj.unified-graph-launch       |
| 0   | 2   | Todo        | bug.0005   | Scheduled runs invisible in Activity — no billing                                    | Unified Graph Launch       | proj.unified-graph-launch       |
| 0   | 2   | Todo        | task.0014  | VM watchdog: autoheal + HEALTHCHECK on /livez with resource limits                   | Reliability & Uptime       | proj.reliability                |
| 0   | 3   | Done        | task.0027  | Alloy infra metrics + log noise suppression + Grafana P0 alerts                      | Reliability & Uptime       | proj.reliability                |
| 0   | 1   | Backlog     | task.0028  | Create Grafana Cloud P0 alert rules (post-deploy, human)                             | Reliability & Uptime       | proj.reliability                |
| 0   | 1   | Todo        | task.0019  | Parameterize gateway auth token — env substitution, no hardcoded secret              | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 0   | 2   | In Progress | bug.0002   | P0 SECURITY: Deploy artifacts expose all secrets                                     | Docs System Infrastructure | proj.docs-system-infrastructure |
| 0   | 4   | In Progress | task.0001  | Docs Migration Tracker                                                               | Docs System Infrastructure | proj.docs-system-infrastructure |
| 1   | 1   | In Progress | bug.0011   | Gateway streaming truncates output mid-sentence in UI                                | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 1   | 2   | Done        | task.0007  | Billing enforcement decorator at GraphExecutorPort                                   | Unified Graph Launch       | proj.unified-graph-launch       |
| 1   | 3   | Todo        | task.0006  | Collapse GraphProvider — single execution interface                                  | Unified Graph Launch       | proj.unified-graph-launch       |
| 1   | 3   | Todo        | task.0009  | Sandbox repo refresh: on-demand git-sync for agent workspace                         | Sandboxed Agents           | proj.sandboxed-agents           |
| 1   | 3   | Backlog     | bug.0004   | /activity dashboard cost column broken                                               | Payments Enhancements      | proj.payments-enhancements      |
| 1   | 1   | Todo        | task.0018  | Dynamic agent catalog in UI + OpenClaw model sync                                    | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 1   | 3   | Done        | task.0010  | OpenClaw gateway model selection — session-level override                            | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 1   | 1   | Done        | spike.0020 | Research messenger integration via OpenClaw channels                                 | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 2   | 1   | Backlog     | bug.0012   | pre-commit check:docs validates all files, not just staged                           |                            |                                 |
| 2   | 2   | Backlog     | bug.0013   | Sandbox stack tests flaky — proxy container vanishes                                 | OpenClaw Capabilities      | proj.openclaw-capabilities      |
| 2   | 3   | Todo        | task.0003  | Sweep stale doc references across the codebase                                       | Maximize OSS Tools         | proj.maximize-oss-tools         |

> Sort: priority → status (completed last) → estimate → type

## Archived

_(none yet)_
