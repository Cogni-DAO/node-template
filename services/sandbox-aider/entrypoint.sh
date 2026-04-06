#!/bin/bash
# Sandbox Entrypoint Script (copied from sandbox-runtime pattern)
# Starts socat bridge for LLM access, then runs command.
#
# Environment:
#   LLM_PROXY_SOCKET - Path to mounted unix socket (default: /llm-sock/llm.sock)
#   LLM_PROXY_PORT   - Local port for socat to listen on (default: 8080)

set -euo pipefail

LLM_PROXY_SOCKET="${LLM_PROXY_SOCKET:-/llm-sock/llm.sock}"
LLM_PROXY_PORT="${LLM_PROXY_PORT:-8080}"

# Check if socket exists (indicates LLM proxy is available)
if [[ -S "$LLM_PROXY_SOCKET" ]]; then
    echo "[sandbox] Starting socat bridge: localhost:${LLM_PROXY_PORT} -> ${LLM_PROXY_SOCKET}" >&2

    socat TCP-LISTEN:${LLM_PROXY_PORT},fork,reuseaddr,bind=127.0.0.1 \
          UNIX-CONNECT:${LLM_PROXY_SOCKET} &
    SOCAT_PID=$!

    sleep 0.1

    if ! kill -0 $SOCAT_PID 2>/dev/null; then
        echo "[sandbox] Warning: socat failed to start" >&2
    else
        echo "[sandbox] socat bridge running (pid: $SOCAT_PID)" >&2
    fi

    cleanup() {
        if [[ -n "${SOCAT_PID:-}" ]] && kill -0 $SOCAT_PID 2>/dev/null; then
            kill $SOCAT_PID 2>/dev/null || true
        fi
    }
    trap cleanup EXIT
else
    if [[ -n "${OPENAI_API_BASE:-}" ]]; then
        echo "[sandbox] FATAL: OPENAI_API_BASE is set but no socket at ${LLM_PROXY_SOCKET}" >&2
        echo "[sandbox] Volume may not be mounted. Check Tmpfs vs volume mount ordering." >&2
        exit 1
    fi
    echo "[sandbox] No LLM proxy socket found at ${LLM_PROXY_SOCKET}, skipping socat bridge" >&2
fi

# Run the provided command
if [[ $# -eq 0 ]]; then
    exec /bin/bash -l
else
    exec /bin/bash -lc "$@"
fi
