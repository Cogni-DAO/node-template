---
id: chr.engineering
type: charter
title: "ENGINEERING Charter"
state: Active
summary: ENGINEERING governance charter scaffold for recurring heartbeat runs.
created: 2026-02-15
updated: 2026-04-19
---

# ENGINEERING Charter

## Goal

Ship reliable code that brings charters' goals to life. Maintain quality through testing, CI/CD, and optimization loops. Build skills and workflows that accelerate delivery.

See [@docs/spec/development-lifecycle.md](../../docs/spec/development-lifecycle.md) for workflow standards.

## Charter Work Requests

_Updated by governance skills - shows what work other charters need from ENGINEERING_

| Charter | Priority | Severity | Work Item                      | Status      | Notes                                               |
| ------- | -------- | -------- | ------------------------------ | ----------- | --------------------------------------------------- |
| SUSTAIN | 0        | High     | `proj.observability-hardening` | Queued      | BLOCKING: Can't optimize what you can't see         |
| COMM    | 0        | High     | `proj.messenger-channels`      | Queued      | BLOCKING: P0 for community reach                    |
| SUSTAIN | 1        | High     | `proj.context-optimization`    | In Progress | $5.50/run unsustainable (needs observability first) |
| SUSTAIN | 1        | Med      | `proj.governance-agents`       | Queued      | Signal infra for governance loops                   |
| COMM    | 2        | Low      | `proj.sourcecred-onchain`      | Paused      | Cred system doesn't run                             |

## Principles

- **Maximize OSS**: Prefer open-source tools and dependencies over proprietary/vendor solutions
- **Test-first reliability**: Code only works if tested end-to-end and aligned with spec invariants
- **Workflow discipline**: Follow the [status-driven lifecycle](../../docs/spec/development-lifecycle.md) — every `needs_*` status maps to one `/command`, dispatched deterministically

## Workflow Health Matrix

> Assessed 2026-04-19. No self-review cycle exists yet — grades are the author's best estimate and should be considered pessimistic defaults. Columns: what a solo agent needs, what exists today, the gap, and a traffic-light health grade. 🔴 poor · 🟡 partial · 🟢 good.

| Workflow stage                    | What a solo agent needs to ship `deploy_verified: true`                         | What exists today                                                                        | Gap                                                                         | Health |
| --------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------ |
| Intake (`/idea`, `/bug`)          | A rubric for a good work item: scope, acceptance criteria, owner                | Commands + `work/README.md` overview                                                     | No authoring rubric; agents produce uneven work items                       | 🟡     |
| Triage (`/triage`)                | Deterministic routing by type + invariants                                      | Lifecycle spec + command                                                                 | Covered                                                                     | 🟢     |
| Design (`/design`, `/spec`)       | "As-built spec" authoring guide (per `SPEC_NO_EXEC_PLAN`)                       | Commands + existing specs as examples                                                    | No authoring guide — agents still slip roadmap/phases into specs            | 🔴     |
| Implement (`/implement`)          | Architecture + feature + testing guides; API-contract rule                      | `architecture.md`, `feature-development.md`, `create-service.md`, `testing.md`           | Covered                                                                     | 🟢     |
| `## Validation` block authoring   | Exercise + observability recipe per surface (API, graph, scheduler, CLI, infra) | `agent-api-validation.md` (API only)                                                     | No recipes for non-API surfaces → most work items can't write a valid block | 🔴     |
| Closeout / PR (`/closeout`)       | PR body with TLDR · deploy impact · E2E plan · post-flight validation result    | `/closeout` command + `pr-management-playbook.md`                                        | Neither enforces the 4-field checklist; playbook predates `deploy_verified` | 🔴     |
| Flight to `candidate-a`           | Clear app-lever vs infra-lever decision tree + trigger steps                    | `candidate-flight-v0.md`, `ci-cd.md`                                                     | No decision tree; `candidate-flight-infra` has no agent-facing guide        | 🟡     |
| Self-exercise on `candidate-a`    | Canonical URL map + auth flow per env + interaction recipes per surface         | `agent-api-validation.md` (API)                                                          | No URL map, no non-API recipes                                              | 🔴     |
| Loki self-lookup                  | "Find my own request at the deployed SHA" — LogQL + grafana MCP recipe          | `alloy-loki-setup.md` (setup only); task.0308 adds startup-SHA + smoke-check log signals | No recipe; SHA-in-logs signal is proposed, not landed                       | 🔴     |
| Finalize `deploy_verified: true`  | One-pager: flip field, update index, spawn follow-ups                           | Lifecycle spec defines the invariant                                                     | No authoring guide; field routinely missed                                  | 🔴     |
| Review (`/review-implementation`) | Critical review + revision loop with loop limit                                 | Command + `revision` field + `LOOP_LIMIT` invariant                                      | Covered                                                                     | 🟢     |
| Secrets across lanes (cross-cut)  | Agent-facing playbook for dev → candidate-a → preview → prod                    | `SECRET_ROTATION.md` (incident-only)                                                     | No proactive-add playbook; agents improvise                                 | 🔴     |
| IaC capture (cross-cut)           | "You did X by hand — here's the 5 files to commit" guide                        | `DEPLOYMENT_ARCHITECTURE.md`                                                             | No capture recipe → ad-hoc ops rot out of git                               | 🔴     |
| Dolt memory ops (cross-cut)       | How to write/read memory deterministically                                      | Principle stated, no guide                                                               | Referenced but undocumented                                                 | 🔴     |
| Self-review cycle (meta)          | Scheduled review of this matrix + the lifecycle itself                          | None                                                                                     | No cadence, no owner — this matrix will rot without one                     | 🔴     |

