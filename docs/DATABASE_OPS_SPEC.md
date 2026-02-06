# Database Operations: Backups, Pooling & Credential Management

> [!CRITICAL]
> **No backup exists today.** A single `docker volume rm` or disk failure results in total data loss. This is the highest-priority gap in the current infrastructure.

---

## North Star

Postgres remains our database. We adopt **only** Supabase OSS building blocks (WAL-G, optionally Supavisor/pgBouncer) — not the full Supabase self-hosted platform. The application, RLS model, provisioner, and DSN contract are unchanged.

| Deliverable                | What Changes                                                                  | What Doesn't Change                          |
| -------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------- |
| **Backups (WAL-G)**        | New sidecar container + external object storage                               | Postgres image, volume layout, provision.sh  |
| **Connection pooler**      | New service in front of Postgres; DSN host changes from `postgres` → `pooler` | App code, RLS, DSN format                    |
| **Credential convergence** | provision.sh gains `ALTER ROLE ... PASSWORD`                                  | DSN-only runtime contract, secret generation |

---

## Phased Rollout

### P0: Backups (data loss mitigation)

Add WAL-G continuous archiving to S3-compatible storage (Cloudflare R2, Backblaze B2, or MinIO).

**Compose changes:**

- Add `wal-g` sidecar or cron container with access to `postgres_data` volume
- Add backup-specific env vars: `WALG_S3_PREFIX`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- Nightly `pg_basebackup` + continuous WAL archiving
- Add `postgresql.conf` overrides: `archive_mode = on`, `archive_command` pointing to WAL-G

**New secrets (per environment):**

| Secret                         | Description                |
| ------------------------------ | -------------------------- |
| `BACKUP_S3_ENDPOINT`           | S3-compatible endpoint URL |
| `BACKUP_S3_BUCKET`             | Bucket name                |
| `BACKUP_AWS_ACCESS_KEY_ID`     | Storage credentials        |
| `BACKUP_AWS_SECRET_ACCESS_KEY` | Storage credentials        |

**Validation:** Manual restore test to a throwaway container. Document in runbook.

**Scope boundary:** No app code changes. No DSN changes. No provisioner changes.

### P1: Credential Convergence

Already tracked in [DATABASE_RLS_SPEC.md](DATABASE_RLS_SPEC.md) P1:

> Credential rotation support: `provision.sh` should `ALTER ROLE ... PASSWORD` for existing roles, not skip them

This eliminates the "stale volume keeps old password" class of bugs (the exact issue that took down preview). Provision becomes convergent: create-or-update, not create-or-skip.

**Scope boundary:** `provision.sh` only. No app code changes.

### P2: Connection Pooler

Add pgBouncer (simpler, battle-tested) or Supavisor (if multi-tenant features needed later) between app and Postgres.

**Compose changes:**

- Add `pgbouncer` service on `internal` network
- Repoint DSN host: `postgres:5432` → `pgbouncer:6432`
- Postgres no longer directly reachable from app containers

**Why defer:** Current connection count is low (single app + scheduler-worker). Pooling becomes valuable at higher concurrency or if Postgres moves to managed/external hosting.

**Scope boundary:** DSN host changes only. No app code changes. No RLS changes.

### P3: DSN-Only Provisioning

Already tracked in [DATABASE_URL_ALIGNMENT_SPEC.md](DATABASE_URL_ALIGNMENT_SPEC.md) P1-P2:

- Provisioner parses `DATABASE_ROOT_URL`, `DATABASE_URL`, `DATABASE_SERVICE_URL` with a real URL parser
- `APP_DB_*` component secrets deleted
- 3 DSNs become the only database secrets

**Scope boundary:** provision.sh rewrite + secret cleanup. No app code changes.

---

## What We Explicitly Do NOT Do

- **Self-host full Supabase stack.** We don't need their auth, storage, realtime, or API gateway. We already have Postgres + RLS + explicit DSNs + provisioner.
- **Move to managed Postgres (RDS, Supabase hosted, Neon).** Not ruled out long-term, but not required to solve the current gaps. If we do, P0-P2 still apply (backups become provider-managed, pooler becomes provider PgBouncer).
- **Change the RLS model.** The dual-role architecture (`app_user` + `app_service`) is correct and stays.

---

## Related Documents

- [DATABASE_RLS_SPEC.md](DATABASE_RLS_SPEC.md) — RLS design, P1 credential rotation item
- [DATABASE_URL_ALIGNMENT_SPEC.md](DATABASE_URL_ALIGNMENT_SPEC.md) — DSN-only end state roadmap
- [DATABASES.md](DATABASES.md) — Migration architecture, two-image strategy
- [INFRASTRUCTURE_SETUP.md](../platform/runbooks/INFRASTRUCTURE_SETUP.md) — Secret generation runbook

---

**Last Updated**: 2026-02-06
**Status**: Initiative (not started). P0 backups are the critical path.
