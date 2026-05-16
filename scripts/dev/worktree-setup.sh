#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2026 Cogni-DAO
#
# Bootstrap a Conductor / git-worktree clone of this repo so it shares
# secrets and captured-auth state with the user's main checkout. Run once
# at worktree creation, after `git worktree add`.
#
#   COGNI_TEMPLATE_ROOT  Path to the main checkout (defaults to
#                        $HOME/dev/cogni-node-template). The worktree's
#                        `.env.cogni` and `.local-auth` get symlinked
#                        here so secret + cookie rotations in the main
#                        checkout propagate instantly to every worktree.
#
# Why symlinks (not cp): stale-secret divergence across worktrees is
# the #1 cause of "but it worked in my other clone" debugging — every
# rotation in $SRC must reach every active worktree on the next read.
#
# Forks should set COGNI_TEMPLATE_ROOT to their main checkout path
# (e.g. $HOME/dev/cogni-poly) or override the default below.

set -euo pipefail

SRC="${COGNI_TEMPLATE_ROOT:-$HOME/dev/cogni-node-template}"
if [[ ! -d "$SRC" ]]; then
  echo "set COGNI_TEMPLATE_ROOT to your main checkout (default: \$HOME/dev/cogni-node-template)" >&2
  exit 1
fi

# `-s` symlink, `-n` don't deref existing symlink to traverse, `-f` overwrite.
ln -snf "$SRC/.env.cogni"  .env.cogni
ln -snf "$SRC/.local-auth" .local-auth

pnpm install --offline --frozen-lockfile
pnpm packages:build
