---
id: task.0299
type: task
status: needs_design
priority: 1
rank: 3
estimate: 2
title: "Doltgres graph registry — graph_registry table + catalog sync + eval:registry CLI"
summary: Add graph_registry + sync_state tables to @cogni/knowledge-store. Sync from catalog.ts via commit-cursor. CLI combines Doltgres catalog with Langfuse scores for eval coverage matrix.
outcome: "pnpm eval:sync-registry populates graph_registry from catalog.ts. pnpm eval:registry shows per-graph eval coverage + latest Langfuse pass rates."
initiative: proj.agent-eval-registry
assignees: []
labels: [ai, evals, doltgres, registry, knowledge-plane]
branch:
pr:
reviewer:
created: 2026-04-06
updated: 2026-04-06
---

# task.0299 — Doltgres graph registry + eval coverage CLI

## Context

Langfuse owns eval data (datasets, experiments, scores). Doltgres owns the graph catalog (what agents exist). This task adds the Doltgres side: `graph_registry` + `sync_state` tables. No eval tables in Doltgres — Langfuse handles that via OSS.

See [proj.agent-eval-registry](../projects/proj.agent-eval-registry.md) for full architecture.

Depends on:

- task.0286 (eval harness) — Langfuse datasets/scores must exist before `eval:registry` can query them
- Doltgres running in canary (`DOLTGRES_CONNECTION_STRING` in env)

## Validation

```bash
# Sync graph_registry from catalog.ts
pnpm eval:sync-registry
# Expected: UPSERT N rows, dolt commit if changed, skip if unchanged

# Show eval coverage matrix (Doltgres catalog + Langfuse scores)
pnpm eval:registry
# Expected:
# graph_id            | tier     | langfuse_datasets | last_pass_rate
# langgraph:brain     | core     | 1 (brain-v1)      | 85%
# langgraph:pr-review | core     | 1 (pr-review-v1)  | 90%
# langgraph:poet      | core     | 0                 | —
# ...
```
