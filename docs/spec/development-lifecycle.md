---
id: development-lifecycle
type: spec
title: Development Lifecycle
status: draft
spec_state: proposed
trust: draft
summary: Command-driven workflows from idea to closeout
read_when: Starting new work, understanding the development flow, reviewing PRs
implements: proj.development-workflows
owner: derekg1729
created: 2026-02-05
verified: 2026-02-09
tags: [workflow, commands]
---

# Development Lifecycle

## Context

Work enters the system as ideas or bugs. It flows through triage, planning, execution, and closeout via `/commands` that enforce content boundaries. This spec defines those flows.

For type definitions and ownership rules, see [docs-work-system](./docs-work-system.md).

## Goal

Enumerate the command-driven workflows, their sequencing, and the gates that enforce quality.

## Non-Goals

- Type taxonomy (see [docs-work-system](./docs-work-system.md))
- Project management methodology
- CI implementation details

---

## Core Invariants

1. **PR_LINKS_ITEM**: Every code PR references exactly one primary work item (`task.*` or `bug.*`) and at least one spec, or declares `Spec-Impact: none`.

2. **TRIAGE_OWNS_ROUTING**: Only `/triage` sets or changes the `project:` linkage on an idea or bug.

3. **SPEC_NO_EXEC_PLAN**: Specs never contain roadmap, phases, tasks, owners, or timelines. At any `spec_state`.

4. **SPEC_STATE_LIFECYCLE**: `draft` → `proposed` → `active` → `deprecated`. No skipping.

5. **ACTIVE_MEANS_CLEAN**: `spec_state: active` requires Open Questions empty and `verified:` current.

6. **PROJECTS_BEFORE_CODE**: Projects may exist before any code. Specs are created or updated when code lands.

---

## Design

### Commands

| Command     | Creates/Updates                               | Purpose                                                    |
| ----------- | --------------------------------------------- | ---------------------------------------------------------- |
| `/idea`     | `story.*` item                                | Entry point: new feature concept                           |
| `/bug`      | `bug.*` item                                  | Entry point: something is broken                           |
| `/triage`   | updates item                                  | Route to project or leave standalone                       |
| `/project`  | `proj.*` project                              | Plan roadmap with Crawl/Walk/Run phases                    |
| `/spec`     | spec in `docs/spec/`                          | Write or update technical contract                         |
| `/task`     | `task.*` item                                 | Decompose into PR-sized work                               |
| `/closeout` | updates item, spec, headers, AGENTS.md, index | Pre-PR finish pass: scan diff, update all docs, close item |

### Spec State Lifecycle

| State        | Meaning                          | Required                                              |
| ------------ | -------------------------------- | ----------------------------------------------------- |
| `draft`      | Exploratory. May not match code. | Invariants can be incomplete. Open Questions allowed. |
| `proposed`   | Stable enough to review against. | Invariants enumerated. Acceptance checks defined.     |
| `active`     | Matches code. Enforced.          | Open Questions empty. `verified:` current.            |
| `deprecated` | No longer authoritative.         | Points to replacement spec.                           |

### Workflows

**Bug (simple fix):**

```
/bug → /triage (attach proj.* or none) → /task → PR → /closeout
```

**New idea, new project:**

```
/idea → /triage → new proj.* → /project → /spec (draft) → /task(s) → PR(s) → /closeout
```

**Idea slots into existing project:**

```
/idea → /triage → attach proj.* → /task → PR → /closeout
        └─ if contract change: /spec (draft) before /task
```

### When to Create What

| Situation                     | Flow                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------- |
| Small fix, no behavior change | `/bug` → `/task` → PR → `/closeout`                                           |
| Single PR, clear scope        | `/idea` → `/triage` → `/task` → PR → `/closeout`                              |
| Multi-PR effort               | `/idea` → `/triage` → `/project` → `/spec` → `/task`(s) → PR(s) → `/closeout` |
| Architecture decision         | ADR in `docs/decisions/adr/`                                                  |

### PR Body Format

```markdown
## References

Work: task.0042
Spec: docs/spec/feature.md#core-invariants (or Spec-Impact: none)
```

- Missing `Work:` → merge blocked
- Missing `Spec:` → warning (blocked if behavior/security/interface change)

---

## Acceptance Checks

**Automated:**

- `node scripts/validate-docs-metadata.mjs` — validates frontmatter including `spec_state`
- `pnpm check:docs` — agents + headers + metadata

**Manual (until automated):**

1. Specs contain no roadmap/phase/task content
2. `spec_state: active` specs have empty Open Questions
3. PRs reference a work item

---

## Open Questions

- [ ] Should we lint specs for roadmap/phase language?
- [ ] CI enforcement of PR body format (Work: / Spec: lines)

---

## Related

- [Docs + Work System](./docs-work-system.md) — type taxonomy and ownership
- [Work Management Guide](../../work/README.md)
