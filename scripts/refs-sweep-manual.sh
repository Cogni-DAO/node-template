#!/usr/bin/env bash
set -euo pipefail
cd /Users/derek/dev/cogni-template-refs-sweep

commit_doc() {
  local msg="$1"
  git add -A
  if ! git diff --cached --quiet; then
    git commit -m "$msg"
    echo "  COMMITTED: $msg"
  else
    echo "  SKIP (no changes): $msg"
  fi
}

echo "=== Manual exclusions ==="

# -------------------------------------------------------
# 1. PAYMENTS_FRONTEND_DESIGN.md (obsolete → payments-design spec)
# -------------------------------------------------------
echo "--- PAYMENTS_FRONTEND_DESIGN.md ---"

# Redirect all docs/PAYMENTS_FRONTEND_DESIGN.md → docs/spec/payments-design.md
find . -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.mjs' \) \
  ! -path '*/node_modules/*' ! -path '*/.next/*' ! -path '*/dist/*' \
  -exec sed -i '' 's|docs/PAYMENTS_FRONTEND_DESIGN\.md|docs/spec/payments-design.md|g' {} +

# AGENTS.md link in payments component
find . -name 'AGENTS.md' \
  -exec sed -i '' 's|docs/PAYMENTS_FRONTEND_DESIGN\.md|docs/spec/payments-design.md|g' {} +

# Fix link titles
find . -type f -name '*.md' ! -path '*/node_modules/*' \
  ! -path '*/wi.refs-sweep*' ! -path '*/wi.docs-migration-tracker*' \
  -exec sed -i '' 's|\[Payments Frontend Design\]|[Payments Design]|g' {} +
find . -type f -name '*.md' ! -path '*/node_modules/*' \
  ! -path '*/wi.refs-sweep*' ! -path '*/wi.docs-migration-tracker*' \
  -exec sed -i '' 's|\[PAYMENTS_FRONTEND_DESIGN\.md\]|[Payments Design]|g' {} +

# Archive-internal refs (inside DEPAY_PAYMENTS.md, PAYMENTS_FRONTEND_DESIGN.md)
# These reference each other inside docs/archive/ — redirect to spec
find ./docs/archive -name '*.md' -exec sed -i '' \
  -e 's|(PAYMENTS_FRONTEND_DESIGN\.md)|(../spec/payments-design.md)|g' \
  -e 's|(../PAYMENTS_FRONTEND_DESIGN\.md)|(../spec/payments-design.md)|g' \
  -e 's|docs/PAYMENTS_FRONTEND_DESIGN\.md|docs/spec/payments-design.md|g' {} +

commit_doc "docs(refs): redirect obsolete payments-frontend-design references to docs/spec/payments-design.md"

# -------------------------------------------------------
# 2. DEPAY_PAYMENTS.md (archived → remove or redirect)
# -------------------------------------------------------
echo "--- DEPAY_PAYMENTS.md ---"

# Check what refs exist
# Most DEPAY refs are inside docs/archive/ (self-referential). For external refs,
# redirect to payments-design spec. For archive-internal, leave or fix relative paths.
find . -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.mjs' \) \
  ! -path '*/node_modules/*' ! -path '*/.next/*' ! -path '*/dist/*' \
  -exec sed -i '' 's|docs/DEPAY_PAYMENTS\.md|docs/spec/payments-design.md|g' {} +

find . -name 'AGENTS.md' \
  -exec sed -i '' 's|docs/DEPAY_PAYMENTS\.md|docs/spec/payments-design.md|g' {} +

# Fix markdown refs outside archive
find . -type f -name '*.md' ! -path '*/node_modules/*' \
  ! -path '*/wi.refs-sweep*' ! -path '*/wi.docs-migration-tracker*' \
  ! -path '*/docs/archive/*' \
  -exec sed -i '' 's|docs/DEPAY_PAYMENTS\.md|docs/spec/payments-design.md|g' {} +

find . -type f -name '*.md' ! -path '*/node_modules/*' \
  ! -path '*/wi.refs-sweep*' ! -path '*/wi.docs-migration-tracker*' \
  -exec sed -i '' 's|\[DEPAY_PAYMENTS\.md\]|[Payments Design]|g' {} +

# Archive-internal: fix relative paths to point to spec
find ./docs/archive -name '*.md' -exec sed -i '' \
  -e 's|(DEPAY_PAYMENTS\.md)|(../spec/payments-design.md)|g' \
  -e 's|(../DEPAY_PAYMENTS\.md)|(../spec/payments-design.md)|g' \
  -e 's|docs/DEPAY_PAYMENTS\.md|docs/spec/payments-design.md|g' {} +

