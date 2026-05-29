#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# Mint a per-env read-only Grafana child service account + token from an
# operator-pasted parent SA token, via the Grafana stack HTTP API. Idempotent
# (find-or-create by name). Implements work/handoffs/handoff-grafana-auto-mint.md
# + docs/design/observability-creds-shared.md.
#
# Inputs (env):
#   GRAFANA_PARENT_SA_TOKEN  glsa_* stack SA token with serviceaccounts:write
#                            + serviceaccounts.tokens:write scopes
#   GRAFANA_URL              Grafana stack URL (e.g. https://<stack>.grafana.net)
#   DEPLOY_ENV               env name (candidate-a | preview | production | ...)
#   FORK_SLUG                fork slug for SA naming
#   REPO_ROOT                absolute path to repo root (for artifact write)
#
# Output:
#   .local/${DEPLOY_ENV}-grafana-sa-token.json  (operator-facing snapshot)
#   stdout: KEY=VALUE pairs (the wrapper sources these to seed_kv to _shared):
#     GRAFANA_SERVICE_ACCOUNT_TOKEN=<glsa_...>
#     GRAFANA_URL=<https://...>
#
# Graceful skip: if GRAFANA_PARENT_SA_TOKEN or GRAFANA_URL is unset, log + exit 0
# with no artifact + no stdout. Per design invariant GRAFANA_AUTOMINT_GRACEFUL_SKIP.

set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log_info() { echo -e "${GREEN}[grafana-mint]${NC} $1" >&2; }
log_warn() { echo -e "${YELLOW}[grafana-mint]${NC} $1" >&2; }
log_error() { echo -e "${RED}[grafana-mint]${NC} $1" >&2; }

: "${DEPLOY_ENV:?DEPLOY_ENV not set}"
: "${FORK_SLUG:?FORK_SLUG not set}"
: "${REPO_ROOT:?REPO_ROOT not set}"

ARTIFACT="$REPO_ROOT/.local/${DEPLOY_ENV}-grafana-sa-token.json"
SA_NAME="${FORK_SLUG}-${DEPLOY_ENV}-validator"

# ─── Graceful skip ────────────────────────────────────────────────────
if [[ -z "${GRAFANA_PARENT_SA_TOKEN:-}" || -z "${GRAFANA_URL:-}" ]]; then
  log_info "GRAFANA_PARENT_SA_TOKEN or GRAFANA_URL unset — skipping (scorecard row 5 stays 🟡)"
  exit 0
fi

# ─── Preflight: parent MUST be glsa_, not glc_ (handoff decision binding) ─
case "$GRAFANA_PARENT_SA_TOKEN" in
  glc_*)
    log_error "GRAFANA_PARENT_SA_TOKEN is a Grafana Cloud access-policy token (glc_)."
    log_error "The Grafana instance HTTP API requires a service-account token (glsa_)."
    log_error "Mint at: $GRAFANA_URL/org/serviceaccounts → New service account → Admin role → Add token."
    exit 1
    ;;
  glsa_*) : ;;
  *)
    log_error "GRAFANA_PARENT_SA_TOKEN does not start with glsa_ — refusing."
    exit 1
    ;;
esac

GRAFANA_URL="${GRAFANA_URL%/}"

mkdir -p "$REPO_ROOT/.local"

# NB: bash runs each pipe stage in a subshell, so `api_get ... | split_body_code`
# would set CODE/BODY in the subshell and never reach the parent — `set -u`
# then trips on the next "$CODE" read. We use command substitution into a
# single var and split with parameter expansion to keep state in this shell.
api_call() {
  # api_call <method> <path> [<json-body>]
  # Echoes the response body + a trailing line with the HTTP status. Caller
  # splits via the SPLIT_RESP helper below.
  local method="$1" path="$2" body="${3:-}"
  if [[ "$method" == "GET" ]]; then
    curl -sS -w "\n%{http_code}" \
      -H "Authorization: Bearer $GRAFANA_PARENT_SA_TOKEN" \
      "$GRAFANA_URL$path"
  else
    curl -sS -w "\n%{http_code}" -X "$method" \
      -H "Authorization: Bearer $GRAFANA_PARENT_SA_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$body" "$GRAFANA_URL$path"
  fi
}

