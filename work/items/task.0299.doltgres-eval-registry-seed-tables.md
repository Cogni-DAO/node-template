---
id: task.0299
type: task
status: needs_design
priority: 1
rank: 3
estimate: 3
title: "Doltgres eval registry — 4 seed tables + catalog sync + eval dual-write"
summary: Add graph_registry, eval_definitions, eval_runs, eval_results tables to @cogni/knowledge-store. Sync from catalog.ts on startup. Eval harness writes to Doltgres alongside Langfuse.
outcome: "Every node's Doltgres has a queryable graph registry + eval score matrix. dolt log shows eval history. dolt diff shows what changed between runs."
initiative: proj.agent-eval-registry
assignees: []
labels: [ai, evals, doltgres, registry, knowledge-plane]
branch:
pr:
reviewer:
created: 2026-04-06
updated: 2026-04-06
---

# task.0299 — Doltgres eval registry seed tables

## Context

See [proj.agent-eval-registry](../projects/proj.agent-eval-registry.md) for full design. This task implements P0: the 4 seed tables, catalog sync, and eval harness dual-write.

Depends on task.0286 (eval harness) being implemented first. This task adds Doltgres as a second output target.

## Validation

```bash
# Registry sync populates graph_registry from catalog.ts
pnpm eval:sync-registry

# Eval run writes to Doltgres alongside Langfuse
EVAL_TARGET_URL=https://canary.cogni.dev pnpm eval:canary

# Query eval coverage matrix
pnpm eval:registry
# Expected: table showing graph_id, eval_count, code_evals, judge_evals, last_pass_rate
```
