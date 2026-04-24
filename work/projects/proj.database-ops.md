---
id: proj.database-ops
type: project
primary_charter:
title: Database Operations — Backups, Pooling & Credential Management
state: Active
priority: 1
estimate: 4
summary: WAL-G continuous backups, credential convergence, connection pooling, DSN-only provisioning
outcome: Postgres with automated backups (RPO ~5m, RTO <1h), convergent credentials, optional pooler, enterprise readiness controls
assignees: derekg1729
created: 2026-02-07
updated: 2026-02-07
labels: [infra, database, enterprise-readiness]
---

# Database Operations — Backups, Pooling & Credential Management

> Source: docs/DATABASE_OPS_SPEC.md (roadmap content extracted during docs migration)

## Goal

Adopt Supabase OSS building blocks (WAL-G, optionally Supavisor/pgBouncer) — not the full Supabase platform — to close critical infrastructure gaps: no backups, stale credentials, no connection pooling. The application, RLS model, provisioner, and DSN contract remain unchanged.

> [!CRITICAL]
> **No backup exists today.** A single `docker volume rm` or disk failure results in total data loss. This is the highest-priority gap in the current infrastructure.

## Roadmap

### Crawl (P0) — Backups (data loss mitigation)

**Goal:** WAL-G continuous archiving to S3-compatible storage (Cloudflare R2, Backblaze B2, or MinIO).

| Deliverable                                        | Status      | Est | Work Item |
| -------------------------------------------------- | ----------- | --- | --------- |
| WAL-G sidecar/cron container in docker-compose     | Not Started | 2   | —         |
| `postgresql.conf` overrides (archive_mode, etc.)   | Not Started | 1   | —         |
| Backup secrets provisioning per environment        | Not Started | 1   | —         |
| Nightly `pg_basebackup` + continuous WAL archiving | Not Started | 2   | —         |
| Restore runbook in `platform/runbooks/`            | Not Started | 1   | —         |
| Monthly restore test cadence with evidence         | Not Started | 1   | —         |

**Recovery Targets:**

| Target                  | Value      | Rationale                                                               |
| ----------------------- | ---------- | ----------------------------------------------------------------------- |
| **RPO** (max data loss) | ~5 minutes | Continuous WAL archiving; loss window = unarchived WAL since last flush |
| **RTO** (max downtime)  | < 1 hour   | Base backup restore + WAL replay to a fresh container                   |

These are initial targets for a single-VM deployment. Adjust when moving to managed Postgres or multi-region.

**Retention Policy:**

| Artifact                | Retention         | Storage                                               |
| ----------------------- | ----------------- | ----------------------------------------------------- |
| Full base backups       | 7 daily, 4 weekly | S3-compatible (R2/B2)                                 |
| WAL archive segments    | 30 days           | Same bucket, `/wal/` prefix                           |
| Oldest restorable point | 30 days           | Determined by oldest retained base backup + WAL chain |

WAL-G's `delete retain` handles garbage collection of expired backups.

**Compose Changes:**

- Add `wal-g` sidecar or cron container with access to `postgres_data` volume
- Add backup-specific env vars: `WALG_S3_PREFIX`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- Nightly `pg_basebackup` + continuous WAL archiving
- Add `postgresql.conf` overrides: `archive_mode = on`, `archive_command` pointing to WAL-G

**New Secrets (per environment):**

| Secret                         | Description                |
| ------------------------------ | -------------------------- |
| `BACKUP_S3_ENDPOINT`           | S3-compatible endpoint URL |
| `BACKUP_S3_BUCKET`             | Bucket name                |
| `BACKUP_AWS_ACCESS_KEY_ID`     | Storage credentials        |
| `BACKUP_AWS_SECRET_ACCESS_KEY` | Storage credentials        |

**Restore Runbook & Testing:**

A restore runbook must be written in `platform/runbooks/` covering:

1. Pull latest base backup from S3
2. Restore to throwaway container with WAL replay to target timestamp
3. Verify row counts / schema version / spot-check application data
4. Document restore time and any issues

**Restore test cadence:** Monthly. Each test produces evidence artifacts:

| Artifact                                                                                     | Purpose                      |
| -------------------------------------------------------------------------------------------- | ---------------------------- |
| Restore log (stdout capture)                                                                 | Proof that restore completed |
| Timestamp of backup used                                                                     | Proves RPO claim             |
| Wall-clock restore duration                                                                  | Proves RTO claim             |
| Schema version check (`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1`) | Data integrity verification  |

Evidence is stored in the S3 bucket under `/restore-tests/YYYY-MM-DD/`.

**Scope boundary:** No app code changes. No DSN changes. No provisioner changes.

### Walk (P1) — Credential Convergence

**Goal:** Eliminate "stale volume keeps old password" class of bugs. Provision becomes convergent: create-or-update, not create-or-skip.

| Deliverable                                    | Status      | Est | Work Item            |
| ---------------------------------------------- | ----------- | --- | -------------------- |
| Dedicated `app_migrator` role (DDL separated)  | Not Started | 2   | task.0055            |
| `provision.sh` gains `ALTER ROLE ... PASSWORD` | Not Started | 2   | (create at P1 start) |
| Credential rotation evidence in deploy logs    | Not Started | 1   | (create at P1 start) |