commit_doc "docs(refs): redirect archived depay-payments references to docs/spec/payments-design.md"

# -------------------------------------------------------
# 3. CHAIN_DEPLOYMENT_TECH_DEBT.md (roadmap → initiative)
# -------------------------------------------------------
echo "--- CHAIN_DEPLOYMENT_TECH_DEBT.md ---"

# Code Links comments → spec doesn't exist, point to the initiative
find . -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.mjs' \) \
  ! -path '*/node_modules/*' ! -path '*/.next/*' ! -path '*/dist/*' \
  -exec sed -i '' 's|docs/CHAIN_DEPLOYMENT_TECH_DEBT\.md|work/initiatives/ini.chain-deployment-refactor.md|g' {} +

# AGENTS.md and markdown refs
find . -type f -name '*.md' ! -path '*/node_modules/*' \
  ! -path '*/wi.refs-sweep*' ! -path '*/wi.docs-migration-tracker*' \
  ! -path '*/docs/archive/*' \
  -exec sed -i '' 's|docs/CHAIN_DEPLOYMENT_TECH_DEBT\.md|work/initiatives/ini.chain-deployment-refactor.md|g' {} +

find . -type f -name '*.md' ! -path '*/node_modules/*' \
  ! -path '*/wi.refs-sweep*' ! -path '*/wi.docs-migration-tracker*' \
  -exec sed -i '' 's|\[CHAIN_DEPLOYMENT_TECH_DEBT\.md\]|[Chain Deployment Refactor]|g' {} +

# Archive-internal
find ./docs/archive -name '*.md' -exec sed -i '' \
  -e 's|(CHAIN_DEPLOYMENT_TECH_DEBT\.md)|(../../work/initiatives/ini.chain-deployment-refactor.md)|g' \
  -e 's|(../CHAIN_DEPLOYMENT_TECH_DEBT\.md)|(../../work/initiatives/ini.chain-deployment-refactor.md)|g' \
  -e 's|docs/CHAIN_DEPLOYMENT_TECH_DEBT\.md|work/initiatives/ini.chain-deployment-refactor.md|g' {} +

# Spec-internal
find ./docs/spec -name '*.md' -exec sed -i '' \
  's|(CHAIN_DEPLOYMENT_TECH_DEBT\.md)|(../../work/initiatives/ini.chain-deployment-refactor.md)|g' {} +

commit_doc "docs(refs): redirect chain-deployment-tech-debt references to work/initiatives/ini.chain-deployment-refactor.md"

# -------------------------------------------------------
# 4. REPO_STATE.md (snapshot → docs/research/)
# -------------------------------------------------------
echo "--- REPO_STATE.md ---"

find . -type f \( -name '*.md' -o -name '*.ts' -o -name '*.tsx' -o -name '*.mjs' \
  -o -name '*.sh' -o -name '*.toml' -o -name '*.yaml' \) \
  ! -path '*/node_modules/*' ! -path '*/.next/*' ! -path '*/dist/*' \
  ! -path '*/wi.refs-sweep*' ! -path '*/wi.docs-migration-tracker*' \
  ! -path '*/docs/archive/*' ! -path '*/docs/research/*' \
  -exec sed -i '' 's|docs/REPO_STATE\.md|docs/research/REPO_STATE.md|g' {} +

find ./docs/archive -name '*.md' -exec sed -i '' \
  -e 's|(REPO_STATE\.md)|(../research/REPO_STATE.md)|g' \
  -e 's|(../REPO_STATE\.md)|(../research/REPO_STATE.md)|g' \
  -e 's|docs/REPO_STATE\.md|docs/research/REPO_STATE.md|g' {} +

find ./docs/spec -name '*.md' -exec sed -i '' \
  's|(REPO_STATE\.md)|(../research/REPO_STATE.md)|g' {} +

find . -type f -name '*.md' ! -path '*/node_modules/*' \
  ! -path '*/wi.refs-sweep*' ! -path '*/wi.docs-migration-tracker*' \
  -exec sed -i '' 's|\[REPO_STATE\.md\]|[Repo State]|g' {} +

commit_doc "docs(refs): redirect repo-state references to docs/research/REPO_STATE.md"

# -------------------------------------------------------
# 5. LINTING_RULES.md (snapshot → docs/research/)
# -------------------------------------------------------
echo "--- LINTING_RULES.md ---"

find . -type f \( -name '*.md' -o -name '*.ts' -o -name '*.tsx' -o -name '*.mjs' \
  -o -name '*.sh' -o -name '*.toml' -o -name '*.yaml' \) \
  ! -path '*/node_modules/*' ! -path '*/.next/*' ! -path '*/dist/*' \
  ! -path '*/wi.refs-sweep*' ! -path '*/wi.docs-migration-tracker*' \
  ! -path '*/docs/research/*' \
  -exec sed -i '' 's|docs/LINTING_RULES\.md|docs/research/LINTING_RULES.md|g' {} +

