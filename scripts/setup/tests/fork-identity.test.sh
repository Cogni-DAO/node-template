#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# shellcheck source=./scripts/setup/lib/fork-identity.sh
source "$REPO_ROOT/scripts/setup/lib/fork-identity.sh"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$tmp/infra"
cat > "$tmp/infra/fork.yaml" <<'YAML'
schema_version: 1
fork:
  slug: ""
domain:
  root: cognidao.org
YAML

git -C "$tmp" init -q
git -C "$tmp" remote add origin https://github.com/Cogni-DAO/cogni-poly.git

assert_eq() {
  local want="$1" got="$2" label="$3"
  if [[ "$want" != "$got" ]]; then
    echo "FAIL ${label}: want '${want}', got '${got}'" >&2
    exit 1
  fi
}

assert_eq "cogni-poly" "$(fork_identity_slug "$tmp")" "slug from origin"
assert_eq "test.cognidao.org" "$(domain_for_env candidate-a cognidao.org)" "candidate-a domain"
assert_eq "preview.cognidao.org" "$(domain_for_env preview cognidao.org)" "preview domain"
assert_eq "cognidao.org" "$(domain_for_env production cognidao.org)" "production domain"
assert_eq "cogni-poly-candidate-a.vm.cognidao.org" "$(vm_host_for_env candidate-a cognidao.org cogni-poly)" "candidate-a vm"
assert_eq "cogni-poly-preview.vm.cognidao.org" "$(vm_host_for_env preview cognidao.org cogni-poly)" "preview vm"
assert_eq "cogni-poly.vm.cognidao.org" "$(vm_host_for_env production cognidao.org cogni-poly)" "production vm"

cat > "$tmp/infra/fork.yaml" <<'YAML'
schema_version: 1
fork:
  slug: "Cogni Main"
domain:
  root: cognidao.org
YAML

assert_eq "cogni-main" "$(fork_identity_slug "$tmp")" "configured slug sanitized"

echo "fork-identity tests passed"
