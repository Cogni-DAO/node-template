#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# Ad-hoc Loki reader for Grafana Cloud. No MCP dependency.
# Use when the `grafana` MCP is unavailable (or from CI/one-off shells).
#
# Requires two env vars, typically sourced from a local, gitignored .env file:
#   GRAFANA_URL                      e.g. https://<org>.grafana.net/
#   GRAFANA_SERVICE_ACCOUNT_TOKEN    `glsa_…` token w/ datasource:read + logs:read
#
# Auto-sources (if env vars are missing), in this order:
#   1. $COGNI_ENV_FILE, ./.env.cogni, ./.env.canary, ./.env.local
#   2. .local/${DEPLOY_ENV:-candidate-a}-grafana-sa-token.json  (the Phase 5e
#      auto-mint artifact bundle — see fork-quickstart.md Step 6.5)
#   3. .local/*-grafana-sa-token.json  (fallback: any decrypted artifact)
#
# Usage:
#   scripts/loki-query.sh '<logql>' [minutes_back=30] [limit=200] [datasource_uid=grafanacloud-logs]
#
# Examples:
#   scripts/loki-query.sh '{env="candidate-a",service="app",pod=~"poly-node-app-.*"} | json | route="poly.wallet.connect"'
#   scripts/loki-query.sh '{env="candidate-a",service="app"} | json | level="50"' 60 50
#
# Output is the raw Loki JSON response on stdout — pipe through jq or python for parsing.

set -euo pipefail

QUERY="${1:-}"
MIN_BACK="${2:-30}"
LIMIT="${3:-200}"
DS_UID="${4:-grafanacloud-logs}"

if [[ -z "$QUERY" ]]; then
  sed -n '2,25p' "$0" >&2
  exit 2
fi

# Env fallback — source every present file in priority order. Any single file
# may hold only part of the credential set (e.g. .env.cogni has GRAFANA_URL
# while .env.<env> holds the env-scoped GRAFANA_SERVICE_ACCOUNT_TOKEN).
if [[ -z "${GRAFANA_URL:-}" || -z "${GRAFANA_SERVICE_ACCOUNT_TOKEN:-}" ]]; then
  for candidate in "${COGNI_ENV_FILE:-}" ./.env.cogni ./.env.canary ./.env.local; do
    if [[ -n "$candidate" && -f "$candidate" ]]; then
      set -a; . "$candidate"; set +a
    fi
  done
fi

# Phase 5e bootstrap-artifact fallback — if the operator decrypted the init
# artifact bundle (fork-quickstart.md Step 6.5), the auto-minted child SA
# token lives at .local/<env>-grafana-sa-token.json. Pick it up so /logs +
# /validate-candidate + ad-hoc CLI queries work out-of-the-box on a fresh
# fork. Honors DEPLOY_ENV first; falls back to any matching artifact.
if [[ -z "${GRAFANA_URL:-}" || -z "${GRAFANA_SERVICE_ACCOUNT_TOKEN:-}" ]]; then
  if command -v jq >/dev/null 2>&1; then
    shopt -s nullglob
    artifact_candidates=(".local/${DEPLOY_ENV:-candidate-a}-grafana-sa-token.json" \
                         .local/*-grafana-sa-token.json)
    shopt -u nullglob
    for f in "${artifact_candidates[@]}"; do
      [[ -r "$f" ]] || continue
      : "${GRAFANA_URL:=$(jq -r '.url // empty' "$f" 2>/dev/null)}"
      : "${GRAFANA_SERVICE_ACCOUNT_TOKEN:=$(jq -r '.token // empty' "$f" 2>/dev/null)}"
      [[ -n "${GRAFANA_URL:-}" && -n "${GRAFANA_SERVICE_ACCOUNT_TOKEN:-}" ]] && break
    done
  fi
fi

: "${GRAFANA_URL:?GRAFANA_URL not set (export it or point COGNI_ENV_FILE at an .env with it)}"
: "${GRAFANA_SERVICE_ACCOUNT_TOKEN:?GRAFANA_SERVICE_ACCOUNT_TOKEN not set (needs glsa_… with logs:read)}"

LOKI_BASE="${GRAFANA_URL%/}/api/datasources/proxy/uid/${DS_UID}/loki/api/v1"
START=$(( ( $(date -u +%s) - MIN_BACK * 60 ) * 1000000000 ))
END=$(date -u +%s)000000000

curl -sS -G "$LOKI_BASE/query_range" \
  -H "Authorization: Bearer ${GRAFANA_SERVICE_ACCOUNT_TOKEN}" \
  --data-urlencode "query=$QUERY" \
  --data-urlencode "start=$START" \
  --data-urlencode "end=$END" \
  --data-urlencode "limit=$LIMIT" \
  --data-urlencode "direction=backward"
