# Handoff: Docs Reference Sweep (complete)

## Goal

Replace all stale references to old `docs/UPPER_CASE_NAME.md` paths with the new typed paths (`docs/spec/`, `docs/guides/`, `work/initiatives/`). The doc content was migrated in prior PRs — this branch cleans up the ~560 references scattered across the codebase.

## Status: DONE

- **Branch:** `refactor/docs-ref-updates` (off `staging`)
- **Worktree:** `/Users/derek/dev/cogni-template-refs-sweep`
- **~70 commits** on branch — all mechanical + manual docs processed
- **~560 stale refs fixed** across ~97 docs
- **Tracker Refs column fully checked** — all rows marked `[x]`
- **`pnpm check:docs` passes**
- **Validation grep clean** — only 4 prose provenance mentions remain (invariant 8: SKIP_PROSE_MENTIONS)

## What Was Done

### Mechanical replacements (~50 docs)

All docs with straightforward old→new path mappings were replaced using the 3-pass sed process (repo-root-relative, internal-relative, link-title fix). One commit per doc.

### Manual exclusions (12 docs)

| Doc                           | Action Taken                                                    |
| ----------------------------- | --------------------------------------------------------------- |
| PAYMENTS_FRONTEND_DESIGN.md   | Redirected to docs/spec/payments-design.md (obsolete)           |
| DEPAY_PAYMENTS.md             | Redirected to docs/spec/payments-design.md (archived)           |
| CHAIN_DEPLOYMENT_TECH_DEBT.md | Redirected to work/initiatives/ini.chain-deployment-refactor.md |
| REPO_STATE.md                 | Redirected to docs/research/REPO_STATE.md                       |
| LINTING_RULES.md              | Redirected to docs/research/LINTING_RULES.md                    |
| SERVICES_MIGRATION.md         | Redirected to work/initiatives/ini.cicd-services-gitops.md      |
| UI_CLEANUP_PLAN.md            | Redirected eslint refs to docs/spec/ui-implementation.md        |
| MVP_DELIVERABLES.md           | Redirected to docs/archive/MVP_DELIVERABLES.md                  |
| DOCS_ORGANIZATION_PLAN.md     | Redirected AGENTS.md ref to docs/archive/                       |
| COMPLETION_REFACTOR_PLAN.md   | Redirected Links to docs/archive/                               |
| PAYMENTS_TEST_DESIGN.md       | Redirected to docs/spec/payments-design.md                      |
| DEPLOYMENT_PLAN.md            | Removed broken link from platform/AGENTS.md                     |

### Remaining acceptable refs (not actionable)

- 4 prose provenance mentions in initiative files (invariant 8)
- 3 refs to `docs/PAYMENTS_PONDER_VERIFICATION.md` inside `docs/archive/DEPAY_PAYMENTS.md` (archive-internal)
- 1 `BIOME_MIGRATION_DECISIONS.md` prose mention in research doc
- `docs/README.md` refs (valid file, not stale)

## Next Steps for PR

1. Review the commit log — clean one-commit-per-doc history
2. Consider squashing into fewer commits if preferred for merge
3. PR against `staging`
