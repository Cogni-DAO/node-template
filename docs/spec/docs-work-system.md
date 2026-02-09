---
id: docs-work-system-spec
type: spec
title: Docs + Work System
status: draft
spec_state: draft
trust: draft
summary: Document taxonomy, identifier conventions, and directory structure for docs and work tracking
read_when: Creating docs or work items, understanding the directory structure
implements: proj.docs-system-infrastructure
owner: derekg1729
created: 2026-02-05
verified: 2026-02-09
tags: [docs, work, meta]
---

# Docs + Work System

## Context

This repo uses a typed directory structure for documentation (`/docs`) and work tracking (`/work`). This spec describes the current as-built conventions.

## Goal

Define the document taxonomy, identifier conventions, and directory structure that all docs and work items must follow.

## Non-Goals

- Roadmap for future tooling (see [proj.docs-system-infrastructure](../../work/projects/proj.docs-system-infrastructure.md))
- Plane integration details (future)
- CI enforcement implementation (future)

---

## Core Invariants

1. **DOCS_TYPED_DIRECTORIES**: Docs live in typed directories: `docs/spec/`, `docs/guides/`, `docs/decisions/adr/`.

2. **WORK_TYPED_DIRECTORIES**: Work items live in: `work/projects/`, `work/items/`.

3. **ID_IMMUTABLE**: Once assigned, `id` never changes.

4. **SPECS_ARE_AS_BUILT**: Specs describe current implementation only. Roadmaps live in projects.

5. **TYPE_MATCHES_DIRECTORY**: A doc's `type` field must match its directory (`type: spec` → `docs/spec/`).

---

## Design

### Document Types

| Type    | Directory             | Purpose                        |
| ------- | --------------------- | ------------------------------ |
| `spec`  | `docs/spec/`          | As-built contracts, invariants |
| `guide` | `docs/guides/`        | Procedures, howtos, runbooks   |
| `adr`   | `docs/decisions/adr/` | Architecture decision records  |

### Work Item Types

| Type      | Directory        | ID Format      | Purpose                                               |
| --------- | ---------------- | -------------- | ----------------------------------------------------- |
| `charter` | `work/charters/` | `chr.<slug>`   | Strategic themes, groups projects                     |
| `project` | `work/projects/` | `proj.<slug>`  | Roadmap, phased plans (pre-code)                      |
| work item | `work/items/`    | `<type>.<num>` | PR-sized execution (task, bug, spike, story, subtask) |

### Identifier Conventions

| Kind    | Format         | Example                 | Immutable |
| ------- | -------------- | ----------------------- | --------- |
| Doc     | `kebab-case`   | `activity-metrics`      | Yes       |
| Charter | `chr.<slug>`   | `chr.platform-health`   | Yes       |
| Project | `proj.<slug>`  | `proj.sandboxed-agents` | Yes       |
| Item    | `<type>.<num>` | `task.0042`             | Yes       |

Item filenames: `work/items/<type>.<num>.<editable_slug>.md` — the `<type>.<num>` prefix is immutable; the slug is editable.

### Required Frontmatter

**Specs:**

```yaml
id: example-spec
type: spec
title: Example Spec
status: draft|active|deprecated
spec_state: draft|proposed|active|deprecated
trust: draft|reviewed|canonical|external
summary: One-line description
read_when: When to read this
owner: handle
created: YYYY-MM-DD
verified: YYYY-MM-DD
tags: [optional]
```

**Projects:**

```yaml
id: proj.example
type: project
primary_charter:
title: Example Project
state: Active|Paused|Done|Dropped
priority: 0-3
estimate: 0-5
summary: One-line description
outcome: What success looks like
assignees: handle
created: YYYY-MM-DD
updated: YYYY-MM-DD
labels: [optional]
```

**Items:**

```yaml
id: task.0042
type: task
title: Example Task
status: Backlog|Todo|In Progress|Done|Cancelled
priority: 0-3
estimate: 0-5
summary: One-line description
outcome: What the deliverable is
spec_refs: example-spec
assignees: handle
credit:
project: proj.example
pr:
reviewer:
created: YYYY-MM-DD
updated: YYYY-MM-DD
labels: [optional]
external_refs:
```

---

## Acceptance Checks

**Automated:**

- `node scripts/validate-docs-metadata.mjs` — validates frontmatter (partially implemented)

**Manual:**

1. New specs go in `docs/spec/`
2. New projects go in `work/projects/`
3. New charters go in `work/charters/`
4. New items go in `work/items/`
5. IDs follow conventions above

---

## Open Questions

- [ ] Directory structure not yet enforced by CI (validator checks frontmatter but not file placement)

---

## Related

- [Development Lifecycle](./development-lifecycle.md) — workflow spec
- [Work Management Guide](../../work/README.md) — front door to /work
- [Documentation Guide](../README.md) — front door to /docs
- [Project: Docs System Infrastructure](../../work/projects/proj.docs-system-infrastructure.md) — tooling roadmap
- [Project: Development Workflows](../../work/projects/proj.development-workflows.md) — workflow conventions
