---
id: task.0099
type: task
title: "Node ID infra: repo-spec + DB persistence + boot-time drift protection"
status: needs_design
priority: 1
rank: 3
estimate: 2
summary: "Make node_id a real, persisted identity: generated at init, stored in repo-spec, persisted in DB, and validated on boot to prevent identity drift."
outcome: "Every deployment has a stable node_id; DB contains exactly one canonical node_id; startup fails on mismatch; setup tooling mints fresh IDs for new nodes."
labels: [ledger, infra, identity]
assignees: []
credit:
project:
branch:
pr:
reviewer:
revision: 0
blocked_by:
created: 2026-02-21
updated: 2026-02-21
---

# Node ID infra (MVP)

## Requirements

- **Repo-spec**: add `node_id: <uuid>` (minted during the "generate DAO / init" flow).
- **DB**: add `node_meta` (or `nodes`) table with `node_id UUID PRIMARY KEY`, `created_at TIMESTAMPTZ DEFAULT now()`.
- **Boot rule**:
  - If table empty → insert `node_id` from repo-spec (fallback: `NODE_ID` env var for legacy).
  - If table has value → **hard fail** if it doesn't match repo-spec (or env fallback).
- **Clone safety**: init to generate a new UUID if repo-spec lacks node_id; refuse to overwrite unless `--force`.

## Allowed Changes

- `packages/db-schema/src/*` + new migration
- `src/shared/env/*` (read node_id from repo-spec / env fallback)
- `src/bootstrap/*` (seed + assert)
- `repo-spec.yaml` schema + setup/init script that writes it
- Minimal unit test for "seed once + mismatch fails"

## Plan

- [ ] Add table + migration
- [ ] Read `node_id` from repo-spec; fallback to `NODE_ID` env for existing deployments
- [ ] Implement seed/assert in bootstrap
- [ ] Update setup/init script to mint `node_id` and write to repo-spec
- [ ] Add a single test: mismatch triggers startup error

## Validation

- Fresh DB + repo-spec node_id → boots and seeds
- Existing DB seeded + matching config → boots
- Mismatch (DB != config) → **fails fast**
