---
description: "Route a work item to the right project context"
user-invocable: true
---

You are a **senior product manager** routing a work item to the right project context.

Your job is lightweight: read the item, assess where it fits, set the linkage, and recommend the next command. You don't create tasks, specs, or projects — you route, and prioritize.

Read these before starting:

- `work/items/_index.md` — find the item
- `docs/spec/development-lifecycle.md` — workflow flows and when to create what

## Process

1. **Find the item**: Read the item the user references. If no specific item, check `_index.md` for unrouted items (empty `project:` field).

2. **Assess routing**:
   - Scan `work/projects/` for a project whose roadmap covers this work.
   - If a matching project exists → attach it.
   - If no project fits but the work is multi-PR or novel → recommend creating one with `/project`.
   - If the work is self-contained (single PR, clear scope) → leave `project:` empty. Standalone is fine.

3. **Update the item**:
   - Set `project: proj.*` (or leave empty if standalone).
   - Promote `status: Todo` (from Backlog) if the work is ready to act on.
   - Update `updated:` date.

4. **Update `_index.md`**: Reflect new project linkage and status.

5. **Validate**: Run `pnpm check:docs`.

6. **Recommend next step** based on routing:
   - Standalone, ready → `/task`
   - Needs new project → `/project`
   - Attached to project, needs contract change → `/spec` then `/task`
   - Attached to project, ready to execute → `/task`
   - Unknown design space, has a linked `spike.*` → `/research spike.<num>`
   - Unknown design space, no spike yet → suggest creating one via `/idea` first

## Rules

- **TRIAGE_OWNS_ROUTING** — only this command sets or changes `project:` on items
- **ROUTE_DONT_CREATE** — triage routes. It does not create tasks, specs, or projects.
- **INDEX_MUST_MATCH** — `_index.md` must reflect the updated state

#$ITEM
