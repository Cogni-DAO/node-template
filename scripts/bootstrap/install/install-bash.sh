#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

# Module: scripts/bootstrap/install/install-bash.sh
# Purpose: Ensure Bash 4+ is on PATH. bootstrap.sh + provision-env-vm.sh use
#          associative arrays (declare -A) + mapfile, both Bash-4+ features.
#          macOS ships /bin/bash at 3.2 — without this installer, the bootstrap
#          fails opaquely 30+ lines into provision-env-vm.sh.
# Usage:   bash scripts/bootstrap/install/install-bash.sh
# Note:    Linux distros (Debian/Ubuntu/Alpine) usually ship Bash 5+ already.
#          The macOS path is the load-bearing one.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check what `bash` resolves to in the current PATH — NOT `/bin/bash`, which is
# the macOS 3.2 binary that's the whole problem. We need the FIRST `bash` in
# $PATH to be 4+.
current_bash=$(command -v bash || true)
if [[ -z "$current_bash" ]]; then
  log_error "No bash on PATH at all. That's unexpected; install bash via your package manager."
  exit 1
fi

current_major=$("$current_bash" -c 'echo ${BASH_VERSINFO[0]}')
if (( current_major >= 4 )); then
  log_info "bash on PATH is $($current_bash --version | head -1) at $current_bash"
  exit 0
fi

log_warn "bash on PATH is too old: $($current_bash --version | head -1) at $current_bash"

if [[ "$OSTYPE" == "darwin"* ]]; then
  if ! command -v brew >/dev/null 2>&1; then
    log_error "Homebrew not found. Install Homebrew first: https://brew.sh"
    exit 1
  fi
  log_info "Installing bash via Homebrew..."
  brew install bash

  brew_prefix=$(brew --prefix)
  installed_bash="${brew_prefix}/bin/bash"
  if [[ ! -x "$installed_bash" ]]; then
    log_error "Homebrew install reported success but $installed_bash is not executable."
    exit 1
  fi
  installed_major=$("$installed_bash" -c 'echo ${BASH_VERSINFO[0]}')
  if (( installed_major < 4 )); then
    log_error "Homebrew installed bash is still <4. Got: $($installed_bash --version | head -1)"
    exit 1
  fi
  log_info "Homebrew bash installed: $($installed_bash --version | head -1) at $installed_bash"

  # The system /bin/bash 3.2 still takes precedence unless ${brew_prefix}/bin
  # comes first in PATH. Tell the user explicitly — we can't mutate their
  # shell profile because we don't know which one they use.
  if ! command -v bash | grep -q "^${brew_prefix}/bin/"; then
    log_warn ""
    log_warn "PATH adjustment needed: ${brew_prefix}/bin must come before /bin"
    log_warn "Add this to your shell profile (~/.zshrc or ~/.bashrc):"
    log_warn ""
    log_warn "  export PATH=\"${brew_prefix}/bin:\$PATH\""
    log_warn ""
    log_warn "Then in your current shell:"
    log_warn ""
    log_warn "  export PATH=\"${brew_prefix}/bin:\$PATH\""
    log_warn "  hash -r"
    log_warn ""
    log_warn "Verify with: bash --version  (should report ${installed_major}.x)"
    exit 1
  fi

elif [[ -f /etc/debian_version ]]; then
  log_info "Updating bash via apt-get..."
  sudo apt-get update -qq
  sudo apt-get install -y bash

elif [[ -f /etc/alpine-release ]]; then
  log_info "Installing bash via apk..."
  apk add --no-cache bash

else
  log_error "Unsupported OS. Install Bash 4+ manually: https://www.gnu.org/software/bash/"
  exit 1
fi

# Final verification — bash on PATH must now be 4+.
final_bash=$(command -v bash)
final_major=$("$final_bash" -c 'echo ${BASH_VERSINFO[0]}')
if (( final_major < 4 )); then
  log_error "Install completed but bash on PATH is still <4 ($final_bash). PATH order is the issue."
  exit 1
fi
log_info "bash $($final_bash --version | head -1)"
log_info "Bash 4+ installation complete!"
