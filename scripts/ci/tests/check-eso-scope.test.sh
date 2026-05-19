#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# Fixture-driven regression tests for scripts/ci/check-eso-scope.sh (task.0284).
# Each case writes a synthetic ExternalSecret tree under a tmpdir, points the
# script at it via ROOT_DIR=, and asserts the expected exit status.
#
# Run: bash scripts/ci/tests/check-eso-scope.test.sh
# Exit: 0 if every case passes, 1 on first failure (with a clear diff).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TARGET="$REPO_ROOT/scripts/ci/check-eso-scope.sh"

TMPROOT=$(mktemp -d -t eso-scope.XXXXXX)
trap 'rm -rf "$TMPROOT"' EXIT

pass=0
fail=0

emit_valid_es() {
  # $1 = case-root (dir under $TMPROOT)
  # $2 = relative path to write (caller supplies an <env>/<service>/<file>.yaml shape)
  local case_root="$1" rel="$2"
  mkdir -p "$case_root/$(dirname "$rel")"
  cat >"$case_root/$rel" <<'YAML'
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: example-env-secrets
  namespace: cogni-candidate-a
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: openbao-backend
    kind: ClusterSecretStore
  target:
    name: example-env-secrets
  dataFrom:
    - extract:
        key: candidate-a/example
YAML
}

emit_es_with_store() {
  # $1 = case-root, $2 = rel-path, $3 = store-name, $4 = store-kind
  local case_root="$1" rel="$2" sn="$3" sk="$4"
  mkdir -p "$case_root/$(dirname "$rel")"
  cat >"$case_root/$rel" <<YAML
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: example-env-secrets
  namespace: cogni-candidate-a
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: ${sn}
    kind: ${sk}
  target:
    name: example-env-secrets
YAML
}

run_case() {
  # $1 = case name (for output)
  # $2 = ROOT_DIR for the script
  # $3 = expected exit code (0 or 1)
  local name="$1" root="$2" expected="$3"
  local got=0 out
  out=$(ROOT_DIR="$root" bash "$TARGET" 2>&1) || got=$?
  if [[ $got -eq $expected ]]; then
    printf 'OK  %s\n' "$name"
    pass=$((pass + 1))
  else
    printf 'FAIL %s — expected exit %d, got %d\n' "$name" "$expected" "$got"
    printf '  output:\n'
    # shellcheck disable=SC2001
    sed 's/^/    /' <<<"$out"
    fail=$((fail + 1))
  fi
}

# Case 1: empty tree — no ExternalSecrets at all → exit 0 (vacuous pass).
case_root="$TMPROOT/case1-empty"
mkdir -p "$case_root/infra"
run_case "empty repo passes" "$case_root" 0

# Case 2: happy path — <env>/<service>/<file>.yaml under sanctioned root.
case_root="$TMPROOT/case2-happy"
emit_valid_es "$case_root" \
  "infra/k8s/secrets/external-secrets/candidate-a/node-app/external-secret.yaml"
run_case "valid <env>/<service>/<file> passes" "$case_root" 0

# Case 3: LOCATION violation — outside the sanctioned root entirely.
case_root="$TMPROOT/case3-outside-root"
emit_valid_es "$case_root" \
  "infra/k8s/overlays/candidate-a/node-app/external-secret.yaml"
run_case "ExternalSecret outside sanctioned root fails" "$case_root" 1

# Case 4: LOCATION violation — flat <env>/<file> shape (missing service dir).
case_root="$TMPROOT/case4-missing-service-dir"
emit_valid_es "$case_root" \
  "infra/k8s/secrets/external-secrets/candidate-a/external-secret.yaml"
run_case "missing service subdir fails" "$case_root" 1

# Case 5: LOCATION violation — too deep (<env>/<service>/<subdir>/<file>).
case_root="$TMPROOT/case5-too-deep"
emit_valid_es "$case_root" \
  "infra/k8s/secrets/external-secrets/candidate-a/node-app/extra/external-secret.yaml"
run_case "ExternalSecret nested too deep fails" "$case_root" 1

# Case 6: STORE violation — wrong store name.
case_root="$TMPROOT/case6-bad-store-name"
emit_es_with_store "$case_root" \
  "infra/k8s/secrets/external-secrets/candidate-a/node-app/x.yaml" \
  "some-other-store" "ClusterSecretStore"
run_case "wrong secretStoreRef.name fails" "$case_root" 1

# Case 7: STORE violation — namespace-scoped SecretStore instead of ClusterSecretStore.
case_root="$TMPROOT/case7-bad-store-kind"
emit_es_with_store "$case_root" \
  "infra/k8s/secrets/external-secrets/candidate-a/node-app/x.yaml" \
  "openbao-backend" "SecretStore"
run_case "wrong secretStoreRef.kind fails" "$case_root" 1

# Case 8: STORE violation — old store name `openbao` (pre-spec) is rejected.
case_root="$TMPROOT/case8-old-store-name"
emit_es_with_store "$case_root" \
  "infra/k8s/secrets/external-secrets/candidate-a/node-app/x.yaml" \
  "openbao" "ClusterSecretStore"
run_case "pre-spec store name 'openbao' fails" "$case_root" 1

# Case 9: multiple valid ExternalSecrets — proves the loop iterates correctly.
case_root="$TMPROOT/case9-multi-valid"
emit_valid_es "$case_root" \
  "infra/k8s/secrets/external-secrets/candidate-a/node-app/external-secret.yaml"
emit_valid_es "$case_root" \
  "infra/k8s/secrets/external-secrets/candidate-a/scheduler-worker/external-secret.yaml"
emit_valid_es "$case_root" \
  "infra/k8s/secrets/external-secrets/preview/node-app/external-secret.yaml"
run_case "multiple valid ExternalSecrets pass" "$case_root" 0

# Case 10: mix of valid + invalid — at least one violation fails the run.
case_root="$TMPROOT/case10-mixed"
emit_valid_es "$case_root" \
  "infra/k8s/secrets/external-secrets/candidate-a/node-app/good.yaml"
emit_es_with_store "$case_root" \
  "infra/k8s/secrets/external-secrets/candidate-a/scheduler-worker/bad.yaml" \
  "rogue-store" "ClusterSecretStore"
run_case "mixed valid + invalid set fails on the bad one" "$case_root" 1

echo
echo "check-eso-scope.test.sh — pass: $pass, fail: $fail"
if [[ $fail -gt 0 ]]; then
  exit 1
fi
