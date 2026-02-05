---
id: spec-index
type: spec
title: Specification Index
status: draft
trust: draft
summary: Index of all system specifications in this repository.
read_when: You need to find a specification document.
owner: derekg1729
created: 2026-02-05
verified: 2026-02-05
tags: [index]
---

# Specification Index

**A Spec is** a design contract for pending or existing code — the invariants that reviewers and agents enforce.

This is a master index of all specs, updated as specs are migrated.

## Specifications

| ID                    | Title                       | State    | Domain     | Location                                               |
| --------------------- | --------------------------- | -------- | ---------- | ------------------------------------------------------ |
| architecture-spec     | Cogni-Template Architecture | active   | meta       | [architecture.md](./architecture.md)                   |
| development-lifecycle | Development Lifecycle       | proposed | meta       | [development-lifecycle.md](./development-lifecycle.md) |
| docs-work-system-spec | Docs + Work System Roadmap  | draft    | meta       | [docs-work-system.md](./docs-work-system.md)           |
| scheduler-spec        | Scheduler Specification     | active   | ai-graphs  | [scheduler.md](./scheduler.md)                         |
| rbac-spec             | RBAC Specification          | active   | auth       | [rbac.md](./rbac.md)                                   |
| ai-setup-spec         | AI Setup Specification      | active   | ai-graphs  | [ai-setup.md](./ai-setup.md)                           |
| cogni-brain-spec      | Cogni Brain Specification   | proposed | ai-graphs  | [cogni-brain.md](./cogni-brain.md)                     |
| databases-spec        | Databases Specification     | active   | infra      | [databases.md](./databases.md)                         |
| observability-spec    | Observability Specification | active   | infra      | [observability.md](./observability.md)                 |
| ci-cd-spec            | CI/CD Specification         | active   | deployment | [ci-cd.md](./ci-cd.md)                                 |
| style-spec            | Style Specification         | active   | meta       | [style.md](./style.md)                                 |

### Domains

| Domain       | Description                                 |
| ------------ | ------------------------------------------- |
| `meta`       | Workflow, architecture, development process |
| `ai-graphs`  | AI execution, LangGraph, prompts, tools     |
| `auth`       | Authentication, authorization, RBAC         |
| `billing`    | Credits, payments, metering                 |
| `infra`      | Databases, observability, caching           |
| `deployment` | CI/CD, environments, containers             |
| `web3`       | Wallets, chains, DAO governance             |
| `community`  | SourceCred, contributions                   |

## Pending Migration

Legacy specs in `/docs/*.md` to be migrated to `/docs/spec/`:

- DATABASE_RLS_SPEC.md
- PROMPT_REGISTRY_SPEC.md
- AGENT_REGISTRY_SPEC.md
- TOOL_USE_SPEC.md
- TENANT_CONNECTIONS_SPEC.md
- UNIFIED_GRAPH_LAUNCH_SPEC.md
- OBSERVABILITY_REQUIRED_SPEC.md

## Adding a Spec

1. Copy `docs/_templates/spec.md`
2. Place in `docs/spec/`
3. Add entry to table above