find ./docs/archive -name '*.md' -exec sed -i '' \
  -e 's|(LINTING_RULES\.md)|(../research/LINTING_RULES.md)|g' \
  -e 's|(../LINTING_RULES\.md)|(../research/LINTING_RULES.md)|g' {} +

find ./docs/spec -name '*.md' -exec sed -i '' \
  's|(LINTING_RULES\.md)|(../research/LINTING_RULES.md)|g' {} +

find . -type f -name '*.md' ! -path '*/node_modules/*' \
  ! -path '*/wi.refs-sweep*' ! -path '*/wi.docs-migration-tracker*' \
  -exec sed -i '' 's|\[LINTING_RULES\.md\]|[Linting Rules]|g' {} +

commit_doc "docs(refs): redirect linting-rules references to docs/research/LINTING_RULES.md"

# -------------------------------------------------------
# 6. SERVICES_MIGRATION.md (roadmap → initiative)
# -------------------------------------------------------
echo "--- SERVICES_MIGRATION.md ---"

find . -type f \( -name '*.md' -o -name '*.ts' -o -name '*.tsx' -o -name '*.mjs' \
  -o -name '*.sh' -o -name '*.toml' -o -name '*.yaml' \) \
  ! -path '*/node_modules/*' ! -path '*/.next/*' ! -path '*/dist/*' \
  ! -path '*/wi.refs-sweep*' ! -path '*/wi.docs-migration-tracker*' \
  ! -path '*/docs/archive/*' \
  -exec sed -i '' 's|docs/SERVICES_MIGRATION\.md|work/initiatives/ini.cicd-services-gitops.md|g' {} +

find ./docs/archive -name '*.md' -exec sed -i '' \
  -e 's|(SERVICES_MIGRATION\.md)|(../../work/initiatives/ini.cicd-services-gitops.md)|g' \
  -e 's|(../SERVICES_MIGRATION\.md)|(../../work/initiatives/ini.cicd-services-gitops.md)|g' \
  -e 's|docs/SERVICES_MIGRATION\.md|work/initiatives/ini.cicd-services-gitops.md|g' {} +

find . -type f -name '*.md' ! -path '*/node_modules/*' \
  ! -path '*/wi.refs-sweep*' ! -path '*/wi.docs-migration-tracker*' \
  -exec sed -i '' 's|\[SERVICES_MIGRATION\.md\]|[Services Migration]|g' {} +

commit_doc "docs(refs): redirect services-migration references to work/initiatives/ini.cicd-services-gitops.md"

# -------------------------------------------------------
# 7. Additional cleanup: UI_CLEANUP_PLAN.md (obsolete)
# -------------------------------------------------------
echo "--- UI_CLEANUP_PLAN.md ---"

# eslint config refs — redirect to ui-implementation spec
find . -type f -name '*.mjs' ! -path '*/node_modules/*' \
  -exec sed -i '' 's|docs/UI_CLEANUP_PLAN\.md|docs/spec/ui-implementation.md|g' {} +

# Archive-internal refs — leave as-is (historical context)

commit_doc "docs(refs): redirect obsolete ui-cleanup-plan references to docs/spec/ui-implementation.md"

# -------------------------------------------------------
# 8. MVP_DELIVERABLES.md (snapshot — update ROADMAP + AGENTS)
# -------------------------------------------------------
echo "--- MVP_DELIVERABLES.md ---"

# MVP_DELIVERABLES.md is a snapshot — file is at docs/MVP_DELIVERABLES.md still
# Check if it moved to archive
if [ -f "./docs/archive/MVP_DELIVERABLES.md" ]; then
  find . -type f -name '*.md' ! -path '*/node_modules/*' \
    ! -path '*/wi.refs-sweep*' ! -path '*/wi.docs-migration-tracker*' \
    ! -path '*/docs/archive/*' \
    -exec sed -i '' 's|docs/MVP_DELIVERABLES\.md|docs/archive/MVP_DELIVERABLES.md|g' {} +
  commit_doc "docs(refs): redirect mvp-deliverables references to docs/archive/MVP_DELIVERABLES.md"
elif [ -f "./docs/MVP_DELIVERABLES.md" ]; then
  echo "  MVP_DELIVERABLES.md still at docs/ — no redirect needed (not yet archived)"
