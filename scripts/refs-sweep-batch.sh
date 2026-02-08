#!/usr/bin/env bash
set -euo pipefail
cd /Users/derek/dev/cogni-template-refs-sweep

# Helper: replace repo-root-relative, internal-relative, and link titles for one doc
# Usage: sweep OLD_NAME new-path.md "Human Title" [excluded_ini_path...]
sweep() {
  local old="$1" new="$2" title="$3"
  shift 3
  local excludes=()
  for ex in "$@"; do
    excludes+=(! -path "*/${ex}*")
  done

  # Determine target dir from new path
  local target_dir
  if [[ "$new" == docs/guides/* ]]; then
    target_dir="guides"
  elif [[ "$new" == docs/spec/* ]]; then
    target_dir="spec"
  elif [[ "$new" == work/initiatives/* ]]; then
    target_dir="initiatives"
  else
    target_dir="spec"
  fi
  local basename
  basename=$(basename "$new")

  # Pass 1: repo-root-relative
  find . -type f \( -name '*.md' -o -name '*.ts' -o -name '*.tsx' \
    -o -name '*.mjs' -o -name '*.toml' -o -name '*.sh' -o -name '*.yaml' \) \
    ! -path '*/node_modules/*' ! -path '*/.next/*' ! -path '*/dist/*' \
    ! -path '*/wi.refs-sweep*' ! -path '*/wi.docs-migration-tracker*' \
    "${excludes[@]}" \
    -exec sed -i '' "s|docs/${old}|${new}|g" {} +

  # Pass 2: internal relative paths
  if [[ "$target_dir" == "spec" ]]; then
    find ./docs/spec -name '*.md' -exec sed -i '' "s|(${old})|(${basename})|g" {} +
    find ./docs/archive -name '*.md' -exec sed -i '' \
      -e "s|(${old})|(../spec/${basename})|g" \
      -e "s|(../${old})|(../spec/${basename})|g" {} +
    find ./docs/research -name '*.md' -exec sed -i '' \
      -e "s|(../${old})|(../spec/${basename})|g" \
      -e "s|(./${old})|(../spec/${basename})|g" {} +
  elif [[ "$target_dir" == "guides" ]]; then
    find ./docs/spec -name '*.md' -exec sed -i '' "s|(${old})|(../guides/${basename})|g" {} +
    find ./docs/archive -name '*.md' -exec sed -i '' \
      -e "s|(${old})|(../guides/${basename})|g" \
      -e "s|(../${old})|(../guides/${basename})|g" {} +
    find ./docs/research -name '*.md' -exec sed -i '' \
      -e "s|(../${old})|(../guides/${basename})|g" \
      -e "s|(./${old})|(../guides/${basename})|g" {} +
  fi

  # Pass 3: fix link titles
  find . -type f -name '*.md' ! -path '*/node_modules/*' \
    ! -path '*/wi.refs-sweep*' ! -path '*/wi.docs-migration-tracker*' \
    "${excludes[@]}" \
    -exec sed -i '' "s|\\[${old}\\]|[${title}]|g" {} +

  # Verify
  local remaining
  remaining=$(grep -rn "docs/${old}" --include='*.md' --include='*.ts' --include='*.tsx' \
    --include='*.mjs' --include='*.sh' --include='*.toml' --include='*.yaml' \
    2>/dev/null | grep -v 'wi.refs-sweep' | grep -v 'wi.docs-migration-tracker' | grep -v 'Source:' || true)
  if [[ -n "$remaining" ]]; then
    echo "  WARN: remaining refs for ${old}:"
    echo "$remaining"
  fi

  # Commit
  local commit_name
  commit_name=$(echo "$old" | sed 's/\.md//' | tr 'A-Z_' 'a-z-')
  git add -A
  if ! git diff --cached --quiet; then
    git commit -m "docs(refs): update ${commit_name} references to ${new}"
    echo "  COMMITTED: ${old} -> ${new}"
  else
    echo "  SKIP (no changes): ${old}"
  fi
}

echo "=== Starting mechanical refs sweep ==="

# --- No ini exclusions needed ---
sweep "DATABASES\.md"                   "docs/spec/databases.md"                  "Databases"
sweep "TOOLS_AUTHORING\.md"             "docs/guides/tools-authoring.md"          "Tools Authoring"
sweep "SERVICES_ARCHITECTURE\.md"       "docs/spec/services-architecture.md"      "Services Architecture"
sweep "MODEL_SELECTION\.md"             "docs/spec/model-selection.md"            "Model Selection"
sweep "AI_EVALS\.md"                    "docs/spec/ai-evals.md"                   "AI Evals"
sweep "EXTERNAL_EXECUTOR_BILLING\.md"   "docs/spec/external-executor-billing.md"  "External Executor Billing"
sweep "ERROR_HANDLING_ARCHITECTURE\.md" "docs/spec/error-handling.md"             "Error Handling Architecture"
sweep "DATABASE_URL_ALIGNMENT_SPEC\.md" "docs/spec/database-url-alignment.md"     "Database URL Alignment"
sweep "DAO_ENFORCEMENT\.md"             "docs/spec/dao-enforcement.md"            "DAO Enforcement"
sweep "BILLING_EVOLUTION\.md"           "docs/spec/billing-evolution.md"          "Billing Evolution"
sweep "SOURCECRED\.md"                  "docs/spec/sourcecred.md"                 "SourceCred"
sweep "SETUP\.md"                       "docs/guides/developer-setup.md"          "Developer Setup"
sweep "CHAIN_ACTION_FLOW_UI_SPEC\.md"   "docs/spec/chain-action-flow-ui.md"       "Chain Action Flow UI"
sweep "ALLOY_LOKI_SETUP\.md"            "docs/guides/alloy-loki-setup.md"         "Alloy Loki Setup"
sweep "AGENT_DISCOVERY\.md"             "docs/spec/agent-discovery.md"            "Agent Discovery"
sweep "ACCOUNTS_DESIGN\.md"             "docs/spec/accounts-design.md"            "Accounts Design"

# --- With ini exclusions (protect > Source: lines) ---
sweep "METRICS_OBSERVABILITY\.md"       "docs/spec/public-analytics.md"           "Public Analytics"           "ini.observability-hardening"
sweep "AGENT_REGISTRY_SPEC\.md"         "docs/spec/agent-registry.md"             "Agent Registry"             "ini.agent-registry"
sweep "PROMPT_REGISTRY_SPEC\.md"        "docs/spec/prompt-registry.md"            "Prompt Registry"            "ini.prompt-registry"
sweep "CRED_LICENSING_POLICY_SPEC\.md"  "docs/spec/cred-licensing-policy.md"      "Cred Licensing Policy"      "ini.cred-licensing"
sweep "OPENCLAW_SANDBOX_SPEC\.md"       "docs/spec/openclaw-sandbox-spec.md"      "OpenClaw Sandbox"           "ini.sandboxed-agents"
sweep "RBAC_SPEC\.md"                   "docs/spec/rbac.md"                       "RBAC"                       "ini.rbac-hardening"

# --- Remaining low-ref docs (check mapping) ---
sweep "OPENCLAW_SANDBOX_CONTROLS\.md"   "docs/spec/openclaw-sandbox-controls.md"  "OpenClaw Sandbox Controls"
sweep "CLAUDE_SDK_ADAPTER_SPEC\.md"     "docs/spec/claude-sdk-adapter.md"         "Claude SDK Adapter"
sweep "N8N_ADAPTER_SPEC\.md"            "docs/spec/n8n-adapter.md"                "n8n Adapter"
sweep "TENANT_CONNECTIONS_SPEC\.md"     "docs/spec/tenant-connections.md"          "Tenant Connections"
sweep "UNIFIED_GRAPH_LAUNCH_SPEC\.md"   "docs/spec/unified-graph-launch.md"       "Unified Graph Launch"
sweep "HUMAN_IN_THE_LOOP\.md"           "docs/spec/human-in-the-loop.md"          "Human in the Loop"
sweep "RUNTIME_POLICY\.md"              "docs/spec/runtime-policy.md"             "Runtime Policy"
sweep "SANDBOX_SCALING\.md"             "docs/spec/sandbox-scaling.md"            "Sandbox Scaling"
sweep "SYSTEM_TENANT_DESIGN\.md"        "docs/spec/system-tenant.md"              "System Tenant"
sweep "BUILD_ARCHITECTURE\.md"          "docs/spec/build-architecture.md"         "Build Architecture"
sweep "CI-CD\.md"                       "docs/spec/ci-cd.md"                      "CI/CD"
sweep "GIT_SYNC_REPO_MOUNT\.md"        "docs/spec/git-sync-repo-mount.md"        "Git Sync Repo Mount"
sweep "GOV_DATA_COLLECTORS\.md"         "docs/spec/gov-data-collectors.md"        "Gov Data Collectors"
sweep "INTEGRATION_WALLETS_CREDITS\.md" "docs/guides/wallet-auth-setup.md"        "Wallet Auth Setup"
sweep "NEW_PACKAGES\.md"                "docs/guides/new-packages.md"             "New Packages"
sweep "NODE_CI_CD_CONTRACT\.md"         "docs/spec/node-ci-cd-contract.md"        "Node CI/CD Contract"
sweep "OBSERVABILITY_REQUIRED_SPEC\.md" "docs/spec/observability-requirements.md" "Observability Requirements"
sweep "ACCOUNTS_API_KEY_ENDPOINTS\.md"  "docs/spec/accounts-api-endpoints.md"     "Accounts API Endpoints"
sweep "AGENT_DEVELOPMENT_GUIDE\.md"     "docs/guides/agent-development.md"        "Agent Development Guide"
sweep "AGENTS_CONTEXT\.md"              "docs/guides/agents-context.md"           "Agents Context"
sweep "SOURCECRED_CONFIG_RATIONALE\.md" "docs/spec/sourcecred-config-rationale.md" "SourceCred Config Rationale"
sweep "CHECK_FULL\.md"                  "docs/spec/check-full.md"                 "Check Full"
sweep "features/HEALTH_PROBES\.md"      "docs/spec/health-probes.md"              "Health Probes"

echo ""
echo "=== Mechanical sweep complete ==="
echo "Commits made:"
git log --oneline refactor/docs-ref-updates --not $(git merge-base refactor/docs-ref-updates staging) | head -60
