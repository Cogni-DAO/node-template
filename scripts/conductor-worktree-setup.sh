#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

# Module: scripts/conductor-worktree-setup.sh
# Purpose: Prepare a Conductor-created node-template worktree for agent development.
# Side-effects: refreshes origin/main, links shared local auth/secrets when available,
#   installs deps, builds package declarations, and writes a setup proof marker.

set -euo pipefail

DEFAULT_BRANCH="${CONDUCTOR_DEFAULT_BRANCH:-main}"
WORKSPACE_ROOT="${CONDUCTOR_WORKSPACE_PATH:-$(pwd)}"

# AUTH_ROOT is THIS node's canonical (main) workspace checkout — the single place
# that holds .env.cogni and .local-auth. A Conductor worktree spawn is a git worktree
# of that main checkout, so we derive its path from git: no hardcoded or personal path,
# and never a reach into an unrelated repo. Override with COGNI_NODE_AUTH_ROOT if needed.
derive_main_workspace() {
  local common_dir
  common_dir="$(git -C "$WORKSPACE_ROOT" rev-parse --git-common-dir 2>/dev/null)" || return 1
  (cd "$WORKSPACE_ROOT" && cd "$(dirname "$common_dir")" && pwd)
}
AUTH_ROOT="${COGNI_NODE_AUTH_ROOT:-${CONDUCTOR_ROOT_PATH:-$(derive_main_workspace || true)}}"
COGNI_NODE_KEY_LOCK_DIR=""
COGNI_NODE_KEY_LOCK_OWNER=""

warn() {
  printf 'warn: %s\n' "$1" >&2
}

derive_node_slug() {
  [[ -f "$WORKSPACE_ROOT/.cogni/repo-spec.yaml" ]] || return 0
  awk '
    /^intent:/ { in_intent = 1; next }
    in_intent && /^[^[:space:]]/ { in_intent = 0 }
    in_intent && /^[[:space:]]+name:/ {
      sub(/^[[:space:]]+name:[[:space:]]*/, ""); gsub(/["'\''"]/, ""); print; exit
    }
  ' "$WORKSPACE_ROOT/.cogni/repo-spec.yaml" 2>/dev/null
}

node_base_url() {
  local node_slug="$1"
  case "$node_slug" in
    operator | cogni-template | "") printf 'https://cognidao.org\n' ;;
    *) printf 'https://%s.cognidao.org\n' "$node_slug" ;;
  esac
}

cleanup_node_key_lock() {
  if [[ -n "$COGNI_NODE_KEY_LOCK_OWNER" ]]; then
    rm -f "$COGNI_NODE_KEY_LOCK_OWNER" 2>/dev/null || true
  fi
  if [[ -n "$COGNI_NODE_KEY_LOCK_DIR" ]]; then
    rmdir "$COGNI_NODE_KEY_LOCK_DIR" 2>/dev/null || true
  fi
}

read_env_file_value() {
  local var_name="$1"
  local env_file="$2"

  [[ -f "$env_file" ]] || return 0
  awk -F= -v key="$var_name" '
    $1 == key {
      value = substr($0, length(key) + 2)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      gsub(/^["'\''"]|["'\''"]$/, "", value)
      found = value
    }
    END {
      if (found != "") print found
    }
  ' "$env_file" 2>/dev/null
}

auth_root_node_cogni_key_is_rejected() {
  local env_file="$AUTH_ROOT/.env.cogni"
  local key status register_base_url

  key="$(read_env_file_value COGNI_NODE_API_KEY "$env_file")"
  [[ -n "$key" ]] || return 1

  register_base_url="$(node_base_url "$(derive_node_slug)")"
  status="$(
    curl -sS --max-time 6 -o /dev/null -w '%{http_code}' \
      -H "Authorization: Bearer $key" \
      "$register_base_url/api/v1/cognition" 2>/dev/null || true
  )"

  [[ "$status" == "401" || "$status" == "403" ]]
}

refresh_workspace_base_ref() {
  git fetch origin "$DEFAULT_BRANCH:refs/remotes/origin/$DEFAULT_BRANCH"
}