# SPLIT_RESP <resp-var> — reads $resp-var and sets CODE + BODY in caller scope.
# Avoids the function-piped-via-stdin pattern that hides state in a subshell.
SPLIT_RESP() {
  local resp="$1"
  CODE="${resp##*$'\n'}"
  BODY="${resp%$'\n'*}"
}

# ── 1. Find existing SA by name (idempotency) ─────────────────────────
log_info "looking up SA name=$SA_NAME at $GRAFANA_URL"
RESP=$(api_call GET "/api/serviceaccounts/search?query=$SA_NAME")
SPLIT_RESP "$RESP"
if [[ "$CODE" != "200" ]]; then
  log_error "SA search HTTP $CODE — body: $BODY"
  exit 1
fi
# /search returns {totalCount, serviceAccounts:[{id,name,...}]}. Match exact name —
# `query=` is substring match, so we filter by jq to avoid false positives.
SA_ID=$(echo "$BODY" | jq -r --arg n "$SA_NAME" '.serviceAccounts[]? | select(.name == $n) | .id' | head -1)

if [[ -z "$SA_ID" || "$SA_ID" == "null" ]]; then
  log_info "creating SA name=$SA_NAME role=Viewer"
  RESP=$(api_call POST "/api/serviceaccounts" \
    "$(jq -n --arg n "$SA_NAME" '{name:$n, role:"Viewer", isDisabled:false}')")
  SPLIT_RESP "$RESP"
  case "$CODE" in
    200|201)
      SA_ID=$(echo "$BODY" | jq -r '.id')
      ;;
    409)
      # Race with a concurrent run — re-search and take the existing one.
      log_warn "409 on create — re-searching"
      RESP=$(api_call GET "/api/serviceaccounts/search?query=$SA_NAME")
      SPLIT_RESP "$RESP"
      [[ "$CODE" == "200" ]] || { log_error "re-search HTTP $CODE"; exit 1; }
      SA_ID=$(echo "$BODY" | jq -r --arg n "$SA_NAME" '.serviceAccounts[]? | select(.name == $n) | .id' | head -1)
      ;;
    *)
      log_error "SA create HTTP $CODE: $BODY"
      exit 1
      ;;
  esac
fi
[[ -n "$SA_ID" && "$SA_ID" != "null" ]] || { log_error "could not resolve SA id"; exit 1; }
log_info "SA id=$SA_ID"

# ── 2. Mint a fresh token ─────────────────────────────────────────────
TS=$(date -u +%s)
RAND4=$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 4 || echo "xxxx")
TOKEN_NAME="${DEPLOY_ENV}-bootstrap-${TS}-${RAND4}"

log_info "minting token name=$TOKEN_NAME"
RESP=$(api_call POST "/api/serviceaccounts/$SA_ID/tokens" \
  "$(jq -n --arg n "$TOKEN_NAME" '{name:$n}')")
SPLIT_RESP "$RESP"
if [[ "$CODE" != "200" && "$CODE" != "201" ]]; then
  log_error "mint token HTTP $CODE: $BODY"
  exit 1
fi
NEW_TOKEN=$(echo "$BODY" | jq -r '.key')
[[ "$NEW_TOKEN" == glsa_* ]] || { log_error "minted token does not start with glsa_"; exit 1; }

# ── 3. Write artifact (operator-facing one-shot snapshot) ────────────
MINTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
umask 077
jq -n \
  --arg url "$GRAFANA_URL" \
  --arg token "$NEW_TOKEN" \
  --arg sa_name "$SA_NAME" \
  --argjson sa_id "$SA_ID" \
  --arg token_name "$TOKEN_NAME" \
  --arg minted_at "$MINTED_AT" \
  '{url:$url, token:$token, sa_id:$sa_id, sa_name:$sa_name, token_name:$token_name, minted_at:$minted_at}' \
  > "$ARTIFACT"
chmod 600 "$ARTIFACT"
log_info "wrote artifact $ARTIFACT"

# ── 4. Emit derived KEY=VALUE pairs for the wrapper to seed_kv ───────
# Variable name matches scripts/setup-secrets.ts declaration + scripts/loki-query.sh
# + scripts/grafana-postgres-datasource.sh consumption (existing env-var contract).
printf 'GRAFANA_SERVICE_ACCOUNT_TOKEN=%s\n' "$NEW_TOKEN"
printf 'GRAFANA_URL=%s\n' "$GRAFANA_URL"
