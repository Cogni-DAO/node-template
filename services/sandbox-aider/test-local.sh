#!/bin/bash
# Local build + startup test for sandbox-aider container.
# No LLM proxy — just verifies the image builds and entrypoint runs.
set -euo pipefail

IMAGE="cogni-sandbox-aider:test"
TMPDIR="$(mktemp -d)"

cleanup() {
    rm -rf "$TMPDIR"
}
trap cleanup EXIT

echo "=== Building sandbox-aider image ==="
docker build -t "$IMAGE" "$(dirname "$0")"

echo "=== Creating test workspace ==="
echo "Add a comment to the top of README.md saying 'Hello from Aider'" > "$TMPDIR/task.md"
echo "# Test README" > "$TMPDIR/README.md"

echo "=== Running container (build/startup test only, no LLM) ==="
# Run entrypoint with a simple command to verify the container starts
docker run --rm \
    -v "$TMPDIR:/workspace" \
    "$IMAGE" \
    "echo '[test] Container started OK. Entrypoint works.' && cat /workspace/task.md"

EXIT_CODE=$?
if [[ $EXIT_CODE -eq 0 ]]; then
    echo "=== PASS: sandbox-aider container builds and starts ==="
else
    echo "=== FAIL: exit code $EXIT_CODE ==="
    exit 1
fi