# Conductor frequently forms a worktree off a stale local base, so the checked-out
# branch lands behind origin. Bring it up to date with the freshly fetched base
# (the `git pull main` step). Conflict-safe: on a dirty tree, detached HEAD, or a
# merge conflict we warn and continue rather than leaving the worktree wedged.
sync_workspace_to_base() {
  if ! git diff --quiet || ! git diff --cached --quiet; then
    warn "workspace has uncommitted changes; skipped $DEFAULT_BRANCH sync"
    return
  fi

  local branch
  branch="$(git branch --show-current 2>/dev/null || true)"
  if [[ -z "$branch" ]]; then
    warn "detached HEAD; skipped $DEFAULT_BRANCH sync"
    return
  fi

  if ! git merge --no-edit "origin/$DEFAULT_BRANCH"; then
    git merge --abort 2>/dev/null || true
    warn "origin/$DEFAULT_BRANCH does not merge cleanly into $branch; left as-is to resolve manually"
  fi
}

refresh_auth_root_main() {
  if [[ -z "$AUTH_ROOT" || "$AUTH_ROOT" == "$WORKSPACE_ROOT" ]]; then
    return
  fi

  if ! git -C "$AUTH_ROOT" rev-parse --show-toplevel >/dev/null 2>&1; then
    warn "auth root is not a git checkout: $AUTH_ROOT"
    return
  fi

  git -C "$AUTH_ROOT" fetch origin "$DEFAULT_BRANCH" || {
    warn "could not fetch origin/$DEFAULT_BRANCH in auth root: $AUTH_ROOT"
    return
  }

  local branch
  branch="$(git -C "$AUTH_ROOT" branch --show-current 2>/dev/null || true)"
  if [[ "$branch" != "$DEFAULT_BRANCH" ]]; then
    warn "auth root is on $branch, not $DEFAULT_BRANCH; fetched but skipped pull"
    return
  fi

  if ! git -C "$AUTH_ROOT" diff --quiet || ! git -C "$AUTH_ROOT" diff --cached --quiet; then
    warn "auth root has uncommitted changes; fetched but skipped pull"
    return
  fi

  git -C "$AUTH_ROOT" pull --ff-only origin "$DEFAULT_BRANCH" || {
    warn "could not fast-forward auth root: $AUTH_ROOT"
  }
}

auth_root_has_node_cogni_key() {
  local env_file="$AUTH_ROOT/.env.cogni"
  local key

  key="$(read_env_file_value COGNI_NODE_API_KEY "$env_file")"
  [[ -n "$key" ]]
}

register_auth_root_cogni_agent() {
  local env_file="$AUTH_ROOT/.env.cogni"
  local agent_name response key user_id billing_account node_slug register_base_url

  if ! command -v curl >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1; then
    warn "curl and jq are required to auto-register Cogni credentials"
    return 1
  fi

  node_slug="$(derive_node_slug)"
  register_base_url="$(node_base_url "$node_slug")"
  agent_name="${USER:-agent}-${node_slug:-node}-conductor-$(hostname -s 2>/dev/null || printf 'local')-$(date -u +%Y%m%dT%H%M%SZ)"
  response="$(
    curl -fsS --max-time 10 -X POST "$register_base_url/api/v1/agent/register" \
      -H 'content-type: application/json' \
      -d "$(jq -cn --arg name "$agent_name" '{name:$name}')"
  )" || return 1
  key="$(printf '%s\n' "$response" | jq -r '.apiKey // empty')"
  user_id="$(printf '%s\n' "$response" | jq -r '.userId // empty')"
  billing_account="$(printf '%s\n' "$response" | jq -r '.billingAccountId // empty')"
  [[ -n "$key" ]] || return 1

  {
    if [[ -f "$env_file" ]]; then
      printf '\n'
    else
      printf '# Cogni node API keys (gitignored via .env*)\n'
    fi
    printf '# Agent name: %s\n' "$agent_name"
    printf '# Registered via: %s/api/v1/agent/register\n' "$register_base_url"
    printf 'COGNI_NODE_API_KEY=%s\n' "$key"
    [[ -n "$user_id" ]] && printf 'COGNI_NODE_USER_ID=%s\n' "$user_id"
    [[ -n "$billing_account" ]] && printf 'COGNI_NODE_BILLING_ACCOUNT=%s\n' "$billing_account"
  } >>"$env_file"
  chmod 600 "$env_file"
}

