#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# Script: scripts/ci/resolve-digests-from-preview.sh
# Purpose: Resolve per-target image digests by reading the current state of
#          deploy/preview overlays. Emits the same digests_json shape as
#          the GHCR-tag resolver in promote-and-deploy.yml so promote-k8s
#          can consume either source transparently.
#
# Why: Affected-only CI produces a preview where different apps carry
# different PR source SHAs (bug.0364). The original GHCR-tag resolver
# assumes one preview-<source_sha> for all targets, which silently no-ops
# against a heterogeneous preview. Reading preview's resolved digests
# forward is the right primitive: preview has already proven exactly
# those digests.
#
# Env:
#   PREVIEW_OVERLAY_ROOT  path to deploy/preview checkout's
#                         infra/k8s/overlays/preview dir (required)
# Args: none
# Output: single line `digests_json={...}` to $GITHUB_OUTPUT if set,
#         plus a human-readable table on stdout.

set -euo pipefail

: "${PREVIEW_OVERLAY_ROOT:?PREVIEW_OVERLAY_ROOT required (path to deploy/preview overlays/preview dir)}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/image-tags.sh
. "${SCRIPT_DIR}/lib/image-tags.sh"

# Read an overlay's images[] and print "<app_digest>|<migrator_digest>" where
# each value is `<newName>@<digest>` or empty. App entry is the one whose
# `name:` does NOT contain `-migrate`; migrator entry is the one that does.
read_overlay_digests() {
  local overlay_file="$1"
  if [ ! -f "$overlay_file" ]; then
    echo "|"
    return 0
  fi
  python3 - "$overlay_file" <<'PY'
import re, sys
path = sys.argv[1]
with open(path) as f:
    text = f.read()
# Extract the images: block (stops at next top-level key or EOF).
m = re.search(r'(?m)^images:\s*\n((?:[ \t]+.*\n)+)', text)
if not m:
    print("|"); sys.exit(0)
block = m.group(1)
# Split into per-item chunks on lines starting with `  - name:` (2-space indent).
entries = re.split(r'(?m)^(?=[ \t]*-\s+name:)', block)
app = ""
mig = ""
for e in entries:
    e = e.strip()
    if not e: continue
    name_m    = re.search(r'-\s*name:\s*(\S+)', e)
    newname_m = re.search(r'newName:\s*(\S+)', e)
    digest_m  = re.search(r'digest:\s*"?([^"\s]+)"?', e)
    if not (name_m and newname_m and digest_m):
        continue
    ref = f"{newname_m.group(1)}@{digest_m.group(1)}"
    if "-migrate" in name_m.group(1):
        mig = ref
    else:
        app = ref
print(f"{app}|{mig}")
PY
}

DIGESTS_JSON="{}"
echo "Resolved digests from deploy/preview overlays:"

upsert() {
  local key="$1" val="$2"
  DIGESTS_JSON=$(printf '%s' "$DIGESTS_JSON" | jq -c --arg k "$key" --arg v "$val" '. + {($k): $v}')
}

for node in "${NODE_TARGETS[@]}"; do
  overlay="${PREVIEW_OVERLAY_ROOT}/${node}/kustomization.yaml"
  pair=$(read_overlay_digests "$overlay")
  app="${pair%%|*}"
  mig="${pair#*|}"
  upsert "$node" "$app"
  upsert "${node}-migrator" "$mig"
  printf '  %-20s %s\n' "${node}:"           "${app:-(missing)}"
  printf '  %-20s %s\n' "${node}-migrator:"  "${mig:-(missing)}"
done

# scheduler-worker has its own overlay and no migrator entry.
sw_overlay="${PREVIEW_OVERLAY_ROOT}/scheduler-worker/kustomization.yaml"
sw_pair=$(read_overlay_digests "$sw_overlay")
sw_app="${sw_pair%%|*}"
upsert "scheduler-worker" "$sw_app"
printf '  %-20s %s\n' "scheduler-worker:" "${sw_app:-(missing)}"

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "digests_json=${DIGESTS_JSON}" >> "$GITHUB_OUTPUT"
fi
# Also echo to stdout so callers not using $GITHUB_OUTPUT can pick it up.
printf 'digests_json=%s\n' "$DIGESTS_JSON"
