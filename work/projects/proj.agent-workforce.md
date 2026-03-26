---
id: proj.agent-workforce
type: project
primary_charter: ENGINEERING
title: Agent Workforce — LangGraph Roles on Temporal Schedules
state: Active
priority: 0
estimate: 5
summary: "Multi-role agent workforce via three registries (GraphSpec, RoleSpec, WorkItem) and one reusable RoleHeartbeatWorkflow on Temporal"
outcome: "Adding an agent = 1 RoleSpec constant + 1 CatalogEntry + maybe 1 outcome handler. Never a new workflow. CEO triages all work. Git Reviewer drives PRs to merge. Measurable via role-level metrics (backlog, SLA, success rate, spend)."
assignees:
  - derekg1729
created: 2026-03-26
updated: 2026-03-26
labels: [agents, governance, workforce, langgraph, temporal]
---

# Agent Workforce — LangGraph Roles on Temporal Schedules

## Goal

Three registries, one workflow, measurable agents.

| Registry            | Concern             | Package                             |
| ------------------- | ------------------- | ----------------------------------- |
| GraphSpec (catalog) | How to think        | `@cogni/langgraph-graphs`           |
| RoleSpec            | What to own         | `@cogni/temporal-workflows` (crawl) |
| WorkItem            | What to do (leased) | `@cogni/work-items`                 |

Adding an agent = 1 `RoleSpec` + 1 `CatalogEntry` + optionally 1 outcome handler. Never a new workflow.

## As-Built Specs

- [Agent Roles](../../docs/spec/agent-roles.md) — Three registries, RoleHeartbeatWorkflow, claim/release, outcome handlers

## Roadmap

### Crawl (P0) — Two Roles on LangGraph + Temporal

| Deliverable                                                             | Status      | Est | Work Item |
| ----------------------------------------------------------------------- | ----------- | --- | --------- |
| `systemPrompt` on graph options + CatalogEntry                          | Not Started | 0.5 | task.0207 |
| `createOperatorGraph` factory (behind seam)                             | Not Started | 0.5 | task.0207 |
| CEO + Git Reviewer catalog entries + prompts                            | Not Started | 1   | task.0207 |
| Operator tools: `work_item_query`, `work_item_transition`               | Not Started | 2   | task.0207 |
| `RoleSpec` type + CEO/Git Reviewer constants                            | Not Started | 0.5 | task.0208 |
| `RoleHeartbeatWorkflow` + activities (claim, context, outcome, release) | Not Started | 2   | task.0208 |
| 2 outcome handlers (default, pr-lifecycle)                              | Not Started | 1   | task.0208 |
| Temporal schedules in repo-spec.yaml                                    | Not Started | 0.5 | task.0208 |

### Walk (P1) — Metrics + More Roles

| Deliverable                                                                      | Status      | Est | Work Item |
| -------------------------------------------------------------------------------- | ----------- | --- | --------- |
| Role-level metrics dashboard (backlog, SLA breach, success rate, spend, unowned) | Not Started | 2   | (P1)      |
| Webhook triggers for Git Reviewer                                                | Not Started | 2   | (P1)      |
| PM + Data Analyst roles (RoleSpec + CatalogEntry each)                           | Not Started | 2   | (P1)      |
| Extract RoleSpec to shared package for dashboard                                 | Not Started | 1   | (P1)      |

### Run (P2) — Self-Improving

| Deliverable                                        | Status      | Est | Work Item |
| -------------------------------------------------- | ----------- | --- | --------- |
| Outcome logging + prompt improvement feedback loop | Not Started | 2   | (P2)      |
| Cross-role escalation via work item creation       | Not Started | 2   | (P2)      |

## Constraints

- `THREE_REGISTRIES` — GraphSpec, RoleSpec, WorkItem never collapse into one
- `CLAIM_NOT_READ` — work items leased via `claim()`/`release()`, not read-then-act
- `ONE_WORKFLOW_ALL_ROLES` — `RoleHeartbeatWorkflow` is parameterized, never per-role
- `OUTCOME_HANDLERS_DISPATCHED` — by handler ID, no role branches in workflow code

## Design Notes

**Why three registries, not one:** Graph config (prompt, tools) and operational config (schedule, SLA, budget) are different concerns with different change frequencies. Collapsing them into one registry makes the graph package depend on work-management types. Separation means `@cogni/langgraph-graphs` stays pure.

**Why claim/release:** With multiple roles on independent schedules, concurrent heartbeats will race for the same item. `WorkItemCommandPort.claim()` already provides atomic leasing — we just need to use it.

**Why outcome handlers:** Each role produces different side effects (CEO updates items, Git Reviewer merges PRs). A handler registry keeps the workflow generic. Adding a role with custom outcomes = registering one handler function.

## Dependencies

- [x] `@cogni/langgraph-graphs` — catalog + factories
- [x] `@cogni/temporal-workflows` — GraphRunWorkflow
- [x] `@cogni/work-items` — claim()/release()
- [x] Temporal infrastructure
