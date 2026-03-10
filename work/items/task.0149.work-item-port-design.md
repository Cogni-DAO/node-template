---
id: task.0149
type: task
title: "packages/work-items — port interfaces, domain types, and status transition table"
status: needs_design
priority: 0
rank: 5
estimate: 2
summary: "Create a pure packages/work-items package with WorkItemQueryPort, WorkItemCommandPort interfaces, all domain types (WorkItem, SubjectRef, ExternalRef, WorkRelation, WorkItemStatus), and a status transition validation table derived from development-lifecycle.md."
outcome: "packages/work-items exports typed port interfaces and domain types. No I/O, no adapter code. The status transition table is a pure data structure that any adapter can use to validate transitions. Package builds and passes typecheck."
spec_refs: [identity-model-spec, development-lifecycle]
assignees: []
credit:
project: proj.agentic-project-management
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-10
updated: 2026-03-10
labels: [work-system, agents, infrastructure, ports]
external_refs:
---

# packages/work-items — port interfaces, domain types, and status transition table

## Requirements

- `WorkItemQueryPort` interface: `get(id)`, `list(query)`, `listRelations(id)`
- `WorkItemCommandPort` interface: `create()`, `patch()`, `transitionStatus()`, `setAssignees()`, `upsertRelation()`, `removeRelation()`, `upsertExternalRef()`, `claim()`, `release()`
- `WorkItem` type with all semantic fields modeled explicitly (no `Record<string, unknown>` bag)
- `WorkItemStatus` enum matching `development-lifecycle.md`
- `SubjectRef` discriminated union with kinds: `user | agent | system` — aligned with `identity-model.md` actor kinds
- `ExternalRef` type: `system + kind + externalId + url + title`
- `WorkRelation` type with canonical direction only: `blocks | parent_of | relates_to | duplicates`
- `WorkQuery` type with cursor field (for future adapters)
- `Revision` type for optimistic concurrency
- Status transition table: `Map<WorkItemStatus, WorkItemStatus[]>` derived from the lifecycle spec
- Zero I/O — pure types, interfaces, and data

## Allowed Changes

- `packages/work-items/` (NEW) — port interfaces, domain types, transition table
- Root `tsconfig.json` — add project reference
- Root `package.json` — add workspace dependency
- `biome/base.json` — add tsup/vitest overrides
- `.dependency-cruiser.cjs` — add boundary rule (if needed)

## Plan

- [ ] Create `packages/work-items/` with standard package structure (per packages-architecture.md)
- [ ] Define domain types: `WorkItemId`, `Revision`, `WorkItemStatus`, `SubjectRef`, `ExternalRef`, `RelationType`, `WorkRelation`, `WorkItem`, `WorkQuery`
- [ ] Define `WorkItemQueryPort` interface
- [ ] Define `WorkItemCommandPort` interface
- [ ] Define status transition table as exported constant
- [ ] Wire package into build (tsconfig references, workspace dep, biome overrides)
- [ ] Verify `pnpm packages:build && pnpm check` passes

## Validation

**Command:**

```bash
pnpm packages:build
pnpm check
```

**Expected:** Package builds, types are exported, all checks green. No tests yet (pure types only — contract tests come in task.0151).

## Review Checklist

- [ ] **Work Item:** `task.0149` linked in PR body
- [ ] **Spec:** identity-model actor kinds respected in SubjectRef
- [ ] **Spec:** development-lifecycle transitions encoded in transition table
- [ ] **Architecture:** package follows packages-architecture.md conventions
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Project: proj.agentic-project-management

## Attribution

- derekg1729 — design and project definition