**Rollup**: 3 🟢 / 2 🟡 / 10 🔴. Critical-path reds (block a solo agent from reaching `deploy_verified`): Validation-block authoring, Closeout/PR discipline, Self-exercise, Loki self-lookup, Finalize. The first ENGINEERING project should land these five.

## Key References

| Type  | Path                                                                                  | Purpose                           |
| ----- | ------------------------------------------------------------------------------------- | --------------------------------- |
| Spec  | [@docs/spec/architecture.md](../../docs/spec/architecture.md)                         | System architecture and hex ports |
| Spec  | [@docs/spec/services-architecture.md](../../docs/spec/services-architecture.md)       | Service boundaries and deployment |
| Spec  | [@docs/spec/system-test-architecture.md](../../docs/spec/system-test-architecture.md) | Test infrastructure patterns      |
| Spec  | [@docs/spec/development-lifecycle.md](../../docs/spec/development-lifecycle.md)       | Command-driven workflows          |
| Guide | [@work/README.md](../README.md)                                                       | Work management guide             |
| Index | [@work/items/\_index.md](../items/_index.md)                                          | Canonical work item index         |

## Projects

### Core mission / priorities

| Priority | Target                                                                 | Score (0-5) | Status      | Notes |
| -------- | ---------------------------------------------------------------------- | ----------- | ----------- | ----- |
| 0        | Delivery velocity: tight feedback loops accelerate workflow efficiency | 0           | Not Started |       |
| 1        | Test infrastructure: agents + humans validate before ship              | 0           | Not Started |       |
| 2        | Code quality: specs enforced, best practices followed                  | 0           | Not Started |       |

### Top projects (max 4)

_ENGINEERING-owned infrastructure. Feature delivery projects live in their respective charters; GOVERN handles cross-charter prioritization._

| Project                         | Why now                                      | Score (0-5) | Status      | Notes |
| ------------------------------- | -------------------------------------------- | ----------- | ----------- | ----- |
| `proj.development-workflows`    | Standardize spec/PR/agent workflows          | 0           | Not Started |       |
| `proj.agent-dev-testing`        | Self-validating agents (lint/test/e2e gates) | 0           | Not Started |       |
| `proj.system-test-architecture` | Mock-LLM test infra, system integration      | 0           | Not Started |       |
| `proj.context-optimization`     | Token efficiency for multi-call workflows    | 0           | Not Started |       |

## Constraints

- Development execution 100% dependent on one human (Derek)
- No CI/CD for governance workflows yet (only app CI exists)
- Agents cannot run full stack/comp tests to self-validate code before submitting PRs
- Limited test coverage for governance/scheduler infrastructure
- Development workflows brand new, require iteration and refinement

### Skills / resources

| Resource               | Use                                | Where                                | /skill | Notes                    |
| ---------------------- | ---------------------------------- | ------------------------------------ | ------ | ------------------------ |
| Governance skills      | Charter-scoped governance runs     | `.openclaw/skills/gov-*`             |        | Trigger-routed execution |
| Development skills     | Status-driven lifecycle commands   | `.claude/commands/`                  |        | `needs_*` → `/command`   |
| Test infrastructure    | Mock-LLM, system integration tests | `tests/`, `docker-compose`           |        | Partial coverage         |
| CI/CD pipelines        | GitHub Actions workflows           | `.github/workflows/`                 |        | App CI only; no gov CI   |
| Specs and architecture | Technical contracts and boundaries | `docs/spec/`                         |        | Active specs enforce     |
| Work tracking system   | Projects, tasks, issues            | `work/`                              |        | Via OpenClaw skills      |
| Deployment health      | Per-service health, LLM cost       | `.openclaw/skills/deployment-health` | ✓      | v0 MVP - data incomplete |
