---
id: task.0149
type: task
title: "WorkItemPort + MarkdownAdapter — typed port for agent work-item access"
status: needs_design
priority: 0
rank: 5
estimate: 5
summary: "Define WorkItemQueryPort and WorkItemCommandPort interfaces in a new packages/work-items package, with SubjectRef aligned to the identity-model actor kinds, ExternalRef for PR/commit linking, WorkRelation for dependencies, and a MarkdownWorkItemAdapter as the v0 implementation."
outcome: "All agent skills (/implement, /triage, /closeout, /review-implementation) access work items through the port. No direct frontmatter editing. ID allocation is centralized. Optimistic concurrency prevents race conditions. Contract tests validate port invariants."
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

# WorkItemPort + MarkdownAdapter — typed port for agent work-item access

## Requirements

- `WorkItemQueryPort` interface: `get(id)`, `list(query)`, `listRelations(id)`
- `WorkItemCommandPort` interface: `create()`, `patch()`, `transitionStatus()`, `setAssignees()`, `upsertRelation()`, `removeRelation()`, `upsertExternalRef()`
- `SubjectRef` type with kinds: `user | agent | system` — aligned with `docs/spec/identity-model.md` actor kinds
- `ExternalRef` type: `system + kind + externalId + url + title`
- `WorkRelation` type: `fromId + toId + type` where type ∈ {blocks, blocked_by, depends_on, parent_of, child_of, relates_to, duplicates}
- `WorkQuery` type with cursor-based pagination
- Optimistic concurrency via `expectedRevision` (content hash)
- `MarkdownWorkItemAdapter` implementing both ports against `work/items/*.md`
- Centralized ID allocation inside `create()`
- Contract tests that any adapter must pass

## Allowed Changes

- `packages/work-items/` (NEW) — port interfaces, types, contract test suite
- `packages/work-items-md/` (NEW) — markdown adapter implementation
- `src/lib/work-scanner.ts` — refactor to use the query port (or deprecate)
- `scripts/validate-docs-metadata.mjs` — accept new frontmatter fields (relations, external_refs)
- Skill definitions — migrate to use port instead of direct file editing

## Plan

- [ ] Design spec: port interfaces, types, adapter contract
- [ ] Create `packages/work-items/` with port interfaces + types (pure, no I/O)
- [ ] Create `packages/work-items-md/` with MarkdownWorkItemAdapter
- [ ] Implement read path: `get()`, `list()`, `listRelations()`
- [ ] Implement write path: `create()`, `patch()`, `transitionStatus()`
- [ ] Implement assignment: `setAssignees()`
- [ ] Implement relations: `upsertRelation()`, `removeRelation()`
- [ ] Implement external refs: `upsertExternalRef()`
- [ ] Write contract tests (adapter-agnostic invariant suite)
- [ ] Update validator to accept `relations` and `external_refs` frontmatter
- [ ] Migrate at least one skill (/triage) to use port as proof-of-concept

## Validation

**Command:**

```bash
pnpm test packages/work-items/tests/
pnpm test packages/work-items-md/tests/
pnpm check
```

**Expected:** Port contract tests pass with markdown adapter. All existing checks green.

## Review Checklist

- [ ] **Work Item:** `task.0149` linked in PR body
- [ ] **Spec:** identity-model actor kinds respected in SubjectRef
- [ ] **Spec:** development-lifecycle state machine enforced in transitionStatus
- [ ] **Tests:** contract tests cover all port methods
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Project: proj.agentic-project-management

## Attribution

- derekg1729 — design and project definition
