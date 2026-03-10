# work-items · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @cogni-dao
- **Status:** stable

## Purpose

Work item port interfaces and domain types for structured work item management. Provides `WorkItemQueryPort`, `WorkItemCommandPort`, domain types (`WorkItem`, `SubjectRef`, `ExternalRef`, `WorkRelation`), and a status transition table. Zero I/O leaf package (only `type-fest`).

## Pointers

- [Development Lifecycle](../../docs/spec/development-lifecycle.md): Status enum and transition rules
- [Identity Model](../../docs/spec/identity-model.md): Actor kinds for SubjectRef alignment
- [Packages Architecture](../../docs/spec/packages-architecture.md): Package conventions

## Boundaries

```json
{
  "layer": "packages",
  "may_import": [],
  "must_not_import": [
    "app",
    "features",
    "ports",
    "core",
    "adapters",
    "shared",
    "services",
    "packages"
  ]
}
```

**External deps:** `type-fest` (Tagged branded types).

## Public Surface

- **Exports (root `@cogni/work-items`):**
  - `WorkItemId` — `Tagged<string, "WorkItemId">`, branded work item identity
  - `Revision` — adapter-specific revision token for optimistic concurrency
  - `WorkItemType` — `"task" | "bug" | "story" | "spike" | "subtask"`
  - `WorkItemStatus` — 9-value status enum from development-lifecycle.md
  - `SubjectRef` — discriminated union: `user | agent | system` (identity-model.md actor kinds)
  - `ExternalRef` — backend-agnostic external reference (GitHub, GitLab, etc.)
  - `RelationType` — `"blocks" | "parent_of" | "relates_to" | "duplicates"` (canonical only)
  - `WorkRelation` — typed relation between work items
  - `WorkItem` — full work item type with all semantic fields
  - `WorkQuery` — query filter type with cursor pagination
  - `toWorkItemId(raw: string): WorkItemId` — boundary constructor
  - `WorkItemQueryPort` — read interface: `get`, `list`, `listRelations`
  - `WorkItemCommandPort` — write interface: `create`, `patch`, `transitionStatus`, `setAssignees`, `upsertRelation`, `removeRelation`, `upsertExternalRef`, `claim`, `release`
  - `VALID_TRANSITIONS` — `ReadonlyMap<WorkItemStatus, readonly WorkItemStatus[]>`
  - `isValidTransition(from, to): boolean` — transition validator
- **Files considered API:** `index.ts` (root barrel)

## Ports

- **Uses ports:** none
- **Implements ports:** none (defines them — adapters implement)

## Responsibilities

- This directory **does**: Define port interfaces, domain types, and transition rules
- This directory **does not**: Perform I/O, contain adapter code, depend on any other package

## Usage

```bash
pnpm --filter @cogni/work-items typecheck
pnpm --filter @cogni/work-items build
```

## Standards

- Per `FORBIDDEN`: No I/O, no `@/`, no `src/`, no framework imports
- Per `ALLOWED`: Pure TypeScript types, interfaces, and data constants only
- No `as WorkItemId` casts outside test fixtures — use `toWorkItemId()` at boundaries

## Dependencies

- **Internal:** none (leaf package)
- **External:** `type-fest` (Tagged branded types)

## Change Protocol

- Update this file when types, ports, or transition rules change
- Coordinate with development-lifecycle.md for status/transition changes
- Coordinate with identity-model.md for SubjectRef kind changes

## Notes

- `toWorkItemId()` does no format validation — WorkItemIds include both numeric (`task.0149`) and slug-based (`proj.agentic-project-management`) formats
- The adapter (task.0151) lives in `src/adapters/markdown/` within this same package
- `blocked` can transition to any `needs_*` status — adapters may enforce stricter return-to-previous-status logic
