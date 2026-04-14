#!/usr/bin/env bash
set -euo pipefail

# set-preview-review-state.sh — write review-state (and optionally current-sha) to deploy/preview.
#
# Target states: dispatching | reviewing | unlocked
#   reviewing:   also writes current-sha (required)
#   unlocked:    does not touch current-sha or candidate-sha
#   dispatching: primarily written by flight-preview.sh inline; this helper supports it for
#                symmetry and manual recovery
#
# Idempotent: if current state already equals target (and sha matches when applicable), no-op.
# On unexpected prior state (e.g., target=reviewing but prior=unlocked), logs and forces anyway —
# the CI job that ran to completion is more authoritative than the file.
#
# Usage: set-preview-review-state.sh <dispatching|reviewing|unlocked> [sha]
# Env:   GH_TOKEN (required)
#        GITHUB_REPOSITORY (required)
#        DEPLOY_BRANCH (default: deploy/preview)

TARGET="${1:?Usage: set-preview-review-state.sh <dispatching|reviewing|unlocked> [sha]}"
SHA="${2:-}"
REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY required}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-deploy/preview}"
: "${GH_TOKEN:?GH_TOKEN required}"

case "$TARGET" in
  dispatching|reviewing|unlocked) ;;
  *) echo "❌ Invalid target state: $TARGET"; exit 1 ;;
esac

if [ "$TARGET" = "reviewing" ] && [ -z "$SHA" ]; then
  echo "❌ sha required when target=reviewing"
  exit 1
fi

SHORT_SHA="${SHA:0:8}"
case "$TARGET" in
  dispatching) COMMIT_MSG="promote-state: dispatch ${SHORT_SHA} to preview (lease claimed)" ;;
  reviewing)   COMMIT_MSG="promote-state: ${SHORT_SHA} under review (deploy success)" ;;
  unlocked)    COMMIT_MSG="promote-state: unlock preview (deploy failed or reset)" ;;
esac

apply_intent() {
  mkdir -p .promote-state
  echo "$TARGET" > .promote-state/review-state
  if [ "$TARGET" = "reviewing" ]; then
    echo "$SHA" > .promote-state/current-sha
  fi
}

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

git clone --depth=1 --branch="$DEPLOY_BRANCH" \
  "https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git" "$TMPDIR" 2>/dev/null
cd "$TMPDIR"

git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"

PRIOR_STATE=$(cat .promote-state/review-state 2>/dev/null || echo unlocked)
if [ "$TARGET" = "reviewing" ] && [ "$PRIOR_STATE" != "dispatching" ]; then
  echo "⚠️  Unexpected transition: ${PRIOR_STATE} → ${TARGET} (expected dispatching → reviewing)"
elif [ "$TARGET" = "unlocked" ] && [ "$PRIOR_STATE" != "dispatching" ] && [ "$PRIOR_STATE" != "reviewing" ]; then
  echo "⚠️  Unexpected transition: ${PRIOR_STATE} → ${TARGET}"
fi

MAX=5
for attempt in $(seq 1 $MAX); do
  apply_intent
  git add -A .promote-state/

  if git diff --cached --quiet; then
    echo "✅ No-op: review-state=${TARGET}${SHA:+ current-sha=${SHORT_SHA}} already set"
    exit 0
  fi

  git commit -m "$COMMIT_MSG" >/dev/null

  if git push origin "HEAD:${DEPLOY_BRANCH}" 2>&1; then
    echo "✅ Preview review-state → ${TARGET}${SHA:+ (sha=${SHORT_SHA})}"
    exit 0
  fi

  echo "push conflict (attempt ${attempt}/${MAX}), rebasing..."
  git fetch origin "$DEPLOY_BRANCH"
  git reset --hard "origin/$DEPLOY_BRANCH"
done

echo "❌ set-preview-review-state exhausted ${MAX} push attempts"
exit 1
