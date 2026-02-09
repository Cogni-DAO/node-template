---
id: development-lifecycle
type: spec
title: Development Lifecycle
status: draft
spec_state: proposed
trust: draft
summary: How specs, projects, and items work together — from idea to merged code
read_when: Starting a new feature, understanding how to write specs, or reviewing PRs
implements: proj.development-workflows
owner: derekg1729
created: 2026-02-05
verified: 2026-02-09
tags: [workflow, specs, projects]
---

# Development Lifecycle

## Context

Developers need a clear workflow that separates:

- **What we're building** (specs — as-built contracts)
- **What we're planning** (projects — roadmaps, design intent)
- **What we're doing now** (items — PR-sized execution)

Without this separation, specs become cluttered with roadmaps, or projects become mega-tasks that rot.

## Goal

A simple, enforceable workflow where:

- **Specs** are as-built contract truth (no roadmaps/checklists)
- **Projects** are pre-implementation planning (may exist before any code)
- **Items** are PR-sized execution
- **Work drives change; specs record what IS**

## Non-Goals

- Prescribing project management methodology
- Defining Plane/GitHub integration details (see [docs-work-system.md](./docs-work-system.md))
- Covering doc types beyond spec/project/item

---

## Core Invariants

1. **SPECS_ARE_AS_BUILT**: Specs describe current implementation only. Roadmaps and phases live in projects.

2. **SPEC_STATE_LIFECYCLE**: Every spec has a `spec_state` field: `draft` → `proposed` → `active` → `deprecated`. No skipping states.

3. **ACTIVE_MEANS_CLEAN**: When `spec_state: active`, the spec's "Open Questions" section must be empty.

4. **PR_REFERENCES_REQUIRED**: Every code PR body must include `Work:` (item ID, e.g. `task.0001`). Behavior/security/interface changes also require `Spec:` link.

5. **PROJECTS_BEFORE_CODE**: Projects may exist before any code. They hold the roadmap; specs are created when code merges.

---

## Design

### The Three Primitives

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   /docs/spec/              /work/projects/       /work/items/   │
│   ═══════════              ══════════════════    ═════════════  │
│                                                                 │
│   As-Built Contract        Pre-Code Planning     PR-Sized Work  │
│   • Current invariants     • Crawl/Walk/Run      • Checklist    │
│   • Acceptance checks      • Design intent       • PR checklist │
│   • Implementation notes   • Dependencies        • Validation   │
│                            • Work item list                     │
│                                                                 │
│   Created AFTER merge      May exist BEFORE      Links to both  │
│                            any code                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Spec State Lifecycle

| State        | Meaning                                    | What's Required                                       |
| ------------ | ------------------------------------------ | ----------------------------------------------------- |
| `draft`      | Exploratory. May not match implementation. | Invariants can be incomplete. Open Questions allowed. |
| `proposed`   | Stable enough to review against.           | Invariants enumerated. Acceptance checks defined.     |
| `active`     | Implemented and enforced. Matches code.    | Open Questions empty. `verified:` date current.       |
| `deprecated` | No longer authoritative.                   | Points to replacement spec.                           |

### Workflow: Idea → Merged Code

```
1. CREATE PROJECT (optional for multi-PR work)
   └── /work/projects/proj.feature.md
       • Goal, crawl/walk/run roadmap
       • Constraints, dependencies
       • Work items by ID

2. CREATE ITEM (PR-sized)
   └── /work/items/task.0001.feature.md
       • Execution checklist
       • PR checklist (Work + Spec links)
       • Validation commands

3. OPEN PR
   └── PR body includes:
       Work: task.0001
       Spec: docs/spec/feature.md#core-invariants (if exists)

4. REVIEW + MERGE
   └── Reviewer checks diff against spec invariants (if spec exists)
   └── CI validates PR body format
   └── Acceptance checks must pass

5. CREATE/UPDATE SPEC (after merge)
   └── /docs/spec/feature.md
       • spec_state: active (if fully implemented)
       • Describes what IS, not what WILL BE
       • Open Questions empty
```

### When to Create What

| Situation                     | Action                                               |
| ----------------------------- | ---------------------------------------------------- |
| Small fix, no behavior change | Item only. No spec or project needed.                |
| Single PR, clear scope        | Item + reference existing spec (or skip if trivial). |
| Multi-PR effort               | Project + Items. Create spec when code merges.       |
| Architecture decision         | ADR in `docs/decisions/adr/`.                        |

### PR Body Format

Every code PR must include:

```markdown
## References

Work: task.0001
Spec: docs/spec/feature.md#core-invariants
```

**CI enforcement:**

- Missing `Work:` → merge blocked
- Missing `Spec:` → warning (blocked if `arch_change=yes`)

---

## Acceptance Checks

**Automated:**

- `node scripts/validate-docs-metadata.mjs` — validates frontmatter including `spec_state`

**Manual (until automated):**

1. Specs do not contain roadmaps or phases (those belong in projects)
2. When spec is marked `active`, Open Questions is empty
3. PRs reference a work item

---

## Open Questions

<!-- This section must be empty when spec_state is active -->

- [ ] Should we lint specs for roadmap/phase language?

---

## Related

- [Docs + Work System](./docs-work-system.md) — document taxonomy
- [Work Management Guide](../../work/README.md)
- [Project Template](../../work/_templates/project.md)
- [Charter Template](../../work/_templates/charter.md)
- [Item Template](../../work/_templates/item.md)
- [Spec Template](../_templates/spec.md)