Already tracked in DATABASE_RLS_SPEC.md P1:

> Credential rotation support: `provision.sh` should `ALTER ROLE ... PASSWORD` for existing roles, not skip them

**Scope boundary:** `provision.sh` only. No app code changes.

### Run (P2) — Connection Pooler

**Goal:** Add pgBouncer between app and Postgres. Hard trust boundary.

| Deliverable                                           | Status      | Est | Work Item            |
| ----------------------------------------------------- | ----------- | --- | -------------------- |
| pgBouncer service in docker-compose on `internal` net | Not Started | 2   | (create at P2 start) |
| DSN host repoint: `postgres:5432` → `pgbouncer:6432`  | Not Started | 1   | (create at P2 start) |
| Network segmentation (db-only network for postgres)   | Not Started | 1   | (create at P2 start) |

**Trust-boundary requirements:**

- App/migrate/scheduler-worker containers must not have network access to `postgres:5432` — only to `pgbouncer:6432`. Enforce via Docker network segmentation (pooler on `internal`, postgres on a `db-only` network).
- pgBouncer auth config (`userlist.txt` or `auth_query`) must not log or expose passwords. Use `auth_type = scram-sha-256`.
- pgBouncer admin console (`pgbouncer` virtual database) must be disabled or bound to localhost only.

**Why defer:** Current connection count is low (single app + scheduler-worker). Pooling becomes valuable at higher concurrency or if Postgres moves to managed/external hosting.

**Scope boundary:** DSN host changes + network topology. No app code changes. No RLS changes.

### Per-Node Schema Independence

**Goal:** Each node owns its DB schema — no cross-node table leak, no shared migration numbering.

