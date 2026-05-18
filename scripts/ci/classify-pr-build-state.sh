#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# Script: scripts/ci/classify-pr-build-state.sh
# Purpose: Disambiguate "no mq-{N}-{sha} images in GHCR" for flight-preview.
#   Three distinct causes → three distinct outcomes (per Axiom 11: every
#   no-op path must be visually distinct, never silent-green or
#   misleading-red):
#
#     - zero-affected: pr-build's merge_group run for HEAD_SHA found no
#                      affected targets (CI/docs/script-only PR). `build`
#                      matrix was skipped per its `if: has_targets == 'true'`
#                      gate. Expected; flight-preview should silent-skip.
#
#     - missing:       pr-build ran with affected targets but the build
#                      matrix failed/cancelled. No mq-* images exist
#                      because the build broke. Real error.
#
#     - no-run:        no merge_group pr-build run exists at all for
#                      HEAD_SHA. Possible admin-merge bypass (merge_group
#                      event never fired) OR rare race where the merge
#                      commit landed before pr-build's merge_group leg
#                      registered. Real error.
#
#     - ready:         pr-build succeeded; mq-{N}-{HEAD_SHA} images should
#                      exist in GHCR. Continue normal flight-preview path.
#
# Closes bug.5009 — was hard-fail on every CI/docs-only merge.
#
# Env:
#   PR_NUMBER     (required)
#   HEAD_SHA      (required) merge commit / queue-commit SHA
#   REPOSITORY    (default: $GITHUB_REPOSITORY)
#   GH_TOKEN      (required) authenticated `gh api` token
#
# Output ($GITHUB_OUTPUT or stdout):
#   state=ready | zero-affected | missing | no-run
#   classification_reason=<one-line human-readable detail>
#
# This script is read-only — only queries the GitHub Actions API. No git
# writes, no GHCR pulls. Cheap to call from every flight-preview run.

set -euo pipefail

PR_NUMBER=${PR_NUMBER:?PR_NUMBER required}
HEAD_SHA=${HEAD_SHA:?HEAD_SHA required}
REPOSITORY=${REPOSITORY:-${GITHUB_REPOSITORY:?REPOSITORY required}}

emit() {
  local state="$1" reason="$2"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    {
      echo "state=${state}"
      echo "classification_reason=${reason}"
    } >> "$GITHUB_OUTPUT"
  fi
  echo "state=${state}"
  echo "reason=${reason}"
}

# Find the merge_group pr-build run for HEAD_SHA. Retry with backoff to
# close the race between `push` firing on main and the merge_group run's
# conclusion flipping to `completed` — same bug class as bug.0320 (no-retry
# on the GitHub events/runs API race window). flight-preview fires on the
# push event, but the merge_group workflow run's finalisation can lag by
# a few seconds; classifying that lag as `no-run` or `missing` produces a
# misleading-red on a legitimately-good flight.
#
# Schedule: 6 attempts × 5s = 30s total, matches the wait-for-argocd cadence
# and is bounded enough that a real `no-run` (admin-merge bypass) still fails
# fast (within 30s) rather than silently hanging the flight job.
ATTEMPTS=${CLASSIFY_RETRY_ATTEMPTS:-6}
SLEEP_S=${CLASSIFY_RETRY_SLEEP_S:-5}

run_json=""
run_status=""
for attempt in $(seq 1 "$ATTEMPTS"); do
  run_json=$(gh api \
    "repos/${REPOSITORY}/actions/workflows/pr-build.yml/runs?event=merge_group&head_sha=${HEAD_SHA}&per_page=5" \
    --jq '.workflow_runs[0] // empty' 2>/dev/null || true)
  if [ -n "$run_json" ] && [ "$run_json" != "null" ]; then
    run_status=$(printf '%s' "$run_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])')
    if [ "$run_status" = "completed" ]; then
      break
    fi
    echo "  pr-build run for ${HEAD_SHA:0:8} status=${run_status} (attempt ${attempt}/${ATTEMPTS}); retry in ${SLEEP_S}s..." >&2
  else
    echo "  no pr-build merge_group run yet for ${HEAD_SHA:0:8} (attempt ${attempt}/${ATTEMPTS}); retry in ${SLEEP_S}s..." >&2
  fi
  [ "$attempt" -lt "$ATTEMPTS" ] && sleep "$SLEEP_S"
done

if [ -z "$run_json" ] || [ "$run_json" = "null" ]; then
  emit "no-run" "no merge_group pr-build run found for ${HEAD_SHA:0:8} after ${ATTEMPTS} attempts — possible admin-merge bypass"
  exit 0
fi

run_id=$(printf '%s' "$run_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')

if [ "$run_status" != "completed" ]; then
  emit "missing" "pr-build merge_group run ${run_id} for ${HEAD_SHA:0:8} still ${run_status} after ${ATTEMPTS} retries"
  exit 0
fi

# Inspect the `build` matrix job's conclusion. Match the matrix jobs by name
# prefix `build (` to avoid silent collision with a future top-level job
# named e.g. `build-manifest`. pr-build.yml's matrix renders as
# `build (poly)`, `build (poly-test-worker)`, etc.
build_concls=$(gh api "repos/${REPOSITORY}/actions/runs/${run_id}/jobs?per_page=100" \
  --jq '[.jobs[] | select(.name | test("^build \\(")) | .conclusion] | unique' 2>/dev/null || echo "[]")

# Empty array → no build jobs at all → matrix had zero legs → zero-affected.
build_count=$(printf '%s' "$build_concls" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')

if [ "$build_count" -eq 0 ]; then
  emit "zero-affected" "pr-build run ${run_id} had no build jobs (detect-affected emitted 0 targets)"
  exit 0
fi

# When ALL build jobs were skipped, it's zero-affected (rare — only if
# detect emitted targets but matrix gate was false; defensive case).
all_skipped=$(printf '%s' "$build_concls" | python3 -c 'import json,sys; cs=json.load(sys.stdin); print("yes" if all(c=="skipped" for c in cs) else "no")')

if [ "$all_skipped" = "yes" ]; then
  emit "zero-affected" "pr-build run ${run_id} had all build jobs skipped"
  exit 0
fi

# Any build job failed/cancelled → no complete image set → missing.
any_bad=$(printf '%s' "$build_concls" | python3 -c 'import json,sys; cs=json.load(sys.stdin); print("yes" if any(c not in ("success","skipped") for c in cs) else "no")')

if [ "$any_bad" = "yes" ]; then
  emit "missing" "pr-build run ${run_id} build matrix not fully successful (conclusions=${build_concls})"
  exit 0
fi

emit "ready" "pr-build run ${run_id} build matrix succeeded (conclusions=${build_concls})"
