# work-items · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @cogni-dao
- **Status:** stable

## Purpose

Work item port interfaces, domain types, and storage adapters for structured work item management. Root entry (`@cogni/work-items`) exports pure types/interfaces. Adapter entries export `MarkdownWorkItemAdapter` for `work/items/*.md` frontmatter and `NotionWorkItemMirror` for a Notion view/edit projection prototype.

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

**External deps:** `type-fest` (Tagged branded types), `yaml` (frontmatter parsing — adapter only).

## Public Surface

- **Exports (root `@cogni/work-items`):**
  - `WorkItemId`, `Revision`, `WorkItemType`, `WorkItemStatus`, `ActorKind` — identity and enum types
  - `SubjectRef`, `ExternalRef`, `RelationType`, `WorkRelation` — structured domain types
  - `WorkItem`, `WorkQuery` — full work item type and query filter
  - `toWorkItemId(raw: string): WorkItemId` — boundary constructor
  - `WorkItemQueryPort`, `WorkItemCommandPort` — read/write interfaces
  - `VALID_TRANSITIONS`, `isValidTransition(from, to): boolean` — transition table
- **Exports (adapter `@cogni/work-items/markdown`):**
  - `MarkdownWorkItemAdapter` — implements QueryPort + CommandPort against markdown files
  - `StaleRevisionError` — thrown on optimistic concurrency conflict
  - `InvalidTransitionError` — thrown on invalid status transition
- **Exports (mirror `@cogni/work-items/notion`):**
  - `NotionWorkItemMirror` — projects Cogni-owned work items to Notion and reads editable deltas
  - `NotionWorkItemMirrorConfig` — auth, data source, fetch, and property-name config
  - `NotionWorkItemPage`, `WorkItemNotionPatch` — sync job data shapes
- **Files considered API:** `src/index.ts` (root barrel), `src/adapters/markdown/index.ts` (adapter barrel)

## Ports

- **Uses ports:** none
- **Implements ports:** `WorkItemQueryPort`, `WorkItemCommandPort` (via MarkdownWorkItemAdapter)

## Responsibilities

- This directory **does**: Define port interfaces, domain types, transition rules, the markdown adapter, and the Notion mirror helper
- This directory **does not**: Import from `@/` or `src/`, depend on app-layer or service code

## Usage

```bash
pnpm --filter @cogni/work-items typecheck
pnpm --filter @cogni/work-items build
pnpm vitest run packages/work-items/tests/
```

## Standards

- Root entry: no I/O, no `@/`, no `src/`, no framework imports (pure types)
- Adapter entry: I/O allowed (filesystem), but no `@/` or `src/` imports
- No `as WorkItemId` casts outside test fixtures — use `toWorkItemId()` at boundaries

## Dependencies

- **Internal:** none (leaf package)
- **External:** `type-fest` (Tagged branded types), `yaml` (YAML parse/stringify)

## Change Protocol

- Update this file when types, ports, or transition rules change
- Coordinate with development-lifecycle.md for status/transition changes
- Coordinate with identity-model.md for SubjectRef kind changes

## Notes

- `toWorkItemId()` does no format validation — WorkItemIds include both numeric (`task.0149`) and slug-based (`proj.agentic-project-management`) formats
- `MarkdownWorkItemAdapter` constructor takes `workDir` (repo root) — scans `work/items/` and `work/projects/`
- `blocked` can transition to any `needs_*` status — adapters may enforce stricter return-to-previous-status logic
- ID allocation race: two concurrent `create()` calls can collide. v0 assumes single-caller.
