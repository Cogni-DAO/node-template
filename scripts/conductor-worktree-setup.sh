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
AUTH_ROOT="${COGNI_NODE_AUTH_ROOT:-${COGNI_TEMPLATE_ROOT:-${CONDUCTOR_ROOT_PATH:-$HOME/dev/cogni-template}}}"

warn() {
  printf 'warn: %s\n' "$1" >&2
}

refresh_workspace_base_ref() {
  git fetch origin "$DEFAULT_BRANCH:refs/remotes/origin/$DEFAULT_BRANCH"
}

refresh_auth_root_main() {
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

link_from_auth_root() {
  local name="$1"
  local src_path="$AUTH_ROOT/$name"

  if [[ ! -e "$src_path" ]]; then
    warn "$src_path missing; skipped $name symlink"
    return
  fi

  if [[ -e "$name" && ! -L "$name" ]]; then
    printf '%s exists and is not a symlink; move it aside before running setup\n' "$name" >&2
    exit 1
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
refresh_auth_root_main

# Symlink, never copy, so secret rotation and captured auth in the human's
# canonical checkout are immediately reflected in active Conductor worktrees.
link_from_auth_root ".env.cogni"
link_from_auth_root ".local-auth"

pnpm install --offline --frozen-lockfile || pnpm install --frozen-lockfile
pnpm build:packages
write_setup_proof
