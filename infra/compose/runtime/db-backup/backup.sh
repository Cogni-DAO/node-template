#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

set -euo pipefail

BACKUP_ROOT="${DB_BACKUP_ROOT:-/backups}"
INTERVAL_SECONDS="${DB_BACKUP_INTERVAL_SECONDS:-86400}"
RETENTION_DAYS="${DB_BACKUP_RETENTION_DAYS:-14}"
STATUS_FILE="${DB_BACKUP_STATUS_FILE:-/tmp/db-backup.last-success}"

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

log_json() {
  local level="$1" event="$2" cluster="$3" message="$4" path="${5:-}"
  printf '{"level":"%s","event":"%s","cluster":"%s","msg":"%s","path":"%s","time":"%s"}\n' \
    "$(json_escape "$level")" \
    "$(json_escape "$event")" \
    "$(json_escape "$cluster")" \
    "$(json_escape "$message")" \
    "$(json_escape "$path")" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}

require_positive_int() {
  local name="$1" value="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || [ "$value" -lt 1 ]; then
    log_json error db_backup.config "" "$name must be a positive integer"
    exit 2
  fi
}

wait_for_postgres() {
  local cluster="$1" host="$2" port="$3" user="$4"
  local deadline=$((SECONDS + 120))
  until pg_isready -h "$host" -p "$port" -U "$user" >/dev/null 2>&1; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      log_json error db_backup.unreachable "$cluster" "postgres did not become ready before timeout"
      return 1
    fi
    sleep 2
  done
}

safe_name() {
  printf '%s' "$1" | tr -c 'A-Za-z0-9_.-' '_'
}

write_manifest() {
  local dir="$1"
  (
    cd "$dir"
    find . -type f ! -name MANIFEST.sha256 -print0 | sort -z | xargs -0 sha256sum > MANIFEST.sha256
  )
}

prune_old_backups() {
  local cluster_dir="$1"
  find "$cluster_dir" -mindepth 1 -maxdepth 1 -type d -mtime +"$RETENTION_DAYS" -exec rm -rf {} +
}

backup_cluster() {
  local cluster="$1" host="$2" port="$3" user="$4" password="$5"
  local timestamp tmp_dir final_dir dbs db db_file

  export PGPASSWORD="$password"
  wait_for_postgres "$cluster" "$host" "$port" "$user"

  timestamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  tmp_dir="$BACKUP_ROOT/.${cluster}.${timestamp}.tmp"
  final_dir="$BACKUP_ROOT/${cluster}/${timestamp}"

  rm -rf "$tmp_dir"
  mkdir -p "$tmp_dir" "$BACKUP_ROOT/$cluster"

  log_json info db_backup.started "$cluster" "starting postgres backup"
  pg_dumpall -h "$host" -p "$port" -U "$user" --globals-only > "$tmp_dir/globals.sql"

  dbs="$(psql -h "$host" -p "$port" -U "$user" -d postgres -At -c "select datname from pg_database where datallowconn and not datistemplate order by datname")"
  while IFS= read -r db; do
    [ -n "$db" ] || continue
    db_file="$(safe_name "$db").dump"
    pg_dump -h "$host" -p "$port" -U "$user" -d "$db" --format=custom --file="$tmp_dir/$db_file"
  done <<< "$dbs"

  write_manifest "$tmp_dir"
  mv "$tmp_dir" "$final_dir"
  prune_old_backups "$BACKUP_ROOT/$cluster"
  log_json info db_backup.completed "$cluster" "postgres backup completed" "$final_dir"
}

run_once() {
  local failed=0

  backup_cluster app postgres 5432 "${POSTGRES_ROOT_USER:?POSTGRES_ROOT_USER is required}" "${POSTGRES_ROOT_PASSWORD:?POSTGRES_ROOT_PASSWORD is required}" || failed=1
  backup_cluster temporal temporal-postgres 5432 "${TEMPORAL_DB_USER:-temporal}" "${TEMPORAL_DB_PASSWORD:-temporal}" || failed=1

  if [ "$failed" -eq 0 ]; then
    date +%s > "$STATUS_FILE"
    log_json info db_backup.run_completed all "all postgres backups completed"
    return 0
  fi

  log_json error db_backup.run_failed all "one or more postgres backups failed"
  return 1
}

healthcheck() {
  local now last max_age
  [ -s "$STATUS_FILE" ] || exit 1
  now="$(date +%s)"
  last="$(cat "$STATUS_FILE")"
  max_age="${DB_BACKUP_MAX_AGE_SECONDS:-$((INTERVAL_SECONDS * 2 + 3600))}"
  [ "$((now - last))" -le "$max_age" ]
}

main() {
  require_positive_int DB_BACKUP_INTERVAL_SECONDS "$INTERVAL_SECONDS"
  require_positive_int DB_BACKUP_RETENTION_DAYS "$RETENTION_DAYS"
  mkdir -p "$BACKUP_ROOT"

  case "${1:-loop}" in
    once)
      run_once
      ;;
    loop)
      while true; do
        run_once || true
        sleep "$INTERVAL_SECONDS"
      done
      ;;
    health)
      healthcheck
      ;;
    *)
      echo "Usage: $0 [once|loop|health]" >&2
      exit 2
      ;;
  esac
}

main "$@"
