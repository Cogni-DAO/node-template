#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# Fork identity helpers for setup/provision scripts. This file is sourced;
# callers own shell options.
#
# Fork domain root is read from the FORK_DOMAIN_ROOT env var (GitHub repo
# variable in the GHA path; exported via shell or .env.bootstrap in the
# laptop fallback). Callers use `${FORK_DOMAIN_ROOT:?…}` with their own
# error when they need the value.

fork_identity_slug() {
  local repo_root="$1" origin repo slug

  if [[ -n "${FORK_SLUG:-}" ]]; then
    slug="$FORK_SLUG"
  else
    origin=$(git -C "$repo_root" remote get-url origin 2>/dev/null || echo "")
    repo=$(echo "$origin" | sed -E 's#.*github.com[:/]([^/]+/)?([^/.]+)(\.git)?$#\2#')
    [[ -z "$repo" || "$repo" == "$origin" ]] && repo="node-template"
    slug="$repo"
  fi

  echo "$slug" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-+/-/g'
}

domain_for_env() {
  local deploy_env="$1" root="$2"
  case "$deploy_env" in
    production)  printf '%s' "$root" ;;
    preview)     printf 'preview.%s' "$root" ;;
    candidate-a) printf 'test.%s' "$root" ;;
    candidate-*) printf '%s.%s' "$deploy_env" "$root" ;;
    *)           return 1 ;;
  esac
}

vm_host_for_env() {
  local deploy_env="$1" root="$2" slug="$3"
  case "$deploy_env" in
    production) printf '%s.vm.%s' "$slug" "$root" ;;
    *)          printf '%s-%s.vm.%s' "$slug" "$deploy_env" "$root" ;;
  esac
}
