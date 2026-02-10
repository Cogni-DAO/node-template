#!/bin/bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

# Script: platform/ci/scripts/healthcheck-sourcecred.sh
# Purpose: Wait for SourceCred to become ready after compose up.
# Usage:   bash healthcheck-sourcecred.sh "docker compose --project-name cogni-sourcecred ..."
# Exit:    0 = healthy, 1 = timeout or crash
# Notes:   Extracted from deploy.sh to keep deploy script size manageable.

set -euo pipefail

COMPOSE_CMD="${1:?Usage: healthcheck-sourcecred.sh COMPOSE_CMD}"
TIMEOUT="${2:-300}"

log_info()  { echo -e "\033[0;32m[INFO]\033[0m $1"; }
log_error() { echo -e "\033[0;31m[ERROR]\033[0m $1"; }

deadline=$((SECONDS + TIMEOUT))
while true; do
    if (( SECONDS >= deadline )); then
        log_error "SourceCred failed to become ready (${TIMEOUT}s timeout)"
        $COMPOSE_CMD logs --tail=200 sourcecred || true
        exit 1
    fi

    # Fail fast if container crashed
    cid="$($COMPOSE_CMD ps -q sourcecred || true)"
    if [[ -z "$cid" ]]; then
        status="missing"
        restarting="false"
    else
        container_info="$(docker inspect -f '{{.State.Status}} {{.State.Restarting}}' "$cid" 2>/dev/null || echo 'missing false')"
        status="${container_info%% *}"
        restarting="${container_info##* }"
    fi

    if [[ "$status" == "exited" || "$status" == "dead" || "$status" == "missing" || "$restarting" == "true" ]]; then
        log_error "SourceCred container failed early (State: $status, Restarting: $restarting)"
        $COMPOSE_CMD logs --tail=200 sourcecred || true
        exit 1
    fi

    # HTTP readiness: check config file via host-mapped port 6006
    if wget -qO- http://localhost:6006/config/weights.json >/dev/null 2>&1; then
        log_info "SourceCred is ready (weights.json reachable on port 6006)"
        exit 0
    fi

    sleep 2
done