ensure_auth_root_cogni_env() {
  local lock_dir owner_file

  if [[ -z "$AUTH_ROOT" ]]; then
    warn "no auth root resolved; cannot auto-register COGNI_NODE_API_KEY safely"
    exit 1
  fi

  if auth_root_has_node_cogni_key && ! auth_root_node_cogni_key_is_rejected; then
    return
  fi

  mkdir -p "$AUTH_ROOT/.context"
  lock_dir="$AUTH_ROOT/.context/cogni-node-key.lock"
  owner_file="$lock_dir/owner"
  if ! mkdir "$lock_dir" 2>/dev/null; then
    for _ in {1..20}; do
      sleep 1
      if auth_root_has_node_cogni_key && ! auth_root_node_cogni_key_is_rejected; then
        return
      fi
    done

    if rmdir "$lock_dir" 2>/dev/null; then
      warn "removed stale empty Cogni node key lock: $lock_dir"
      mkdir "$lock_dir" 2>/dev/null || {
        warn "could not acquire Cogni node key lock after removing stale lock: $lock_dir"
        exit 1
      }
    else
      warn "$AUTH_ROOT/.env.cogni still missing COGNI_NODE_API_KEY after waiting for another setup"
      warn "lock is still present at $lock_dir; remove it if no setup process is active"
      exit 1
    fi
  fi

  {
    printf 'pid=%s\n' "$$"
    printf 'workspace=%s\n' "$WORKSPACE_ROOT"
    printf 'createdAt=%s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  } >"$owner_file"
  COGNI_NODE_KEY_LOCK_DIR="$lock_dir"
  COGNI_NODE_KEY_LOCK_OWNER="$owner_file"
  trap cleanup_node_key_lock EXIT

  if auth_root_has_node_cogni_key && ! auth_root_node_cogni_key_is_rejected; then
    return
  fi

  warn "$AUTH_ROOT/.env.cogni missing a usable COGNI_NODE_API_KEY for $(node_base_url "$(derive_node_slug)"); attempting NODE agent registration"
  if register_auth_root_cogni_agent; then
    printf 'registered Cogni NODE agent and saved COGNI_NODE_API_KEY in %s\n' "$AUTH_ROOT/.env.cogni"
  else
    local register_base_url
    register_base_url="$(node_base_url "$(derive_node_slug)")"
    warn "could not auto-register Cogni NODE agent; POST $register_base_url/api/v1/agent/register and save COGNI_NODE_API_KEY in $AUTH_ROOT/.env.cogni"
    exit 1
  fi
}

link_from_auth_root() {
  local name="$1"
  local src_path="$AUTH_ROOT/$name"

  if [[ -z "$AUTH_ROOT" || "$AUTH_ROOT" == "$WORKSPACE_ROOT" ]]; then
    warn "no separate main-workspace root resolved; using local $name as-is, skipped link"
    return
  fi

  if [[ ! -e "$src_path" ]]; then
    warn "$src_path missing; skipped $name symlink"
    return
  fi

  if [[ -e "$name" && ! -L "$name" ]]; then
    # A real (non-symlink) file is the source of truth — e.g. a node ships its own
    # node-scoped .env.cogni that must not be replaced by the auth-root copy.
    warn "$name is a real file, not a symlink; keeping it and skipping the auth-root link"
    return
  fi

  ln -sfn "$src_path" "$name"
}

write_setup_proof() {
  mkdir -p .context
  WORKSPACE_ROOT="$WORKSPACE_ROOT" AUTH_ROOT="$AUTH_ROOT" DEFAULT_BRANCH="$DEFAULT_BRANCH" SETUP_COMPLETED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")" node <<'EOF'
const fs = require("node:fs");

fs.writeFileSync(
  ".context/conductor-setup.json",
  `${JSON.stringify(
    {
      workspaceRoot: process.env.WORKSPACE_ROOT,
      authRoot: process.env.AUTH_ROOT,
      defaultBranch: process.env.DEFAULT_BRANCH,
      completedAt: process.env.SETUP_COMPLETED_AT,
    },
    null,
    2
  )}\n`
);
EOF
}

refresh_workspace_base_ref
sync_workspace_to_base
refresh_auth_root_main
ensure_auth_root_cogni_env

# Symlink, never copy, so secret rotation and captured auth in the human's
# canonical checkout are immediately reflected in active Conductor worktrees.
link_from_auth_root ".env.cogni"
link_from_auth_root ".local-auth"

pnpm install --offline --frozen-lockfile || pnpm install --frozen-lockfile
pnpm build:packages
write_setup_proof
