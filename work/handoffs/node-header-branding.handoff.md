---
id: node-header-branding
type: handoff
work_item_id: task.0248
status: active
created: 2026-04-01
updated: 2026-04-01
branch: feat/node-header-branding
last_commit: 34b593e84
---

# Handoff: New Node Guide — Technical + Styling + CI/CD

## Context

- Cogni nodes are sovereign AI app instances forked from the operator
- PR #684 standardized per-node branding (icon, name, theme colors) across operator, poly, and resy
- A styling guide exists at `docs/guides/new-node-styling.md` covering the 4-file customization pattern
- Missing: a comprehensive "new node" guide that covers the full lifecycle from idea to deployment

## Current State

- **Done:** Per-node header/sidebar branding, teal theme for poly, clean GitHub/ModeToggle icons
- **Done:** `docs/guides/new-node-styling.md` — icon, colors, metadata, homepage checklist
- **Done:** `docs/guides/multi-node-dev.md` — dev commands, testing, DB/auth setup
- **Not done:** Comprehensive new-node creation guide combining technical + style + deployment
- **Not done:** CI/CD for node deployment (task.0247) — blocks public node creation
- **Not done:** Unified rounded UI theming (task.0257) — buttons, cards, dialogs

## What the Next Agent Builds

A single `docs/guides/creating-a-new-node.md` guide combining three tracks:

### 1. Technical Setup

- Choosing a core idea + mission for the node
- DAO formation via `/setup/dao` wizard (operator web UI)
- Filling out `.cogni/repo-spec.yaml` (node_id, scope_id, scope_key)
- Cloning `nodes/node-template/` and renaming packages
- Adding node-specific features under `app/src/features/`
- Adding node-specific graphs under `graphs/src/graphs/`
- Wiring capabilities in `app/src/bootstrap/container.ts`
- Adding root scripts (`typecheck:{name}`, `dev:{name}`)

### 2. Style Customization

- Reference: `docs/guides/new-node-styling.md` (already written)
- Choose Lucide icon + `cogni/{name}` branding
- Pick primary hue for CSS theme
- Customize homepage and chat suggestions
- Per-node chat welcome messages in `ChatComposerExtras.tsx`

### 3. Integration Back to Operator Repo

- PR structure: branch off `integration/multi-node`
- What goes in the PR: `nodes/{name}/`, root script additions, pnpm-workspace already covers `nodes/*/app` and `nodes/*/graphs`
- Validation: `pnpm typecheck:{name}` + manual dev server check

### 4. CI/CD (flag as prerequisite, not in guide yet)

- task.0247 must be completed before public node creation
- Per-node Dockerfiles, Docker Compose services, Caddy routing
- Per-node DNS (`{name}.cognidao.org`)
- Per-node database provisioning (task.0247 design notes)
- Until task.0247 ships, nodes run in local dev only

## Risks / Gotchas

- Each node copies ~840 files (~3 GB RAM in dev). Document this and reference task.0248 as the fix
- `tsconfig.app.json` must use `../../../tsconfig.base.json` (3 levels) and override `@/*` paths locally
- `next.config.ts` `outputFileTracingRoot` must be `../../../` not `../../`
- Biome does not lint node files (by design — they mirror operator). Lint issues in nodes must be caught by typecheck
- Pre-commit hooks may fail if other devs have uncommitted changes in shared worktree

## Pointers

| File / Resource                      | Why it matters                                          |
| ------------------------------------ | ------------------------------------------------------- |
| `docs/guides/new-node-styling.md`    | Existing 4-file styling checklist — embed or link       |
| `docs/guides/multi-node-dev.md`      | Dev commands and testing — embed or link                |
| `docs/spec/node-formation.md`        | DAO formation spec (repo-spec, scope_id)                |
| `docs/spec/identity-model.md`        | node_id, scope_id, user_id definitions                  |
| `.cogni/repo-spec.yaml`              | Node identity template                                  |
| `nodes/node-template/`               | The base to copy from                                   |
| `work/items/task.0247`               | CI/CD blocker — design notes for deployment             |
| `work/items/task.0248`               | Shared platform extraction (eliminates 840-file copies) |
| `work/items/task.0257`               | Unified rounded UI theming (buttons, cards, dialogs)    |
| `.claude/skills/node-setup/SKILL.md` | Existing agentic node setup skill (7-phase lifecycle)   |