else
  echo "  MVP_DELIVERABLES.md missing — removing broken links"
  # Remove from AGENTS.md and ROADMAP.md
  find . -type f -name '*.md' ! -path '*/node_modules/*' \
    ! -path '*/wi.refs-sweep*' ! -path '*/wi.docs-migration-tracker*' \
    -exec sed -i '' '/MVP_DELIVERABLES\.md/d' {} +
  commit_doc "docs(refs): remove broken mvp-deliverables references"
fi

# -------------------------------------------------------
# 9. DOCS_ORGANIZATION_PLAN.md (snapshot → archive)
# -------------------------------------------------------
echo "--- DOCS_ORGANIZATION_PLAN.md ---"

if [ -f "./docs/archive/DOCS_ORGANIZATION_PLAN.md" ]; then
  # Update AGENTS.md ref only (the other 2 are inside the archive file itself)
  sed -i '' 's|docs/DOCS_ORGANIZATION_PLAN\.md|docs/archive/DOCS_ORGANIZATION_PLAN.md|g' ./AGENTS.md
  commit_doc "docs(refs): redirect docs-organization-plan reference to docs/archive/"
elif [ -f "./docs/DOCS_ORGANIZATION_PLAN.md" ]; then
  echo "  DOCS_ORGANIZATION_PLAN.md still at docs/ — not yet archived"
fi

# -------------------------------------------------------
# 10. COMPLETION_REFACTOR_PLAN.md (obsolete — in archive)
# -------------------------------------------------------
echo "--- COMPLETION_REFACTOR_PLAN.md ---"

# Links: comments in TS files → point to archive since no spec exists
find . -type f \( -name '*.ts' -o -name '*.tsx' \) \
  ! -path '*/node_modules/*' ! -path '*/.next/*' ! -path '*/dist/*' \
  -exec sed -i '' 's|docs/COMPLETION_REFACTOR_PLAN\.md|docs/archive/COMPLETION_REFACTOR_PLAN.md|g' {} +

# Archive internal
find ./docs/archive -name '*.md' -exec sed -i '' \
  's|(COMPLETION_REFACTOR_PLAN\.md)|(COMPLETION_REFACTOR_PLAN.md)|g' {} +

commit_doc "docs(refs): redirect completion-refactor-plan references to docs/archive/"

# -------------------------------------------------------
# 11. PAYMENTS_TEST_DESIGN.md (obsolete — redirect Links)
# -------------------------------------------------------
echo "--- PAYMENTS_TEST_DESIGN.md ---"

find . -type f \( -name '*.ts' -o -name '*.tsx' \) \
  ! -path '*/node_modules/*' ! -path '*/.next/*' ! -path '*/dist/*' \
  -exec sed -i '' 's|docs/PAYMENTS_TEST_DESIGN\.md|docs/spec/payments-design.md|g' {} +

commit_doc "docs(refs): redirect obsolete payments-test-design to docs/spec/payments-design.md"

# -------------------------------------------------------
# 12. DEPLOYMENT_PLAN.md (check location)
# -------------------------------------------------------
echo "--- DEPLOYMENT_PLAN.md ---"

if [ -f "./docs/archive/DEPLOYMENT_PLAN.md" ]; then
  sed -i '' 's|docs/DEPLOYMENT_PLAN\.md|docs/archive/DEPLOYMENT_PLAN.md|g' ./platform/AGENTS.md
  commit_doc "docs(refs): redirect deployment-plan reference to docs/archive/"
elif [ -f "./docs/DEPLOYMENT_PLAN.md" ]; then
  echo "  DEPLOYMENT_PLAN.md still at docs/ — not yet archived"
else
  echo "  DEPLOYMENT_PLAN.md missing — will remove broken link"
  sed -i '' '/DEPLOYMENT_PLAN\.md/d' ./platform/AGENTS.md
  commit_doc "docs(refs): remove broken deployment-plan reference from platform/AGENTS.md"
fi

# -------------------------------------------------------
# 13. PAYMENTS_PONDER_VERIFICATION.md — all refs inside
#     docs/archive/DEPAY_PAYMENTS.md. Historical. Leave.
# -------------------------------------------------------
echo "--- PAYMENTS_PONDER_VERIFICATION.md ---"
echo "  All refs inside archive/DEPAY_PAYMENTS.md — historical, leaving as-is"

# -------------------------------------------------------
# 14. BIOME_MIGRATION_DECISIONS.md — 1 ref in research/
#     LINTING_RULES.md. Prose mention. Leave.
# -------------------------------------------------------
echo "--- BIOME_MIGRATION_DECISIONS.md ---"
echo "  Prose mention in research doc — leaving as-is"

echo ""
echo "=== Manual exclusions complete ==="
echo "Commits since batch sweep:"
git log --oneline -20
