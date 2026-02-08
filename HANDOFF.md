# Handoff: Docs Reference Sweep (in progress)

## Goal

Replace all stale references to old `docs/UPPER_CASE_NAME.md` paths with the new typed paths (`docs/spec/`, `docs/guides/`, `work/initiatives/`). The doc content was migrated in prior PRs — this branch cleans up the ~560 references scattered across the codebase.

## Status: ~55% complete

- **Branch:** `refactor/docs-ref-updates` (off `staging`)
- **Worktree:** `/Users/derek/dev/cogni-template-refs-sweep` — use this, another dev works in the main tree
- **15 commits** on branch (15 high-ref-count docs done, ~340 refs fixed)
- **~220 stale refs remaining** across ~50 docs
- **Tracker Refs column not yet updated** — needs `[x]` for all completed docs

## What to Do

**Read `work/issues/wi.refs-sweep.md` § "Battle-Tested Process"** — it has the exact per-doc workflow with sed commands, 9 invariants, and gotchas learned from the first 15 migrations.

### Remaining mechanical docs (~35 docs, ~150 refs)

Sorted by ref count — these follow the standard process:

| Doc | New Path | Refs |
|-----|----------|------|
| STYLE.md | docs/spec/style.md | 10 |
| OBSERVABILITY.md | docs/spec/observability.md | 9 |
| FEATURE_DEVELOPMENT_GUIDE.md | docs/guides/feature-development.md | 9 |
| AUTHENTICATION.md | docs/spec/authentication.md | 9 |
| TEMPORAL_PATTERNS.md | docs/spec/temporal-patterns.md | 8 |
| LANGGRAPH_AI.md | docs/spec/langgraph-patterns.md | 7 |
| LANGGRAPH_SERVER.md | docs/spec/langgraph-server.md | 6 |
| AI_SETUP_SPEC.md | docs/spec/ai-setup.md | 6 |
| TESTING.md | docs/guides/testing.md | 5 |
| SYSTEM_TEST_ARCHITECTURE.md | docs/spec/system-test-architecture.md | 5 |
| NODE_VS_OPERATOR_CONTRACT.md | docs/spec/node-operator-contract.md | 5 |
| ENVIRONMENTS.md | docs/spec/environments.md | 5 |
| + ~23 more with 1-3 refs each | see wi.refs-sweep.md lines 160-204 | ~50 |

### Manual exclusions (~70 refs, need judgment)

| Doc | Issue | Refs |
|-----|-------|------|
| PAYMENTS_FRONTEND_DESIGN.md | Obsolete — remove links or redirect to payments-design spec | 17 |
| DEPAY_PAYMENTS.md | Archived — remove links or redirect to docs/archive/ | 12 |
| CHAIN_DEPLOYMENT_TECH_DEBT.md | Roadmap → `work/initiatives/ini.chain-deployment-refactor.md` | 8 |
| REPO_STATE.md | Snapshot → `docs/research/REPO_STATE.md` | 8 |
| LINTING_RULES.md | Snapshot → `docs/research/linting-rules.md` | 7 |
| SERVICES_MIGRATION.md | Roadmap → `work/initiatives/ini.cicd-services-gitops.md` | 3 |
| + 4 more with ~1 ref each | see exclusion table in wi.refs-sweep.md | ~4 |

### Final steps after all docs

1. Mark `[x]` in Refs column of `wi.docs-migration-tracker.md` for all completed docs
2. Run `pnpm check:docs` — must pass
3. Run validation grep (see wi.refs-sweep.md § Validation) — zero actionable results

## Completed Docs (15)

ARCHITECTURE, UI_IMPLEMENTATION_GUIDE, NODE_FORMATION_SPEC, SCHEDULER_SPEC, PAYMENTS_DESIGN, ACTIVITY_METRICS, ONCHAIN_READERS, DATABASE_RLS_SPEC, SANDBOXED_AGENTS, SECURITY_AUTH_SPEC, PACKAGES_ARCHITECTURE, COGNI_BRAIN_SPEC, GRAPH_EXECUTION, CHAIN_CONFIG, TOOL_USE_SPEC

## Key Files

| File | Role |
|------|------|
| `work/issues/wi.refs-sweep.md` | **The work item** — full process, sed commands, invariants, exclusion list |
| `work/issues/wi.docs-migration-tracker.md` | Source of truth — old→new mappings, Refs column tracks completion |
| `docs/spec/SPEC_INDEX.md` | Index of all migrated specs |

## Critical Invariants

- **ONE_COMMIT_PER_DOC** — each doc gets its own commit
- **PRESERVE_SOURCE_LINES** — `> Source: docs/OLD.md` in initiatives = provenance, don't touch
- **FIX_LINK_TITLES** — `[OLD_NAME.md]` → `[Human Readable Title]`
- **FIX_INTERNAL_REFS** — bare `(OLD.md)` refs inside docs/spec/ and docs/archive/ need separate sed passes
- **LOWERCASE_COMMIT_SUBJECT** — commitlint rejects uppercase in subject
- **USE_WORKTREE** — work in `/Users/derek/dev/cogni-template-refs-sweep`, another dev uses the main tree
