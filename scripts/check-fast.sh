#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

# Module: scripts/check-fast.sh
# Purpose: Runs all quality checks (typecheck, lint, format, test, docs) to completion,
#          never stopping at first failure. Provides structured output with timing,
#          visual separation, and summary reporting optimized for AI developer workflows.
# Usage: pnpm check      # Read-only validation
#        pnpm check:fix  # Run with auto-fixers
#        Direct: bash scripts/check-fast.sh [--fix]
# Exit: 0 if all checks pass, 1 if any check fails
# Shell options:
#   - set +e: Disables fail-fast to ensure all checks run
#   - set -o pipefail: Catches failures in piped commands
#   - set -u: Treats unbound variables as errors
# Side-effects: None in default mode; --fix mode modifies files via ESLint and Prettier
# Links: docs/spec/style.md, AGENTS.md, package.json:41-42

set +e
set -o pipefail
set -u

EXIT_CODE=0
FAILED_CHECKS=()
FIX_MODE=false

# Parse arguments
if [ "${1:-}" = "--fix" ]; then
  FIX_MODE=true
fi

run_check() {
  local name=$1
  local command=$2
  local start=$(date +%s)

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Running $name..."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  if eval "$command"; then
    local duration=$(($(date +%s) - start))
    echo ""
    echo "✓ $name passed (${duration}s)"
  else
    EXIT_CODE=1
    local duration=$(($(date +%s) - start))
    FAILED_CHECKS+=("$name (${duration}s)")
    echo ""
    echo "✗ $name failed (${duration}s)"
  fi
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$FIX_MODE" = true ]; then
  echo "Starting checks with auto-fix..."
else
  echo "Starting checks..."
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

run_check "packages:build" "pnpm packages:build > /dev/null"
run_check "typecheck" "pnpm typecheck"

if [ "$FIX_MODE" = true ]; then
  run_check "lint" "pnpm lint:fix"
  run_check "format" "pnpm format"
else
  run_check "lint" "pnpm lint"
  run_check "format" "pnpm format:check"
fi

run_check "ui-tokens" "bash scripts/check-ui-tokens.sh"

# Detect constrained containers (e.g. Claude Code remote) where ulimit -i 0
# prevents the forks pool from running large test suites. The root vitest.config.mts
# switches to vmThreads automatically, but contract tests need forks because
# next-test-api-route-handler is incompatible with VM contexts.
# Contract tests (27 files) are small enough that forks completes before hanging.
CONSTRAINED=false
ULIMIT_I=$(ulimit -i 2>/dev/null || echo "unlimited")
if [ "$ULIMIT_I" != "unlimited" ] && [ "$ULIMIT_I" -lt 128 ] 2>/dev/null; then
  CONSTRAINED=true
fi

if [ "$CONSTRAINED" = true ]; then
  # vmThreads: exclude DOM-env tests (happy-dom/jsdom) that have module isolation
  # issues in VM contexts, then run them separately with forks pool.
  run_check "test:unit" "pnpm vitest run tests/unit tests/ports --exclude '**/*.spec.tsx' --exclude '**/model-preference.test.ts'"
  run_check "test:unit:dom" "pnpm vitest run --pool=forks tests/unit/app/chat-page-no-hardcoded-models.spec.tsx tests/unit/app/chat-page-zero-credits.spec.tsx tests/unit/features/ai/preferences/model-preference.test.ts tests/unit/features/payments/hooks/useCreditsSummary.spec.tsx tests/unit/features/treasury/components/TreasuryBadge.spec.tsx tests/unit/app/app-layout-auth-guard.test.tsx"
  run_check "test:contract" "pnpm vitest run --pool=forks tests/contract"
else
  run_check "test:unit" "pnpm test:unit"
  run_check "test:contract" "pnpm test:contract"
fi

run_check "test:meta" "pnpm test:meta"
run_check "test:packages:local" "pnpm test:packages:local"
run_check "test:packages:integration" "pnpm test:packages:integration"
run_check "test:services:local" "pnpm test:services:local"
run_check "check:docs" "pnpm check:docs"
run_check "check:root-layout" "pnpm check:root-layout"
run_check "arch:check" "pnpm arch:check"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "SUMMARY"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ${#FAILED_CHECKS[@]} -eq 0 ]; then
  echo "✓ All checks passed!"
else
  echo "✗ ${#FAILED_CHECKS[@]} check(s) failed:"
  for check in "${FAILED_CHECKS[@]}"; do
    echo "  - $check"
  done
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

exit $EXIT_CODE
