#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# verify-deployment.sh — Post-deploy validation: health polls + smoke tests.
# Called by the verify job in promote-and-deploy.yml.
# Dependency reachability is already confirmed by deploy-infra.sh (Step 6.8).
#
# Usage: verify-deployment.sh
# Env:   DOMAIN (required), DEPLOY_ENVIRONMENT (preferred; selects catalog
#        public_url entry per bug.5002), VM_HOST (optional, for diagnostics
#        on failure), K8S_NAMESPACE (optional), SSH_DEPLOY_KEY (optional)

set -euo pipefail

DOMAIN="${DOMAIN:?DOMAIN is required}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-30}"
SLEEP="${SLEEP:-15}"
# bug.5002 — DEPLOY_ENV picks the catalog public_url key. Callers
# (promote-and-deploy.yml) export DEPLOY_ENVIRONMENT; accept either,
# fall back to the legacy URL builder when neither is set.
DEPLOY_ENV="${DEPLOY_ENV:-${OVERLAY_ENV:-${DEPLOY_ENVIRONMENT:-}}}"

_verify_deployment_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/image-tags.sh
. "${_verify_deployment_dir}/lib/image-tags.sh"

# Legacy URL builder kept as fallback for laptop CLI runs and pre-migration
# catalogs that don't declare public_url yet.
if [[ "$DOMAIN" == *.*.* ]]; then
  NODE_JOIN="-"
else
  NODE_JOIN="."
fi

# Hostname convention: catalog-first (bug.5002), else legacy
# operator → DOMAIN / others → ${node}${NODE_JOIN}${DOMAIN}.
url_for_node() {
  local node="$1" catalog_url=""
  if [ -n "$DEPLOY_ENV" ]; then
    catalog_url=$(public_url_for_target "$DEPLOY_ENV" "$node" 2>/dev/null || true)
  fi
  if [ -n "$catalog_url" ]; then
    printf '%s' "$catalog_url"
  elif [ "$node" = "operator" ]; then
    printf 'https://%s' "$DOMAIN"
  else
    printf 'https://%s%s%s' "$node" "$NODE_JOIN" "$DOMAIN"
  fi
}

# ── Health polls ─────────────────────────────────────────────────────────────

poll_health() {
  local name="$1"
  local url="$2"
  local attempt=1

  echo "Polling $name at $url/readyz ..."
  while [ $attempt -le $MAX_ATTEMPTS ]; do
    STATUS=$(curl -sk -o /dev/null -w '%{http_code}' "$url/readyz" 2>/dev/null || echo "000")
    if [ "$STATUS" = "200" ]; then
      echo "✅ $name healthy (attempt $attempt)"
      return 0
    fi
    echo "  $name: HTTP $STATUS (attempt $attempt/$MAX_ATTEMPTS)"
    sleep "$SLEEP"
    attempt=$((attempt + 1))
  done
  echo "❌ $name failed health check after $MAX_ATTEMPTS attempts"
  return 1
}

# Node-app list comes from infra/catalog (CATALOG_IS_SSOT, docs/spec/ci-cd.md
# axiom 16). Adding/removing a node in catalog updates the health-poll set
# automatically. Replaces a previously-hardcoded operator/poly/resy iteration.
declare -A POLL_PIDS=()
URLS=()
for node in "${NODE_TARGETS[@]}"; do
  url=$(url_for_node "$node")
  URLS+=("${node}=${url}")
  poll_health "$node" "$url" &
  POLL_PIDS[$node]=$!
done

FAILED=0
for node in "${!POLL_PIDS[@]}"; do
  wait "${POLL_PIDS[$node]}" || FAILED=1
done

if [ $FAILED -ne 0 ]; then
  echo "❌ One or more nodes failed health checks"
  exit 1
fi
echo "✅ All nodes healthy"

# ── Smoke tests ──────────────────────────────────────────────────────────────

for entry in "${URLS[@]}"; do
  url="${entry#*=}"
  BODY=$(curl -sk "$url/livez" 2>/dev/null)
  echo "$url/livez → $BODY"
  if ! echo "$BODY" | grep -q '"status"'; then
    echo "❌ $url/livez did not return expected JSON"
    exit 1
  fi
done
echo "✅ Smoke tests passed"
