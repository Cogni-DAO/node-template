---
id: work-system-guide
type: guide
title: Work Management System Guide
status: active
trust: draft
summary: How to track charters, projects, and work items in this repository.
read_when: Creating work items, understanding the project/item lifecycle.
owner: derekg1729
created: 2026-02-05
verified: 2026-02-09
tags: [work, meta]
---

# Work Management System Guide

> Front door to `/work`. Planning and execution tracking lives here.

## Structure

| Directory         | Purpose                                     |
| ----------------- | ------------------------------------------- |
| `charters/`       | Strategic themes (`chr.<slug>.md`)          |
| `projects/`       | Phased roadmaps (`proj.<slug>.md`)          |
| `items/`          | PR-sized work (`<type>.<num>.<slug>.md`)    |
| `items/_index.md` | Canonical discoverability surface           |
| `items/_archive/` | Completed items archived by YYYY/MM         |
| `_templates/`     | Templates for charters, projects, and items |

## Work Item Types

### Charter (`chr.*`)

Strategic theme — an aspirational area of development. Groups related projects.

Contains: Goal, project index, constraints.

### Project (`proj.*`)

Phased roadmap for a multi-PR effort. **May exist before any code.**

Contains: Goal, crawl/walk/run roadmap, constraints, dependencies, work item list.

Projects reference work items by **ID only** (e.g., `task.0042`), never by file path.

### Work Item (`<type>.<num>`)

PR-sized unit of work. Types: `task`, `bug`, `spike`, `story`, `subtask`.

Contains: Requirements, allowed changes, plan, validation, review checklist, attribution.

## ID Conventions

| Kind    | Format         | Example                 | Immutable |
| ------- | -------------- | ----------------------- | --------- |
| Charter | `chr.<slug>`   | `chr.platform-health`   | Yes       |
| Project | `proj.<slug>`  | `proj.sandboxed-agents` | Yes       |
| Item    | `<type>.<num>` | `task.0042`             | Yes       |

**Item filenames:** `work/items/<type>.<num>.<editable_slug>.md`

- The `<type>.<num>` prefix is immutable and must match the `id` in frontmatter.
- The slug is editable and optional.

## Metadata Format

### Project

```yaml
---
id: proj.sandboxed-agents
type: project
primary_charter:
title: Sandboxed Agent Runtime
state: Active
priority: 1
estimate: 5
summary: Isolated execution environment for untrusted agent code
outcome: Agents run in gVisor containers with resource limits
assignees: derekg1729
created: 2026-02-05
updated: 2026-02-06
labels: [security, ai]
---
```

### Work Item

```yaml
---
id: task.0042
type: task
title: Add resource limits to sandbox containers
status: Todo
priority: 1
estimate: 2
summary: Configure CPU/memory limits for sandbox containers
outcome: All sandbox containers have enforced resource limits
spec_refs: sandboxed-agents
assignees: derekg1729
credit:
project: proj.sandboxed-agents
branch:
pr:
reviewer:
created: 2026-02-09
updated: 2026-02-09
labels: [security]
external_refs:
---
```

## Field Reference

### Project

| Field             | Req | Description                   |
| ----------------- | --- | ----------------------------- |
| `id`              | Yes | `proj.{slug}` immutable       |
| `type`            | Yes | `project`                     |
| `primary_charter` | No  | `chr.{slug}` parent charter   |
| `title`           | Yes | Human readable                |
| `state`           | Yes | Active, Paused, Done, Dropped |
| `priority`        | Yes | 0-3                           |
| `estimate`        | Yes | 0-5                           |
| `summary`         | Yes | What is this about?           |
| `outcome`         | Yes | What does success look like?  |
| `assignees`       | Yes | CSV of handles                |
| `created`         | Yes | YYYY-MM-DD                    |
| `updated`         | Yes | YYYY-MM-DD                    |

### Work Item

| Field           | Req         | Description                                 |
| --------------- | ----------- | ------------------------------------------- |
| `id`            | Yes         | `<type>.<num>` immutable                    |
| `type`          | Yes         | task, bug, spike, story, subtask            |
| `title`         | Yes         | Human readable                              |
| `status`        | Yes         | Backlog, Todo, In Progress, Done, Cancelled |
| `priority`      | Yes         | 0-3                                         |
| `estimate`      | Yes         | 0-5                                         |
| `summary`       | Yes         | What needs to be done?                      |
| `outcome`       | Yes         | What is the deliverable?                    |
| `spec_refs`     | No          | Spec IDs (not paths)                        |
| `assignees`     | Yes         | CSV of handles                              |
| `credit`        | No          | Attribution for contributors                |
| `project`       | No          | `proj.{slug}` parent (optional)             |
| `branch`        | No          | Git branch name for this work               |
| `pr`            | Before Done | PR number/URL                               |
| `reviewer`      | Before Done | Review assignee                             |
| `created`       | Yes         | YYYY-MM-DD                                  |
| `updated`       | Yes         | YYYY-MM-DD                                  |
| `labels`        | No          | CSV labels                                  |
| `external_refs` | No          | External URLs                               |

## Hard Rules

1. **ID_IMMUTABLE** — `id` never changes once assigned
2. **PROJECTS_REF_BY_ID** — Projects reference work items by ID only, never by file path
3. **ITEMS_NOT_IN_CODE** — Work items must not be referenced in code or docs/spec; only projects may reference item IDs
4. **SPECS_ARE_AS_BUILT** — Specs describe what IS, not what WILL BE; roadmaps live in projects
5. **ITEMS_ARE_PR_SIZED** — If an item spans multiple PRs, break it up
6. **PR_LINKS_ITEM** — Every PR references exactly one Work Item ID (e.g., `WI: bug.0004`)
7. **SLUG_RENAME_OK** — Renaming the slug portion of a filename is allowed; renaming `<type>.<num>` is forbidden

## Agent Safety

- Agents must not directory-list `work/items/`; use `work/items/_index.md` and search by ID.
- Creating or closing an item must update `_index.md`.

## Related

- [Documentation System](../docs/README.md)
- [Spec + Project Lifecycle](../docs/spec/development-lifecycle.md)
