#!/usr/bin/env bash
set -euo pipefail

BASE_REF="${1:-origin/staging}"
HEAD_REF="${2:-HEAD}"
SLUG="${3:-$(git rev-parse --abbrev-ref "$HEAD_REF" | tr '/ ' '--')}"
OUT_DIR=".contrib/${SLUG}"

mkdir -p "$OUT_DIR"

TITLE_FILE="$OUT_DIR/pr-title.txt"
BODY_FILE="$OUT_DIR/pr-body.md"
PATCH_FILE="$OUT_DIR/changes.patch"
BUNDLE_FILE="$OUT_DIR/branch.bundle"
META_FILE="$OUT_DIR/meta.txt"
FILES_FILE="$OUT_DIR/files.txt"

BRANCH_NAME="$(git rev-parse --abbrev-ref "$HEAD_REF")"
HEAD_SHA="$(git rev-parse "$HEAD_REF")"
BASE_SHA="$(git rev-parse "$BASE_REF")"
TITLE="$(git log --format=%s "$BASE_REF..$HEAD_REF" | tail -n 1)"

if [[ -z "$TITLE" ]]; then
  TITLE="chore(contrib): export branch artifacts"
fi

git diff --name-only "$BASE_REF...$HEAD_REF" > "$FILES_FILE"
git format-patch --stdout "$BASE_REF...$HEAD_REF" > "$PATCH_FILE"
git bundle create "$BUNDLE_FILE" "$HEAD_REF" "$BASE_REF"

printf '%s\n' "$TITLE" > "$TITLE_FILE"

cat > "$BODY_FILE" <<EOF
## Context

External contributor export.

- branch: $BRANCH_NAME
- base: $BASE_REF
- head: $HEAD_SHA

## Change

- See attached patch or bundle.
- Changed files are listed in '$FILES_FILE'.

## Evidence

- Local validation: see local branch checks
- CI: pending upstream PR

## Import

    git fetch origin
    git checkout -b $BRANCH_NAME $BASE_REF
    git am $PATCH_FILE

Or:

    git fetch origin
    git checkout -b $BRANCH_NAME $BASE_REF
    git pull $BUNDLE_FILE $BRANCH_NAME
EOF

cat > "$META_FILE" <<EOF
branch=$BRANCH_NAME
base_ref=$BASE_REF
base_sha=$BASE_SHA
head_sha=$HEAD_SHA
patch=$PATCH_FILE
bundle=$BUNDLE_FILE
title=$TITLE_FILE
body=$BODY_FILE
files=$FILES_FILE
created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

echo "Exported contributor artifacts to $OUT_DIR"
echo "- title:  $TITLE_FILE"
echo "- body:   $BODY_FILE"
echo "- files:  $FILES_FILE"
echo "- patch:  $PATCH_FILE"
echo "- bundle: $BUNDLE_FILE"
echo "- meta:   $META_FILE"
