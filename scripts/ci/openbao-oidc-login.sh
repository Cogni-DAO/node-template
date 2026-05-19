#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# task.0284 — exchanges the job's GitHub Actions OIDC token for a short-lived
# OpenBao client token via the JWT auth method, then exports it as OPENBAO_TOKEN
# into $GITHUB_ENV for downstream steps. Documented in
# docs/spec/secrets-management.md (entry 2 — GitHub workflow).
#
# TRANSITION_SAFE: when OPENBAO_ADDR is unset (the pre-substrate-live state),
# this script writes a step-summary explainer and exits 0 without exchanging.
# Callers can wire this step in unconditionally; it activates the first time
# the operator sets the repo variable `OPENBAO_ADDR`.
#
# Required env (when activated):
#   OPENBAO_ADDR             — e.g. https://openbao.test.cognidao.org
#   OPENBAO_JWT_ROLE         — OpenBao JWT auth role name (per-workflow)
#   ACTIONS_ID_TOKEN_REQUEST_URL    — auto-injected when permissions.id-token: write
#   ACTIONS_ID_TOKEN_REQUEST_TOKEN  — auto-injected when permissions.id-token: write
#
# Side effects:
#   - Appends `OPENBAO_TOKEN=<short-lived>` to $GITHUB_ENV (if active)
#   - Appends an audit line to $GITHUB_STEP_SUMMARY

set -euo pipefail

summary_path="${GITHUB_STEP_SUMMARY:-/dev/null}"

if [[ -z "${OPENBAO_ADDR:-}" ]]; then
  echo "OPENBAO_ADDR unset — skipping OIDC exchange (TRANSITION_SAFE)." >&2
  {
    echo "### OpenBao OIDC login — skipped"
    echo
    echo "\`OPENBAO_ADDR\` is unset. This step activates the first time the"
    echo "operator sets the repo variable. Pre-substrate-live behavior."
  } >>"$summary_path"
  exit 0
fi

if [[ -z "${OPENBAO_JWT_ROLE:-}" ]]; then
  echo "::error::OPENBAO_ADDR is set but OPENBAO_JWT_ROLE is not. Per-workflow role required." >&2
  exit 1
fi

if [[ -z "${ACTIONS_ID_TOKEN_REQUEST_URL:-}" || -z "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}" ]]; then
  echo "::error::ACTIONS_ID_TOKEN_REQUEST_{URL,TOKEN} unset. Did you set 'permissions: id-token: write' on this job?" >&2
  exit 1
fi

# Fetch the GitHub OIDC token with audience=openbao (matches OpenBao's
# bound_audiences config; see docs/runbooks/openbao-bootstrap.md §oidc-auth).
oidc_resp=$(curl -sS -f \
  -H "Authorization: bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}" \
  "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=openbao")
oidc_jwt=$(jq -r '.value' <<<"$oidc_resp")

if [[ -z "$oidc_jwt" || "$oidc_jwt" == "null" ]]; then
  echo "::error::GitHub OIDC token fetch returned no .value" >&2
  exit 1
fi

# Exchange for an OpenBao token via the JWT auth method.
# Default mount path is `jwt`; override via OPENBAO_JWT_MOUNT.
mount_path="${OPENBAO_JWT_MOUNT:-jwt}"
login_resp=$(curl -sS -f \
  -H 'Content-Type: application/json' \
  --data "{\"role\":\"${OPENBAO_JWT_ROLE}\",\"jwt\":\"${oidc_jwt}\"}" \
  "${OPENBAO_ADDR%/}/v1/auth/${mount_path}/login")
token=$(jq -r '.auth.client_token // empty' <<<"$login_resp")
ttl=$(jq -r '.auth.lease_duration // empty' <<<"$login_resp")

if [[ -z "$token" ]]; then
  echo "::error::OpenBao JWT login did not return a client_token. Role: ${OPENBAO_JWT_ROLE}, mount: ${mount_path}." >&2
  exit 1
fi

# Mask the token in subsequent log output.
echo "::add-mask::${token}"
{
  echo "OPENBAO_TOKEN=${token}"
  echo "OPENBAO_TOKEN_TTL=${ttl}"
} >>"$GITHUB_ENV"

{
  echo "### OpenBao OIDC login — OK"
  echo
  echo "- Addr: \`${OPENBAO_ADDR}\`"
  echo "- Role: \`${OPENBAO_JWT_ROLE}\`"
  echo "- Mount: \`${mount_path}\`"
  echo "- TTL: \`${ttl}s\`"
} >>"$summary_path"
