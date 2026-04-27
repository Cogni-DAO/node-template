---
id: task.0390
type: task
title: flatten `nodes/node-template/` migration baseline to a single 0000 fresh-start
status: needs_design
priority: 3
rank: 50
estimate: 2
summary: "`nodes/node-template/` carries 27 journal entries from the pre-task.0324 split. Future forks (canary `ai-only`, future external nodes) inherit the entire history including all the same intermediate-snapshot gaps that bit poly in bug.0389. node-template is a fork starting point, not a deployed surface — squashing to one cumulative 0000_baseline.sql + matching snapshot is defensible and removes the legacy weight before the next node lands."
outcome: "After this task: `nodes/node-template/app/src/adapters/server/db/migrations/` contains exactly one entry (`0000_baseline.sql` + `meta/0000_snapshot.json`) capturing the cumulative schema produced by the existing 27 migrations. `pnpm db:check:node-template` (added by this task) passes. Future forks start clean. **Pre-flight check required:** confirm node-template is not deployed against `cogni_template_test` or any other DB whose `__drizzle_migrations` table would conflict with the squash. If it is, scope expands to coordinated DB surgery + this task is rerated."
spec_refs:
  - databases-spec
assignees: []
credit:
project: proj.database-ops
pr:
reviewer:
revision: 0
blocked_by: [bug.0389]
deploy_verified: false
created: 2026-04-27
updated: 2026-04-27
labels: [db, drizzle, infra, multi-node, tech-debt]
external_refs:
---

# flatten `nodes/node-template/` migration baseline to a single 0000 fresh-start

## Context

bug.0389 surfaced that hand-authored RLS/trigger migrations across cogni-template have routinely shipped without matching drizzle snapshots, causing chain rot. poly's chain head was stale by 4 migrations and required a fresh-baseline snapshot to unblock `db:generate:poly`.

`nodes/node-template/` is the fork starting point for new nodes (next up: canary `ai-only`). It carries the same 27-entry journal lineage from before task.0324 split per-node configs, with the same snapshot-gap pattern. Anything forked from it inherits the full debt.

## Approach

1. **Pre-flight: verify node-template is not deployed against any DB.** `cogni_template_test` is mentioned in CI configs (`.env.test`, `ci.yaml`). Confirm whether that DB applies node-template's migrations or operator's. If it's operator's (more likely post-task.0324), squashing node-template is safe. If node-template's, scope expands.
2. Stand up a clean Postgres locally; apply all 27 migrations in order via `drizzle-kit migrate`.
3. Use `drizzle-kit introspect` (or the trim-journal-and-generate trick from bug.0389) to produce one `0000_baseline.sql` + `0000_snapshot.json` capturing the cumulative state.
4. Replace `nodes/node-template/app/src/adapters/server/db/migrations/` contents.
5. Add `db:check:node-template` + `db:generate:node-template` to `package.json`; extend the `db:check` umbrella.
6. Update `docs/spec/databases.md §2 Migration Strategy` to note that node-template is a fork-point with a flattened baseline (not a historical record).

## Out of scope

- Squashing operator + resy. Both are deployed; their `__drizzle_migrations` tables would conflict. Track separately if/when the cumulative weight matters.
- Backfilling old git history of node-template's migrations. Git keeps it; the squashed tree is the new starting point only.

## Validation

```yaml
exercise: |
  cd <fresh worktree off this branch>
  pnpm install --frozen-lockfile
  pnpm db:check:node-template      # passes
  pnpm db:generate:node-template   # "No schema changes, nothing to migrate"
  ls nodes/node-template/app/src/adapters/server/db/migrations/*.sql | wc -l  # = 1
observability: none — pure source-tree restructure
```
