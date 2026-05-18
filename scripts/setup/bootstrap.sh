#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# scripts/setup/bootstrap.sh — agentic fork bootstrap entry point.
#
# Spec:  docs/spec/agentic-fork-bootstrap.md
# Usage: pnpm bootstrap
#
# Two-phase, idempotent:
#   • .env.bootstrap missing → copy template, print instructions, exit 0
#   • .env.bootstrap present → validate + provision end-to-end

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BOOT_FILE="$REPO_ROOT/.env.bootstrap"
BOOT_TEMPLATE="$REPO_ROOT/.env.bootstrap.example"

# shellcheck source=./scripts/setup/lib/fork-identity.sh
source "$SCRIPT_DIR/lib/fork-identity.sh"

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; CYAN=$'\033[0;36m'; BOLD=$'\033[1m'; NC=$'\033[0m'
log()   { echo -e "${GREEN}[bootstrap]${NC} $*"; }
warn()  { echo -e "${YELLOW}[bootstrap]${NC} $*"; }
err()   { echo -e "${RED}[bootstrap]${NC} $*" >&2; }
step()  { echo -e "\n${CYAN}${BOLD}▶ $*${NC}"; }

# ── Phase 0: template-or-execute gate ────────────────────────────────────────
# First run: create .env.bootstrap, open it in $EDITOR, then exit so the human
# can paste in 5 values and re-run. One command, two passes — no checklists.
if [[ ! -f "$BOOT_FILE" ]]; then
  cp "$BOOT_TEMPLATE" "$BOOT_FILE"
  chmod 600 "$BOOT_FILE"
  cat <<EOF

${GREEN}${BOLD}Created .env.bootstrap.${NC}

Fill in the 5 sections (each has the mint URL right above it),
save & close the editor, then run ${BOLD}pnpm bootstrap${NC} again.

EOF
  # P1 — Skip editor open under non-TTY (agent / CI / sandbox shell). nano
  # in particular "opens" then immediately exits in non-TTY mode, the file
  # stays empty, and the human only discovers it on the re-run. Just tell
  # the caller to open the file themselves; the next `pnpm bootstrap` will
  # pick up edits whenever they're saved.
  if [[ ! -t 0 ]]; then
    warn "Non-TTY shell detected (likely agent/CI) — not opening an editor."
    log  "Edit ${BOLD}${BOOT_FILE}${NC} in your real editor, save, then run ${BOLD}pnpm bootstrap${NC} again."
    exit 0
  fi
  # Open in the human's editor of choice. Falls back through common defaults.
  EDITOR_CMD="${VISUAL:-${EDITOR:-}}"
  if [[ -z "$EDITOR_CMD" ]]; then
    for c in code cursor nano vim vi open; do
      command -v "$c" >/dev/null 2>&1 && EDITOR_CMD="$c" && break
    done
  fi
  if [[ -n "$EDITOR_CMD" ]]; then
    log "Opening with: ${EDITOR_CMD}"
    # `code`/`cursor` need --wait to block until the file is saved-and-closed.
    case "$EDITOR_CMD" in
      code|cursor) "$EDITOR_CMD" --wait "$BOOT_FILE" || true ;;
      open)        "$EDITOR_CMD" -e "$BOOT_FILE" || true ;;
      *)           "$EDITOR_CMD" "$BOOT_FILE" || true ;;
    esac
  else
    warn "No editor found. Open .env.bootstrap manually in your editor."
  fi
  echo ""
  log "When ready, run: ${BOLD}pnpm bootstrap${NC}"
  exit 0
fi

# ── Ingest .env.bootstrap ────────────────────────────────────────────────────
chmod 600 "$BOOT_FILE" 2>/dev/null || true
if ! git -C "$REPO_ROOT" check-ignore "$BOOT_FILE" >/dev/null 2>&1; then
  err ".env.bootstrap is NOT gitignored. Refusing to read."
  err "Add .env.bootstrap to .gitignore (or confirm .env* covers it) and re-run."
  exit 2
fi

# shellcheck disable=SC1090
set -a; source "$BOOT_FILE"; set +a

DEPLOY_ENV="${DEPLOY_ENV:-candidate-a}"
log "Target environment: ${BOLD}${DEPLOY_ENV}${NC}"

# ── Phase 1: validate required inputs + prerequisites ────────────────────────
step "Phase 1 · Validate inputs + tooling"