| Deliverable                                                        | Status       | Est | Work Item                                                                  |
| ------------------------------------------------------------------ | ------------ | --- | -------------------------------------------------------------------------- |
| Per-node drizzle configs + per-node migrator images + legacy purge | done         | 2   | task.0324 ([PR #916](https://github.com/Cogni-DAO/node-template/pull/916)) |
| Un-no-op prod poly/resy migration Jobs (gated on DB inspection)    | needs_design | 1   | task.0324 Phase 3 (follow-up)                                              |
| **Future:** Atlas + GitOps migrations (declarative schema, CRD)    | needs_design | 5   | task.0325                                                                  |

task.0324 delivered per-node sovereignty of schema + migration ownership. task.0325 preserves the Atlas adoption plan for when destructive-change linting warrants the investment.

### Migration Runtime: initContainer on the Runtime Image

**Goal:** migrations run as a Deployment initContainer reusing the main container's image digest. One image per node. No Argo PreSync hook Jobs on node-app. Cuts `candidate-flight` verify-candidate wait from 4–9 min to ~60s (bug.0368: the separate migrator image caused per-flight cold image pulls that dominated the wait).

| Deliverable                                                                                                                | Status       | Est | Work Item |
| -------------------------------------------------------------------------------------------------------------------------- | ------------ | --- | --------- |
| bug.0368 diagnosis: migrator image pull dominates verify wait (migration itself ~8s; total Job ~3m52s)                     | done         | 1   | bug.0368  |
| PR A — additive: per-node `migrate.mjs` + Dockerfile COPY + initContainer block in `base/node-app/deployment.yaml`          | needs_design | 2   | task.0370 |
| PR B — cleanup: delete migration-job.yaml + migrator Dockerfile stage + migrator image build/promote surface + overlay refs | needs_design | 2   | task.0370 |
| PR C — validate + apply same pattern to `poly-doltgres` (separate DB, non-compliant extended protocol)                      | needs_design | 1   | task.0370 |
| Follow-up: CI lint for destructive SQL without `needs_two_deploys` pragma                                                  | needs_design | 1   | task.0371 |
| Follow-up: migrator credential scoping (`app_migrator` role) — coupled to P1 credential convergence below                   | needs_design | 1   | (P1)      |

**Hard invariant under this design:** `FORWARD_COMPAT_MIGRATIONS` — every migration must be compatible with the prior code version, because `strategy: RollingUpdate` means old pods serve traffic against the newly-migrated schema during the rollover window. (Same obligation existed under the PreSync-hook pattern; task.0370 makes it explicit.) See [databases.md](../../docs/spec/databases.md) §2 invariants.

### P3 — DSN-Only Provisioning

**Goal:** 3 DSNs become the only database secrets.

| Deliverable                                  | Status      | Est | Work Item            |
| -------------------------------------------- | ----------- | --- | -------------------- |
| Provisioner parses DSNs with real URL parser | Not Started | 2   | (create at P3 start) |
| `APP_DB_*` component secrets deleted         | Not Started | 1   | (create at P3 start) |

Already tracked in DATABASE_URL_ALIGNMENT_SPEC.md P1-P2:

- Provisioner parses `DATABASE_ROOT_URL`, `DATABASE_URL`, `DATABASE_SERVICE_URL` with a real URL parser
- `APP_DB_*` component secrets deleted
- 3 DSNs become the only database secrets

**Scope boundary:** provision.sh rewrite + secret cleanup. No app code changes.

## Constraints

- Postgres remains our database — no platform migration
- Only adopt Supabase OSS building blocks, NOT the full self-hosted platform
- RLS dual-role architecture (`app_user` + `app_service`) stays unchanged
- Each phase has explicit scope boundaries — no app code changes in P0-P2

## Enterprise Readiness Alignment

| Control                                                                           | Phase                       | Evidence                                                                                   |
| --------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------ |
| **Availability** — data recoverable after failure                                 | P0 (backups)                | Monthly restore test artifacts (logs, timestamps, schema check)                            |
| **Access control integrity** — credentials converge to intended state             | P1 (credential convergence) | Provision logs show `ALTER ROLE` on every deploy, not just first run                       |
| **Access control boundary** — app cannot bypass pooler to reach Postgres directly | P2 (pooler)                 | Network segmentation in compose; no direct `postgres:5432` route from app                  |
| **Auditability** — high-risk DB ops are recorded                                  | P0+                         | Backup/restore operations logged to S3 with timestamps; deploy events already emit to Loki |

**Observability scope for DB ops:** Record backup runs, restore tests, and credential rotation events as structured log entries (Pino → Loki). Per-request/per-job actor context is already handled by the RLS `SET LOCAL` pattern. We do not add per-query audit logging — that's `pg_audit` territory (tracked in DATABASE_RLS_SPEC.md P1).

## What We Explicitly Do NOT Do

- **Self-host full Supabase stack.** We don't need their auth, storage, realtime, or API gateway. We already have Postgres + RLS + explicit DSNs + provisioner.
- **Move to managed Postgres (RDS, Supabase hosted, Neon).** Not ruled out long-term, but not required to solve the current gaps. If we do, P0-P2 still apply (backups become provider-managed, pooler becomes provider PgBouncer).
- **Change the RLS model.** The dual-role architecture (`app_user` + `app_service`) is correct and stays.

## Dependencies

- [x] Postgres deployment (existing)
- [x] RLS model (existing — DATABASE_RLS_SPEC.md)
- [ ] S3-compatible storage account (R2/B2/MinIO)

## As-Built Specs

- [databases.md](../../docs/spec/databases.md) — §2 Migration Strategy + §4 Technical Implementation describe the **one-image-per-node + initContainer** runtime (task.0370, post-PR-B). §5 Trade-offs + §6.4/§6.5 carry the forward-compat invariant and follow-up CI-lint plan. §5 originally documented the two-image (runner + migrator) split from task.0324; that text is obsoleted in-place by task.0370.

### Roadmap — Supabase Evaluation Decisions Track

> Source: docs/SUPABASE_EVALUATION.md (roadmap content extracted during docs migration)

#### What We Should Stop Building (Commodity Duplication)

| Item                           | Stop building     | Adopt instead                                           |
| ------------------------------ | ----------------- | ------------------------------------------------------- |
| Backup solution from scratch   | Yes               | WAL-G sidecar (already specced) or Supabase hosted PITR |
| Connection pooler from scratch | Yes               | pgBouncer (already specced) or Supavisor                |
| Custom admin/data browser UI   | Yes (don't start) | pgAdmin, Supabase Studio, or Drizzle Studio             |

#### Recommended Phased Plan

| Phase     | Action                                                        | Touches app code?              | Timeline signal                           |
| --------- | ------------------------------------------------------------- | ------------------------------ | ----------------------------------------- |
| **P0**    | Add WAL-G backup sidecar (per this initiative)                | No                             | Before any production data matters        |
| **P1**    | Credential convergence in provision.sh                        | No                             | Next deploy cycle                         |
| **P2**    | Add pgBouncer between app and Postgres                        | DSN host change only           | When connection count > 20                |
| **Eval**  | If file storage needed → adopt Supabase Storage (self-hosted) | New adapter                    | When feature requires uploads             |
| **Eval**  | If ops burden too high → migrate Postgres to Supabase hosted  | DSN change + verify RLS compat | When team wants managed DB                |
| **Never** | Replace SIWE auth with Supabase Auth                          | N/A                            | Wallet identity is non-negotiable         |
| **Never** | Replace API routes with PostgREST                             | N/A                            | Contracts + billing hooks + observability |
| **Never** | Adopt Supabase Realtime for AI streaming                      | N/A                            | assistant-stream works well               |

## Design Notes

- Derived from [Supabase Evaluation](../../docs/research/supabase-evaluation.md) full codebase vs. Supabase capability audit
- [Maximize OSS Tools](proj.maximize-oss-tools.md) — WAL-G identified as P0 prerequisite
- [Database RLS Spec](../../docs/spec/database-rls.md) — P1 credential rotation item
- [Database URL Alignment](../../docs/spec/database-url-alignment.md) — P3 DSN-only end state
- [Databases Spec](../../docs/spec/databases.md) — Migration architecture, two-image strategy
