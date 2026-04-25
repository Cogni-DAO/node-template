#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# bootstrap-per-node-deploy-branches.sh — create + fast-forward per-node deploy branches.
#
# task.0372 + R4-#5 (BOOTSTRAP_FAST_FORWARDS_BEFORE_MERGE).
# Iterates infra/catalog/*.yaml (CATALOG_IS_SSOT). For each (env, node) pair:
#   - missing                              → create at whole-slot tip
#   - per-node ancestor of whole-slot      → fast-forward (push)
#   - whole-slot ancestor of per-node      → ahead, no-op
#   - no ancestry                          → DIVERGED, fail loud (exit 2)
#                                            Set BOOTSTRAP_ALLOW_DIVERGENCE=1 to
#                                            proceed (expected post-cutover when
#                                            per-node has matrix-flight commits
#                                            not on whole-slot).
# Idempotent. Re-run as the last action immediately before merging task.0372.
#
# ENVS env (CSV, default "candidate-a,preview,production"): which envs to bootstrap.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

# shellcheck disable=SC1091
. "$repo_root/scripts/ci/lib/image-tags.sh"

ENVS="${ENVS:-candidate-a,preview,production}"
# Trim whitespace so ENVS="candidate-a, preview" doesn't produce " preview".
IFS=',' read -r -a env_list <<<"${ENVS// /}"

# Explicit deploy/* refspec — default refspec is unreliable on
# single-branch / custom-refspec worktrees (review-feedback #1).
git fetch origin '+refs/heads/deploy/*:refs/remotes/origin/deploy/*' --prune --quiet

remote_url=$(git remote get-url origin)
echo "→ Bootstrap target: ${remote_url}"
echo "→ Envs: ${env_list[*]}"

push_args=()
log_lines=()
diverged=0

for env in "${env_list[@]}"; do
  whole_slot_ref="refs/remotes/origin/deploy/${env}"
  if ! git rev-parse --verify --quiet "$whole_slot_ref" >/dev/null; then
    echo "::error::Whole-slot branch deploy/${env} missing on origin — cannot bootstrap"
    exit 1
  fi
  whole_slot_sha=$(git rev-parse "$whole_slot_ref")

  for node in "${ALL_TARGETS[@]}"; do
    per_node_branch="deploy/${env}-${node}"
    per_node_ref="refs/remotes/origin/${per_node_branch}"

    if git rev-parse --verify --quiet "$per_node_ref" >/dev/null; then
      per_node_sha=$(git rev-parse "$per_node_ref")
      if [ "$per_node_sha" = "$whole_slot_sha" ]; then
        log_lines+=("noop      ${per_node_branch} = ${whole_slot_sha:0:8}")
        continue
      fi
      # Three-state classifier (review-feedback #2): per-node is ancestor
      # of whole-slot (FF), descendant (ahead, no-op), or diverged.
      if git merge-base --is-ancestor "$per_node_sha" "$whole_slot_sha"; then
        log_lines+=("ff        ${per_node_branch} ${per_node_sha:0:8} → ${whole_slot_sha:0:8}")
        push_args+=("${whole_slot_sha}:refs/heads/${per_node_branch}")
      elif git merge-base --is-ancestor "$whole_slot_sha" "$per_node_sha"; then
        log_lines+=("ahead     ${per_node_branch} = ${per_node_sha:0:8} (whole-slot at ${whole_slot_sha:0:8})")
      else
        log_lines+=("DIVERGED  ${per_node_branch} ${per_node_sha:0:8} ⊥ ${whole_slot_sha:0:8} — manual review required")
        diverged=$((diverged + 1))
      fi
    else
      log_lines+=("create    ${per_node_branch} @ ${whole_slot_sha:0:8}")
      push_args+=("${whole_slot_sha}:refs/heads/${per_node_branch}")
    fi
  done
done

printf '%s\n' "${log_lines[@]}"

if [ "$diverged" -gt 0 ]; then
  echo "::error::${diverged} per-node branch(es) diverged from whole-slot tip — refusing to bootstrap. Manual reconciliation required (rebase or reset per-node branch onto whole-slot, or accept divergence as expected post-cutover by setting BOOTSTRAP_ALLOW_DIVERGENCE=1)."
  if [ "${BOOTSTRAP_ALLOW_DIVERGENCE:-0}" != "1" ]; then
    exit 2
  fi
  echo "::warning::BOOTSTRAP_ALLOW_DIVERGENCE=1 — proceeding without fast-forwarding diverged branches"
fi

if [ "${#push_args[@]}" -eq 0 ]; then
  echo "✓ All per-node branches already at whole-slot tip — nothing to push."
  exit 0
fi

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "DRY_RUN=1 — would atomic-push:"
  printf '  %s\n' "${push_args[@]}"
  exit 0
fi

echo "→ Atomic-pushing ${#push_args[@]} ref(s) to origin (review-feedback #3)..."
git push --atomic origin "${push_args[@]}"
echo "✓ Done."