REQUIRED=(
  CHERRY_AUTH_TOKEN CHERRY_PROJECT_ID
  CLOUDFLARE_API_TOKEN CLOUDFLARE_ZONE_ID
  GITHUB_ADMIN_PAT GITHUB_ADMIN_USERNAME
  OPENROUTER_API_KEY
)
MISSING=()
for v in "${REQUIRED[@]}"; do
  [[ -z "${!v:-}" ]] && MISSING+=("$v")
done
if [[ ${#MISSING[@]} -gt 0 ]]; then
  err "Missing required values in .env.bootstrap:"
  printf '  - %s\n' "${MISSING[@]}" >&2
  exit 2
fi

# Fork domain comes from infra/fork.yaml::domain.root, not .env.bootstrap
# (B2 + P5: single SSOT for fork identity). DOMAIN per env is derived
# downstream by provision-env-vm.sh from the convention test/preview/"".
FORK_ROOT=$(fork_identity_root "$REPO_ROOT" || echo "")
if [[ -z "$FORK_ROOT" || "$FORK_ROOT" == "null" ]]; then
  err "infra/fork.yaml::domain.root is missing or empty."
  err "Edit ${BOLD}infra/fork.yaml${NC} to set the Cloudflare zone you own (e.g. opencompany.cc), commit, then re-run."
  exit 2
fi
log "Fork domain root: ${BOLD}${FORK_ROOT}${NC} (from infra/fork.yaml)"

FORK_SLUG=$(fork_identity_slug "$REPO_ROOT")
if [[ -z "$FORK_SLUG" ]]; then
  err "Unable to derive fork slug from infra/fork.yaml::fork.slug or git origin."
  exit 2
fi
log "Fork infra slug: ${BOLD}${FORK_SLUG}${NC} (used for VM DNS aliases)"

# Derive DOMAIN from FORK_ROOT + DEPLOY_ENV using the same convention as
# provision-env-vm.sh. Single source (fork.yaml.root), two consumers
# (bootstrap.sh writes secrets here; provision-env-vm.sh re-derives the
# same value). Both compute the same answer — no drift risk because the
# convention is shared.
DOMAIN=$(domain_for_env "$DEPLOY_ENV" "$FORK_ROOT") || { err "Unsupported DEPLOY_ENV: $DEPLOY_ENV"; exit 2; }
VM_DNS_HOST=$(vm_host_for_env "$DEPLOY_ENV" "$FORK_ROOT" "$FORK_SLUG")
log "Derived DOMAIN: ${BOLD}${DOMAIN}${NC} (for $DEPLOY_ENV)"
log "Derived VM DNS host: ${BOLD}${VM_DNS_HOST}${NC}"

# Installer hints reference scripts/bootstrap/install/install-<tool>.sh
# instead of brew/apt — these are the canonical wrappers for this repo and
# handle platform differences (don't reinvent the wheel).
declare -A INSTALLER=(
  [pnpm]="scripts/bootstrap/install/install-pnpm.sh"
  [tofu]="scripts/bootstrap/install/install-tofu.sh"
  [yq]="scripts/bootstrap/install/install-yq.sh"
)
for tool in gh tofu ssh-keygen age-keygen openssl curl jq yq pnpm; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    err "Required CLI not found: $tool"
    if [[ -n "${INSTALLER[$tool]:-}" ]]; then
      err "  Install: bash ${INSTALLER[$tool]}"
    else
      err "  Install via your OS package manager (brew/apt). Re-run when ready."
    fi
    exit 2
  fi
done

# Detect repo from origin (works for forks)
ORIGIN_URL=$(git -C "$REPO_ROOT" remote get-url origin)
GH_REPO=$(echo "$ORIGIN_URL" | sed -E 's#.*github.com[:/]([^/]+/[^/.]+).*#\1#')
log "GitHub repo: ${BOLD}${GH_REPO}${NC}"

# Refuse to run inside the upstream template. Bootstrap mutates secrets,
# environments, and deploy branches — it must target a fork the human owns.
if [[ "$GH_REPO" == "Cogni-DAO/node-template" || "$GH_REPO" == "Cogni-DAO/cogni" ]]; then
  err "origin points at the upstream template (${GH_REPO}). Bootstrap must run inside your fork."
  err "Fork first: see docs/runbooks/fork-quickstart.md"
  exit 2
fi

export GH_TOKEN="$GITHUB_ADMIN_PAT"

# A3 — Validate GITHUB_ADMIN_USERNAME matches the PAT's actual login.
# Canary tripped on `i_am_coco` (underscore) vs `i-am-coco` (hyphen);
# GitHub usernames disallow underscores so this would otherwise 404 the
# admin-role check below with a misleading "user not found" message.
PAT_LOGIN=$(gh api user --jq .login 2>/dev/null || echo "")
if [[ -z "$PAT_LOGIN" ]]; then
  err "GITHUB_ADMIN_PAT failed to authenticate (gh api user returned empty)."
  err "Mint a fresh PAT and update .env.bootstrap."
  exit 2
fi
if [[ "$PAT_LOGIN" != "$GITHUB_ADMIN_USERNAME" ]]; then
  err "GITHUB_ADMIN_USERNAME='${GITHUB_ADMIN_USERNAME}' does not match the PAT's login '${PAT_LOGIN}'."
  err "GitHub usernames disallow underscores — did you mistype? Use ${BOLD}${PAT_LOGIN}${NC} in .env.bootstrap."
  exit 2
fi

# Admin-role check at ingest (spec §Validating Admin role).
PERM=$(gh api "repos/${GH_REPO}/collaborators/${GITHUB_ADMIN_USERNAME}/permission" \
       --jq '.permission' 2>/dev/null || echo "")
if [[ "$PERM" != "admin" ]]; then
  err "GitHub user '${GITHUB_ADMIN_USERNAME}' lacks Admin role on ${GH_REPO}."
  err "Got: '${PERM:-<unable to read>}'. Required: 'admin'."
  err "Fix: GitHub → repo Settings → Collaborators and teams → Add ${GITHUB_ADMIN_USERNAME} as Admin."
  exit 2
fi
log "Admin role verified for ${GITHUB_ADMIN_USERNAME}"

# B1 fail-fast — confirm push access on origin BEFORE spending money on a
# Cherry VM. Canary's auto-flight died at Phase 4c with 'fatal: 403' after
# a VM was already billed because origin pointed at the upstream template
# the bot couldn't write to. (Admin role implies push, but checking
# explicitly catches token-scope mismatches that don't surface in role
# checks alone.)
CAN_PUSH=$(gh api "repos/${GH_REPO}" --jq '.permissions.push // false' 2>/dev/null || echo "false")
if [[ "$CAN_PUSH" != "true" ]]; then
  err "GITHUB_ADMIN_PAT lacks push access on ${GH_REPO} (got permissions.push=${CAN_PUSH})."
  err "This would fail Phase 4c (env-state push) AFTER the Cherry VM is already billed."
  err "Re-mint the PAT with Contents:Write on this repo, then re-run."
  exit 2
fi
log "Push access verified — bootstrap will not strand a billed VM at Phase 4c."

# Cloudflare zone reachability
ZONE_OK=$(curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}" \
  | jq -r '.success // false')
[[ "$ZONE_OK" == "true" ]] || { err "Cloudflare zone ${CLOUDFLARE_ZONE_ID} unreachable with the provided token."; exit 2; }
log "Cloudflare zone reachable"

# Cherry token validation (use /v1/teams, not /v1/regions — see node-setup SKILL)
CHERRY_OK=$(curl -sS -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $CHERRY_AUTH_TOKEN" "https://api.cherryservers.com/v1/teams")
[[ "$CHERRY_OK" == "200" ]] || { err "Cherry token rejected (HTTP $CHERRY_OK)"; exit 2; }
log "Cherry token verified"

# ── Phase 2: generate agent secrets + write .env.${DEPLOY_ENV} ───────────────
step "Phase 2 · Generate agent secrets"

ENV_FILE="$REPO_ROOT/.env.${DEPLOY_ENV}"
mkdir -p "$REPO_ROOT/.local"

rand64() { openssl rand -base64 "${1:-32}" | tr -d '\n='; }
randHex() { openssl rand -hex "${1:-32}"; }

# Per-env DB names + users (matches existing convention in setup-secrets.ts)
APP_DB_NAME="cogni_operator"
APP_DB_USER="app_user"
APP_DB_SERVICE_USER="app_service"
APP_DB_READONLY_USER="app_readonly"
TEMPORAL_DB_USER="temporal"

# Generate (or reuse) all openssl-rand values. ENV_FILE is the source of truth
# so re-runs stay idempotent (reuses prior values; only fresh ones are minted).
declare -A GEN=()
if [[ -f "$ENV_FILE" ]]; then
  log "Reusing existing $ENV_FILE (idempotent re-run)"
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
fi
declare_or_gen() {
  local name="$1" generator="$2"
  if [[ -n "${!name:-}" ]]; then GEN[$name]="${!name}"; return; fi
  GEN[$name]="$($generator)"
}
declare_or_gen AUTH_SECRET                "rand64 32"
declare_or_gen LITELLM_MASTER_KEY         "echo sk-cogni-$(randHex 24)"
declare_or_gen OPENCLAW_GATEWAY_TOKEN     "rand64 32"
declare_or_gen SCHEDULER_API_TOKEN        "rand64 32"
declare_or_gen BILLING_INGEST_TOKEN       "rand64 32"
declare_or_gen INTERNAL_OPS_TOKEN         "rand64 32"
declare_or_gen METRICS_TOKEN              "rand64 32"
declare_or_gen GH_WEBHOOK_SECRET          "randHex 32"
declare_or_gen POSTGRES_ROOT_PASSWORD     "randHex 32"
declare_or_gen APP_DB_PASSWORD            "randHex 32"
declare_or_gen APP_DB_SERVICE_PASSWORD    "randHex 32"
declare_or_gen APP_DB_READONLY_PASSWORD   "randHex 32"
declare_or_gen TEMPORAL_DB_PASSWORD       "randHex 32"
declare_or_gen OPENCLAW_GITHUB_RW_TOKEN   "echo $GITHUB_ADMIN_PAT"  # v1: reuse admin PAT
declare_or_gen CONNECTIONS_ENCRYPTION_KEY "randHex 32"
declare_or_gen POLY_WALLET_AEAD_KEY_HEX   "randHex 32"
POLY_WALLET_AEAD_KEY_ID="${POLY_WALLET_AEAD_KEY_ID:-v1}"

# Write .env.${DEPLOY_ENV} — provision-env-vm.sh reads this
cat > "$ENV_FILE" <<EOF
# Auto-generated by scripts/setup/bootstrap.sh for ${DEPLOY_ENV}. Do not commit.
APP_DB_NAME=${APP_DB_NAME}
APP_DB_USER=${APP_DB_USER}
APP_DB_SERVICE_USER=${APP_DB_SERVICE_USER}
APP_DB_READONLY_USER=${APP_DB_READONLY_USER}
TEMPORAL_DB_USER=${TEMPORAL_DB_USER}
POSTGRES_ROOT_USER=postgres
POSTGRES_ROOT_PASSWORD=${GEN[POSTGRES_ROOT_PASSWORD]}
APP_DB_PASSWORD=${GEN[APP_DB_PASSWORD]}
APP_DB_SERVICE_PASSWORD=${GEN[APP_DB_SERVICE_PASSWORD]}
APP_DB_READONLY_PASSWORD=${GEN[APP_DB_READONLY_PASSWORD]}
TEMPORAL_DB_PASSWORD=${GEN[TEMPORAL_DB_PASSWORD]}
AUTH_SECRET=${GEN[AUTH_SECRET]}
LITELLM_MASTER_KEY=${GEN[LITELLM_MASTER_KEY]}
OPENCLAW_GATEWAY_TOKEN=${GEN[OPENCLAW_GATEWAY_TOKEN]}
OPENCLAW_GITHUB_RW_TOKEN=${GEN[OPENCLAW_GITHUB_RW_TOKEN]}
SCHEDULER_API_TOKEN=${GEN[SCHEDULER_API_TOKEN]}
BILLING_INGEST_TOKEN=${GEN[BILLING_INGEST_TOKEN]}
INTERNAL_OPS_TOKEN=${GEN[INTERNAL_OPS_TOKEN]}
METRICS_TOKEN=${GEN[METRICS_TOKEN]}
GH_WEBHOOK_SECRET=${GEN[GH_WEBHOOK_SECRET]}
CONNECTIONS_ENCRYPTION_KEY=${GEN[CONNECTIONS_ENCRYPTION_KEY]}
POLY_WALLET_AEAD_KEY_HEX=${GEN[POLY_WALLET_AEAD_KEY_HEX]}
POLY_WALLET_AEAD_KEY_ID=${POLY_WALLET_AEAD_KEY_ID}
EOF
chmod 600 "$ENV_FILE"
log "Wrote $ENV_FILE"

# Mirror to .env.operator for provision-env-vm.sh (which reads that path)
cat > "$REPO_ROOT/.env.operator" <<EOF
CHERRY_AUTH_TOKEN=${CHERRY_AUTH_TOKEN}
CHERRY_PROJECT_ID=${CHERRY_PROJECT_ID}
CLOUDFLARE_API_TOKEN=${CLOUDFLARE_API_TOKEN}
CLOUDFLARE_ZONE_ID=${CLOUDFLARE_ZONE_ID}
OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
GHCR_DEPLOY_TOKEN=${GITHUB_ADMIN_PAT}
GHCR_DEPLOY_USERNAME=${GITHUB_ADMIN_USERNAME}
DOMAIN=${DOMAIN}
EOF
chmod 600 "$REPO_ROOT/.env.operator"
log "Wrote .env.operator (consumed by provision-env-vm.sh)"

# ── Phase 3: GitHub environment + secret PUTs ────────────────────────────────
step "Phase 3 · GitHub env + secrets"

# Create the GitHub environment (idempotent — PUT)
gh api -X PUT "repos/${GH_REPO}/environments/${DEPLOY_ENV}" >/dev/null
log "Environment ${DEPLOY_ENV} present"

set_env_secret() {
  local name="$1" val="$2"
  [[ -z "$val" ]] && return 0
  gh secret set "$name" --repo "$GH_REPO" --env "$DEPLOY_ENV" --body "$val" >/dev/null
  echo "    · $name"
}
set_repo_secret() {
  local name="$1" val="$2"
  [[ -z "$val" ]] && return 0
  gh secret set "$name" --repo "$GH_REPO" --body "$val" >/dev/null
  echo "    · $name (repo)"
}
set_repo_var() {
  local name="$1" val="$2"
  [[ -z "$val" ]] && return 0
  gh variable set "$name" --repo "$GH_REPO" --body "$val" >/dev/null 2>&1 || \
    gh variable set "$name" --repo "$GH_REPO" --env "$DEPLOY_ENV" --body "$val" >/dev/null
  echo "    · $name (var)"
}

log "Repo-level secrets:"
set_repo_secret CHERRY_AUTH_TOKEN          "$CHERRY_AUTH_TOKEN"
set_repo_secret GHCR_DEPLOY_TOKEN          "$GITHUB_ADMIN_PAT"
set_repo_secret ACTIONS_AUTOMATION_BOT_PAT "$GITHUB_ADMIN_PAT"
set_repo_secret GIT_READ_TOKEN             "$GITHUB_ADMIN_PAT"

log "Env-level agent-generated secrets:"
for k in AUTH_SECRET LITELLM_MASTER_KEY OPENCLAW_GATEWAY_TOKEN OPENCLAW_GITHUB_RW_TOKEN \
         SCHEDULER_API_TOKEN BILLING_INGEST_TOKEN INTERNAL_OPS_TOKEN METRICS_TOKEN \
         GH_WEBHOOK_SECRET CONNECTIONS_ENCRYPTION_KEY \
         POLY_WALLET_AEAD_KEY_HEX POSTGRES_ROOT_PASSWORD \
         APP_DB_PASSWORD APP_DB_SERVICE_PASSWORD APP_DB_READONLY_PASSWORD \
         TEMPORAL_DB_PASSWORD; do
  set_env_secret "$k" "${GEN[$k]:-${!k:-}}"
done
set_env_secret APP_DB_NAME              "$APP_DB_NAME"
set_env_secret APP_DB_USER              "$APP_DB_USER"
set_env_secret APP_DB_SERVICE_USER      "$APP_DB_SERVICE_USER"
set_env_secret APP_DB_READONLY_USER     "$APP_DB_READONLY_USER"
set_env_secret TEMPORAL_DB_USER         "$TEMPORAL_DB_USER"
set_env_secret POSTGRES_ROOT_USER       "postgres"
set_env_secret POLY_WALLET_AEAD_KEY_ID  "$POLY_WALLET_AEAD_KEY_ID"

log "Env-level human pass-throughs:"
set_env_secret OPENROUTER_API_KEY           "$OPENROUTER_API_KEY"
set_env_secret DOMAIN                       "$DOMAIN"
set_repo_var   DOMAIN                       "$DOMAIN"
set_env_secret GRAFANA_CLOUD_LOKI_URL       "${GRAFANA_CLOUD_LOKI_URL:-}"
set_env_secret GRAFANA_CLOUD_LOKI_USER      "${GRAFANA_CLOUD_LOKI_USER:-}"
set_env_secret GRAFANA_CLOUD_LOKI_API_KEY   "${GRAFANA_CLOUD_LOKI_API_KEY:-}"
set_env_secret PROMETHEUS_REMOTE_WRITE_URL  "${PROMETHEUS_REMOTE_WRITE_URL:-}"
set_env_secret PROMETHEUS_USERNAME          "${PROMETHEUS_USERNAME:-}"
set_env_secret PROMETHEUS_PASSWORD          "${PROMETHEUS_PASSWORD:-}"

# DSNs — construct from parts. provision-env-vm.sh re-derives with VM IP after
# tofu apply; this pre-set is for env validation (server-env.ts requires them
# to exist at deploy time). They'll be re-set with the real VM IP in Phase 4.
set_env_secret DATABASE_URL          "postgresql://${APP_DB_USER}:${GEN[APP_DB_PASSWORD]}@127.0.0.1:5432/${APP_DB_NAME}?sslmode=disable"
set_env_secret DATABASE_SERVICE_URL  "postgresql://${APP_DB_SERVICE_USER}:${GEN[APP_DB_SERVICE_PASSWORD]}@127.0.0.1:5432/${APP_DB_NAME}?sslmode=disable"

# ── Phase 4: provision VM + DNS + deploy branch (Steps A+B+partial-D) ────────
step "Phase 4 · Provision VM + DNS via provision-env-vm.sh"
log "Delegating to scripts/setup/provision-env-vm.sh (already validated)"

# Pass DOMAIN through so candidate-a inherits the FQDN we want
export DOMAIN
bash "$REPO_ROOT/scripts/setup/provision-env-vm.sh" "$DEPLOY_ENV" --yes

# Post-provision: re-set DATABASE_URLs with real IP and VM_HOST with DNS alias
VM_IP=$(cat "$REPO_ROOT/.local/${DEPLOY_ENV}-vm-ip")
log "VM_IP=${VM_IP}; updating DATABASE_URLs and VM_HOST=${VM_DNS_HOST} in GitHub env"
set_env_secret VM_HOST "$VM_DNS_HOST"
set_env_secret DATABASE_URL         "postgresql://${APP_DB_USER}:${GEN[APP_DB_PASSWORD]}@${VM_IP}:5432/${APP_DB_NAME}?sslmode=disable"
set_env_secret DATABASE_SERVICE_URL "postgresql://${APP_DB_SERVICE_USER}:${GEN[APP_DB_SERVICE_PASSWORD]}@${VM_IP}:5432/${APP_DB_NAME}?sslmode=disable"

# SSH key + age key → GitHub env (provision-env-vm.sh wrote them to .local/)
set_env_secret SSH_DEPLOY_KEY "$(cat "$REPO_ROOT/.local/${DEPLOY_ENV}-vm-key")"

# ── Phase 5: trigger deploy + watch ──────────────────────────────────────────
step "Phase 5 · Dispatch promote-and-deploy + watch"
gh workflow run promote-and-deploy.yml \
  --repo "$GH_REPO" \
  --ref main \
  -f environment="$DEPLOY_ENV" >/dev/null
log "Workflow dispatched. Tailing latest run…"
sleep 4
RUN_ID=$(gh run list --repo "$GH_REPO" --workflow promote-and-deploy.yml --limit 1 --json databaseId --jq '.[0].databaseId')
log "Run ID: ${RUN_ID}"
gh run watch "$RUN_ID" --repo "$GH_REPO" --exit-status

# ── Phase 6: smoke check ─────────────────────────────────────────────────────
step "Phase 6 · Smoke /readyz"
sleep 5
if curl -fsS -o /dev/null -w "%{http_code}" "https://${DOMAIN}/readyz" | grep -q 200; then
  log "${GREEN}${BOLD}✓ ${DOMAIN} /readyz returned 200${NC}"
else
  warn "${DOMAIN} /readyz did not return 200 yet. DNS may still be propagating or Caddy is still obtaining its cert."
  warn "Re-check in 2-5 min: curl -I https://${DOMAIN}/readyz"
fi

cat <<EOF

${GREEN}${BOLD}Bootstrap complete.${NC}

Environment:  ${DEPLOY_ENV}
Domain:       https://${DOMAIN}
VM IP:        ${VM_IP}
VM DNS:       ${VM_DNS_HOST}
GitHub env:   https://github.com/${GH_REPO}/settings/environments

Re-running ${BOLD}pnpm bootstrap${NC} is safe (idempotent).

Next:
  • To provision preview:    DEPLOY_ENV=preview pnpm bootstrap
  • To provision production: DEPLOY_ENV=production pnpm bootstrap
  • To delete .env.bootstrap: rm .env.bootstrap  (values persist in GitHub env)

EOF
