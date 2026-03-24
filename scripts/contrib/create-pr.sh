#!/usr/bin/env bash
set -euo pipefail

BASE_REF="${BASE_REF:-origin/staging}"
HEAD_REF="${HEAD_REF:-HEAD}"
BASE_BRANCH="${BASE_BRANCH:-staging}"
BRANCH_NAME="$(git rev-parse --abbrev-ref "$HEAD_REF")"
SLUG="${PR_ARTIFACT_SLUG:-$(printf '%s' "$BRANCH_NAME" | tr '/ ' '--')}"
OUT_DIR="${PR_ARTIFACT_DIR:-.contrib/${SLUG}}"
TITLE_FILE="${PR_TITLE_FILE:-$OUT_DIR/direct-pr-title.txt}"
BODY_FILE="${PR_BODY_FILE:-$OUT_DIR/direct-pr-body.md}"
FILES_FILE="${PR_FILES_FILE:-$OUT_DIR/direct-pr-files.txt}"
HEAD_SHA="$(git rev-parse "$HEAD_REF")"
TITLE="$(git log --format=%s "$BASE_REF..$HEAD_REF" | tail -n 1)"
DIFF_STAT="$(git diff --stat "$BASE_REF...$HEAD_REF")"

mkdir -p "$OUT_DIR"

if [[ -z "$TITLE" ]]; then
  TITLE="chore(contrib): create pull request"
fi

if [[ -z "$DIFF_STAT" ]]; then
  DIFF_STAT="No changed files relative to $BASE_REF."
fi

INDENTED_DIFF_STAT="$(printf '%s\n' "$DIFF_STAT" | sed 's/^/    /')"

git diff --name-only "$BASE_REF...$HEAD_REF" > "$FILES_FILE"
printf '%s\n' "$TITLE" > "$TITLE_FILE"

cat > "$BODY_FILE" <<EOF
## Context

Direct pull request generated from the current branch.

- branch: $BRANCH_NAME
- base: $BASE_REF
- head: $HEAD_SHA

## Change

- Diff summary:

$INDENTED_DIFF_STAT

- Changed files are listed in '$FILES_FILE'.

## Evidence

- Local validation: <!-- add branch-specific checks -->
- CI: pending
EOF

has_base_flag=0
has_head_flag=0

for arg in "$@"; do
  case "$arg" in
    -B|--base|--base=*)
      has_base_flag=1
      ;;
    -H|--head|--head=*)
      has_head_flag=1
      ;;
  esac
done

GH_ARGS=("$@")

if [[ $has_base_flag -eq 0 ]]; then
  GH_ARGS=(--base "$BASE_BRANCH" "${GH_ARGS[@]}")
fi

if [[ $has_head_flag -eq 0 ]]; then
  GH_ARGS=(--head "$BRANCH_NAME" "${GH_ARGS[@]}")
fi

export GH_PROMPT_DISABLED="${GH_PROMPT_DISABLED:-1}"

echo "Using PR title: $TITLE_FILE"
echo "Using PR body:  $BODY_FILE"

gh pr create \
  --title "$(cat "$TITLE_FILE")" \
  --body-file "$BODY_FILE" \
  "${GH_ARGS[@]}"
