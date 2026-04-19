---
id: task.0326
type: task
title: "Ledger/attribution worker: rename DATABASE_URL and enforce no-DB-creds invariant on scheduler-worker"
status: needs_design
priority: 3
rank: 6
estimate: 2
summary: "Follow-up to task.0280. The scheduler path no longer needs a DB client, but the attribution/ledger container (optional second workflow in the same worker pod) still reads `config.DATABASE_URL`. Rename that env var to `LEDGER_DATABASE_URL`, remove `DATABASE_URL` entirely from scheduler-worker-secrets, and add an arch-level assertion that the worker container has zero env vars matching `/^DATABASE_URL$/`."
outcome: "scheduler-worker has no plaintext `DATABASE_URL` in its k8s Secret or compose env. Ledger path reads `LEDGER_DATABASE_URL`. CI asserts via depcruise or a dedicated env-shape test that no code in `services/scheduler-worker/**` reads `DATABASE_URL`. Invariant SHARED_COMPUTE_HOLDS_NO_DB_CREDS in docs/spec/multi-node-tenancy.md is enforceable, not aspirational."
spec_refs:
  - docs/spec/multi-node-tenancy.md
  - docs/spec/scheduler.md
assignees: []
credit:
project: proj.unified-graph-launch
initiative:
branch:
pr:
reviewer:
revision: 0
blocked_by:
  - task.0280
deploy_verified: false
related:
  - bug.0322
  - task.0280
created: 2026-04-19
updated: 2026-04-19
labels:
  - multi-node
  - scheduler
  - security
  - observability
external_refs:
---

# Ledger worker DB isolation — follow-up to task.0280

## Why this is separate

task.0280 closed the cross-node run-visibility leak (bug.0322) and restored chat on poly/resy. It made `DATABASE_URL` **optional** on the scheduler-worker because the scheduler path went HTTP. But the same worker pod can also host the attribution/ledger workflow (`ledger-tasks` task queue), which still reads `config.DATABASE_URL` to construct a Drizzle adapter against the attribution ledger.

The ledger ledger is a **single shared store** (not per-node), so it does not violate the cross-node isolation invariant bug.0322 was about. It does, however, violate the broader invariant task.0280 codified: _shared compute holds no per-node DB credentials, and more generally, shared compute's DB access should be named for what it reaches, not a generic `DATABASE_URL`._

Splitting this into its own task because:

1. The ledger rollout has separate operational concerns (DB schema ownership, migration cadence).
2. Renaming a secret key requires coordinated Secret + Deployment changes and SOPS re-encryption of `infra/k8s/secrets/{staging,production}/scheduler-worker.enc.yaml`, which task.0280 intentionally did not touch (revert-safety).
3. The invariant test belongs with the rename, not before it — a test that asserts "no DATABASE_URL" has to go green on the same PR.

## Scope

1. **Rename** `config.DATABASE_URL` → `config.LEDGER_DATABASE_URL` in `services/scheduler-worker/src/bootstrap/env.ts` and the ledger container constructor.
2. **Secrets**: re-encrypt `infra/k8s/secrets/{staging,production}/scheduler-worker.enc.yaml` with the new key. Update `.example` files. Remove the deprecated key only after staging runs clean.
3. **Local compose**: update `infra/compose/runtime/docker-compose.dev.yml` to pass `LEDGER_DATABASE_URL` to scheduler-worker instead of `DATABASE_URL` (when ledger is enabled).
4. **Invariant test**: add a dep-cruiser rule or a tiny Vitest that parses `services/scheduler-worker/src/bootstrap/env.ts` AST and fails if the Zod schema contains a key literally matching `DATABASE_URL`.
5. **Spec**: update `SHARED_COMPUTE_HOLDS_NO_DB_CREDS` to reference the enforcement mechanism.

## Out of scope

- Migrating the ledger to HTTP delegation (it would need an "operator internal API for attribution" which doesn't exist). Valid future work; not cheap.
- Auth-scope bearer claim (bug.0322 defect #2). Separate thread.

## Rollout

Backwards-compatible sequence:

1. Accept **both** `DATABASE_URL` and `LEDGER_DATABASE_URL` in env schema, prefer the latter.
2. Deploy; flip the Secret key in each env; verify ledger workflow still runs.
3. Remove the deprecated `DATABASE_URL` fallback; ship the invariant test.

Revert = revert commit; no data migration.

## Validation

- Follow-up design; implementation gated by task.0280 merge.
- Acceptance test: grep `services/scheduler-worker/**` for `DATABASE_URL` and expect zero hits after rename; `LEDGER_DATABASE_URL` present only in ledger bootstrap + env schema.
