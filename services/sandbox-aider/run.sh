#!/bin/bash
# Aider headless runner — reads task, runs aider, emits JSON summary.
set -euo pipefail

# Task input: file or env var
if [[ -f /workspace/task.md ]]; then
    TASK_MSG="$(cat /workspace/task.md)"
elif [[ -n "${TASK:-}" ]]; then
    TASK_MSG="$TASK"
else
    echo '{"error":"No task found. Provide /workspace/task.md or set TASK env var."}' >&2
    exit 1
fi

# Configure git identity
git config --global user.email "cogni-aider@cognidao.org"
git config --global user.name "Cogni Aider Agent"
git config --global init.defaultBranch main

# Initialize git repo if not already one (aider requires a git repo)
if [[ ! -d /workspace/.git ]]; then
    git init /workspace
    git -C /workspace add -A 2>/dev/null || true
    git -C /workspace commit -m "initial" --allow-empty 2>/dev/null || true
fi

# Capture commit before aider runs
BEFORE_SHA="$(git -C /workspace rev-parse HEAD 2>/dev/null || echo 'none')"

# Run aider
aider \
    --model "${AIDER_MODEL:-openrouter/moonshotai/kimi-k2.5}" \
    --openai-api-base "http://localhost:8080/v1" \
    --openai-api-key "${LITELLM_API_KEY:-sk-placeholder}" \
    --message "$TASK_MSG" \
    --yes \
    --no-stream \
    --auto-commits \
    --no-suggest-shell-commands \
    --no-auto-lint \
    --no-auto-test

# Capture result
AFTER_SHA="$(git -C /workspace rev-parse HEAD 2>/dev/null || echo 'none')"

if [[ "$BEFORE_SHA" == "$AFTER_SHA" ]]; then
    FILES_CHANGED="[]"
    DIFF_STAT=""
else
    FILES_CHANGED="$(git -C /workspace diff --name-only "$BEFORE_SHA".."$AFTER_SHA" | jq -R -s -c 'split("\n") | map(select(length > 0))')"
    DIFF_STAT="$(git -C /workspace diff --stat "$BEFORE_SHA".."$AFTER_SHA")"
fi

# Emit JSON summary
cat <<EOF
{"files_changed":${FILES_CHANGED:-[]},"commit_sha":"${AFTER_SHA}","diff_stat":"$(echo "$DIFF_STAT" | tr '\n' '\\n')"}
EOF
