#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# task.0284 — structural guardrail on External Secrets Operator scope.
# Enforces docs/spec/secrets-management.md invariants at CI time:
#
#   1. LOCATION (Invariant 2 ONE_EXTERNAL_SECRET_PER_SERVICE_ENV): every
#      ExternalSecret CRD lives at exactly
#      `infra/k8s/secrets/external-secrets/<env>/<service>/*.yaml`.
#      Catches drift like ExternalSecrets scattered into overlay dirs, or a
#      flat `<env>/foo.yaml` layout that defeats the per-service grouping.
#   2. STORE (Invariants 5 OPENBAO_IS_SINGLE_SOURCE_OF_TRUTH +
#      6 RBAC_VIA_PATH_POLICY): every ExternalSecret references
#      ClusterSecretStore "openbao-backend". Per-namespace SecretStores or
#      alternate-name stores would split the RBAC surface.
#
# ALLOWLIST below covers explicit exceptions (currently empty). Mirrors the
# shape of scripts/ci/check-image-updater-scope.sh.

set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
SANCTIONED_ROOT="infra/k8s/secrets/external-secrets"
SANCTIONED_STORE_NAME="openbao-backend"
SANCTIONED_STORE_KIND="ClusterSecretStore"
# `<root>/<env>/<service>/<filename>` — exactly two directory levels below
# the sanctioned root before the file. Tighter than a prefix check.
LOCATION_PATTERN="^${SANCTIONED_ROOT}/[^/]+/[^/]+/[^/]+\.ya?ml$"

# Files permitted to break the location invariant. Empty = none.
LOCATION_ALLOWLIST=()

# ExternalSecret CRD files permitted to reference a non-sanctioned store.
# Empty = none.
STORE_ALLOWLIST=()

is_allowed() {
  local rel="$1" entry
  shift
  for entry in "$@"; do
    [[ "$rel" == "$entry" ]] && return 0
  done
  return 1
}

# Find every ExternalSecret manifest in the repo. Match the CRD by its `kind:`
# line at the document root. grep -l returns file paths; --include limits to YAML.
mapfile -t es_files < <(
  cd "$ROOT_DIR" && \
  grep -rlE '^kind:[[:space:]]+ExternalSecret[[:space:]]*$' \
    --include='*.yaml' --include='*.yml' \
    infra/ 2>/dev/null || true
)

fail=0

# Invariant 1: LOCATION — exactly <root>/<env>/<service>/<filename>.
for rel in "${es_files[@]}"; do
  if is_allowed "$rel" "${LOCATION_ALLOWLIST[@]}"; then
    continue
  fi
  if ! [[ "$rel" =~ $LOCATION_PATTERN ]]; then
    echo "::error file=${rel}::task.0284 eso-scope: ExternalSecret path must match ${SANCTIONED_ROOT}/<env>/<service>/<filename>.yaml. Move it under that shape (one dir per env, one dir per service) or add to LOCATION_ALLOWLIST with a rationale commit." >&2
    fail=1
  fi
done

# Invariant 2: STORE.
# Extract the 5 lines following `secretStoreRef:` and assert both
# `name: openbao-backend` and `kind: ClusterSecretStore` appear there. Pure
# grep; no yq dependency. Five lines is generous: the longest legit
# secretStoreRef block we currently emit is 3 lines.
for rel in "${es_files[@]}"; do
  if is_allowed "$rel" "${STORE_ALLOWLIST[@]}"; then
    continue
  fi
  abs="$ROOT_DIR/$rel"
  block=$(grep -A 5 '^[[:space:]]*secretStoreRef:[[:space:]]*$' "$abs" || true)

  if ! grep -qE "^[[:space:]]+name:[[:space:]]+${SANCTIONED_STORE_NAME}[[:space:]]*$" <<<"$block" \
     || ! grep -qE "^[[:space:]]+kind:[[:space:]]+${SANCTIONED_STORE_KIND}[[:space:]]*$" <<<"$block"; then
    echo "::error file=${rel}::task.0284 eso-scope: secretStoreRef block does not reference {kind:${SANCTIONED_STORE_KIND}, name:${SANCTIONED_STORE_NAME}}. The cluster has one sanctioned store; add to STORE_ALLOWLIST with rationale if intentional." >&2
    echo "  found block:" >&2
    # shellcheck disable=SC2001
    sed 's/^/    /' <<<"$block" >&2
    fail=1
  fi
done

if [[ $fail -eq 1 ]]; then
  exit 1
fi

echo "task.0284 eso-scope check OK:"
echo "  scanned ${#es_files[@]} ExternalSecret file(s) under infra/"
echo "  sanctioned shape: ${SANCTIONED_ROOT}/<env>/<service>/<filename>.yaml"
echo "  sanctioned store: ${SANCTIONED_STORE_KIND}/${SANCTIONED_STORE_NAME}"
