#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

check_command() {
    command -v "$1" >/dev/null 2>&1
}

# Install age — file/secret encryption tool. Used by sealed-secrets/sops
# on the deploy VM and by the bootstrap sequence for kubeconfig + age key
# stash on the operator's laptop. Binary is `age`; companion is `age-keygen`.
if [[ "$OSTYPE" == "darwin"* ]]; then
    if ! check_command brew; then
        log_warn "Homebrew not found. Please install Homebrew first."
        exit 1
    fi
    if ! check_command age; then
        log_info "Installing age via Homebrew..."
        brew install age
    fi
else
    # Linux: GHA ubuntu-latest does NOT ship age in the default image
    # (verified — the workflow's old 'present by default' comment was wrong).
    # apt is present on every supported Linux runner; use it.
    if ! check_command age; then
        log_info "Installing age via apt..."
        if [[ $EUID -ne 0 ]] && check_command sudo; then
            sudo apt-get update -qq
            sudo apt-get install -y age
        else
            apt-get update -qq
            apt-get install -y age
        fi
    fi
fi

if ! check_command age || ! check_command age-keygen; then
    log_warn "age install attempted but \`age\` or \`age-keygen\` is still missing."
    log_warn "Verify https://github.com/FiloSottile/age for your platform."
    exit 1
fi

log_info "✅ age installation complete: $(age --version 2>&1)"
