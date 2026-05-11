#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# scripts/rename-node.sh <new-node-name>
#
# Mechanically retargets a fresh clone of Cogni-DAO/node-template to a new
# node name. Run once after forking:
#
#   git clone https://github.com/<your-org>/<your-repo>
#   cd <your-repo>
#   scripts/rename-node.sh my-node
#   pnpm install --no-frozen-lockfile && pnpm packages:build && pnpm test:ci
#
# What it does
#   1. Validates the new name (kebab-case: lowercase letters, digits, hyphens;
#      must start with a letter).
#   2. git mv nodes/node-template            → nodes/<new>
#      git mv infra/catalog/node-template.yaml → infra/catalog/<new>.yaml
#   3. Replaces every literal "node-template" with <new> in all tracked text
#      files except this script and pnpm-lock.yaml (which pnpm regenerates).
#   4. Stages the result. You then run pnpm install + verify.
#
# What it does NOT do
#   - Push changes (review the diff first).
#   - Generate UUIDs in .cogni/repo-spec.yaml (placeholder UUIDs remain; rotate
#     them per docs/spec/identity-model.md before deploying).
#   - Touch your DAO/wallet config in .cogni/repo-spec.yaml.

set -euo pipefail

OLD="node-template"

usage() {
  cat >&2 <<EOF
Usage: $0 <new-node-name>

  <new-node-name>   kebab-case (^[a-z][a-z0-9-]*\$), must differ from "$OLD"

Run from the repo root. Operates on tracked files (git ls-files); make sure
you're on a clean working tree.
EOF
  exit 1
}

if [[ $# -ne 1 ]]; then
  usage
fi

NEW="$1"

if ! [[ "$NEW" =~ ^[a-z][a-z0-9-]*$ ]]; then
  echo "error: name '$NEW' must match ^[a-z][a-z0-9-]*\$ (kebab-case, lowercase)" >&2
  exit 1
fi

if [[ "$NEW" == "$OLD" ]]; then
  echo "error: new name must differ from '$OLD'" >&2
  exit 1
fi

# Repo-root sanity
if [[ ! -d nodes/$OLD ]]; then
  echo "error: nodes/$OLD not found. Run from the repo root of a fresh fork." >&2
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "error: not a git repository" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is dirty. Commit or stash first." >&2
  exit 1
fi

echo "→ git mv nodes/$OLD nodes/$NEW"
git mv "nodes/$OLD" "nodes/$NEW"

echo "→ git mv infra/catalog/$OLD.yaml infra/catalog/$NEW.yaml"
git mv "infra/catalog/$OLD.yaml" "infra/catalog/$NEW.yaml"

# Sed replace in all tracked text files, excluding:
#   - this script (would self-mutate the OLD literal)
#   - pnpm-lock.yaml (pnpm regenerates on next install)
#   - binary files (git grep -I filters to text)
echo "→ sed s/$OLD/$NEW/g across tracked text files"

# git grep -I limits to text; -l lists matching files; -z null-delimits for safe xargs
# Use ':!path' pathspecs to exclude.
mapfile -d '' files < <(
  git grep -I -l -z "$OLD" -- \
    ':!scripts/rename-node.sh' \
    ':!pnpm-lock.yaml'
)

if [[ ${#files[@]} -eq 0 ]]; then
  echo "→ no remaining occurrences of '$OLD' in tracked text files"
else
  # Portable in-place sed (mac + linux) via a temp file per invocation.
  for f in "${files[@]}"; do
    # macOS sed needs '' after -i; GNU sed rejects it. Use a Perl one-liner
    # for portability (Perl is on every dev machine + CI runner).
    perl -pi -e "s/\Q$OLD\E/$NEW/g" "$f"
  done
  echo "→ rewrote ${#files[@]} files"
fi

git add -A

cat <<EOF

✓ rename staged: $OLD → $NEW
  Directories moved + text rewritten. pnpm-lock.yaml left alone.

Next steps:
  1. Review:  git diff --cached --stat
  2. Install: pnpm install --no-frozen-lockfile   # regenerates pnpm-lock.yaml
  3. Verify:  pnpm packages:build && pnpm test:ci
  4. Rotate UUIDs in .cogni/repo-spec.yaml + nodes/$NEW/.cogni/repo-spec.yaml
     (placeholders are 00000000-...; regenerate per docs/spec/identity-model.md).
  5. Commit:  git commit -m "chore: rename node-template → $NEW"
EOF
