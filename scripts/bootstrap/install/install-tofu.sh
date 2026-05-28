#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

check_command() {
    if command -v "$1" >/dev/null 2>&1; then
        log_info "$1 is already installed"
        return 0
    else
        return 1
    fi
}

install_brew_package() {
    local package=$1
    if ! check_command "$package"; then
        log_info "Installing $package via Homebrew..."
        brew install "$package"
    fi
}

# Install OpenTofu. The binary is `tofu`, not `opentofu` — check by the
# binary name. The previous version checked `command -v opentofu` and
# silently exited 0 on Linux, leaving `command -v tofu` to fail at the
# next step of the workflow.
if [[ "$OSTYPE" == "darwin"* ]]; then
    if ! check_command brew; then
        log_warn "Homebrew not found. Please install Homebrew first."
        exit 1
    fi
    if ! check_command tofu; then
        log_info "Installing OpenTofu via Homebrew..."
        brew install opentofu
    fi
else
    # Linux (GHA runners + dev VMs): official OpenTofu standalone installer.
    # GHA ubuntu-latest runs as root → installs to /usr/local/bin cleanly.
    if ! check_command tofu; then
        log_info "Installing OpenTofu via official standalone installer..."
        TMP_INSTALLER=$(mktemp)
        curl --proto '=https' --tlsv1.2 -fsSL \
            https://get.opentofu.org/install-opentofu.sh -o "$TMP_INSTALLER"
        chmod +x "$TMP_INSTALLER"
        "$TMP_INSTALLER" --install-method standalone
        rm -f "$TMP_INSTALLER"
    fi
fi

if ! check_command tofu; then
    log_warn "OpenTofu install attempted but \`tofu\` is still not on PATH."
    log_warn "Verify https://opentofu.org/docs/intro/install/ for your platform."
    exit 1
fi

log_info "✅ OpenTofu installation complete: $(tofu version | head -n1)"