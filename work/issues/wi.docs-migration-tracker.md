---
work_item_id: wi.docs-migration-tracker
work_item_type: issue
title: Docs Migration Tracker
state: In Progress
priority: 0
estimate: 4
summary: Track migration of 97 legacy docs to typed structure with YAML frontmatter
outcome: All docs classified, migrated to typed directories, references updated
spec_refs: docs/spec/spec-project-lifecycle.md, docs/spec/docs-work-system.md
assignees: derekg1729
initiative: ini.docs-system-infrastructure
created: 2026-02-05
updated: 2026-02-06
labels: [docs, migration]
pr:
external_refs:
---

# Docs Migration Tracker

## Execution Checklist

### Pre-Migration Tasks (Done)

**Template Design (Obsidian YAML v0):**

- [x] Define v0 template: `docs/_templates/spec.md`
- [x] Define v0 template: `docs/_templates/guide.md`
- [x] Define v0 template: `docs/_templates/decision.md`
- [x] Define v0 template: `work/_templates/initiative.md`
- [x] Define v0 template: `work/_templates/issue.md`

**Validator Updates:**

- [x] Add `yaml` dev dependency for proper YAML parsing
- [x] Rewrite `scripts/validate-docs-metadata.mjs` with new rules (dir→type match, required keys, enums, date format, uniqueness, field set separation)
- [x] Convert 9 already-migrated specs from Logseq `key::` to YAML frontmatter

**Specs & Structure:**

- [x] Create `docs/spec/development-lifecycle.md` and `docs/spec/docs-work-system.md`
- [x] Sort SPEC_INDEX by domain→state→id
- [x] Create `work/initiatives/` and `work/issues/` directories
- [x] Classify all 97 legacy docs (this table)

### Next Steps

- [ ] Add `## Schema` section to spec template (all existing specs use it)
- [ ] Strip roadmap content from `docs/spec/scheduler.md` (has P1/P2/P3 checklist)
- [ ] Strip roadmap content from `docs/spec/rbac.md` (has P0/P1/P2 checklist)
- [ ] Proof-of-concept: migrate GRAPH_EXECUTION.md (split → spec + initiative)
- [ ] Update `docs/README.md` schema section to match new format

### Post-Migration Tasks

- [ ] Create redirect stubs at all original locations (9 already-migrated need stubs)
- [ ] Update SPEC_INDEX.md with each newly migrated spec
- [ ] Update root AGENTS.md pointers
- [ ] Verify `pnpm check:docs` passes after each batch

## Frontmatter Schema (v0)

```yaml
---
id: kebab-case-unique-id
type: spec
title: Document Title
status: active
spec_state: proposed
trust: draft
summary: One-line description
read_when: When to read this doc
implements: wi.work-item-id
owner: derekg1729
created: 2026-02-05
verified: 2026-02-05
tags: [optional]
---
```

## Migration Checklist

### Content State Legend

| Tag                  | Meaning                                                        |
| -------------------- | -------------------------------------------------------------- |
| `already migrated`   | Content moved to `docs/spec/`; original needs redirect stub    |
| `as-built`           | Describes implemented code; clean migration                    |
| `as-built + roadmap` | Mixed: as-built invariants + P1/P2 checklists; needs 1:N split |
| `roadmap`            | Primarily future/planned work; becomes initiative              |
| `procedural`         | Howto / setup steps; becomes guide                             |
| `snapshot`           | Point-in-time assessment; may be stale                         |
| `obsolete`           | Superseded or historical; archive or delete                    |

### Already Migrated (need redirect stubs only)

| Original            | Destination           | Migrated | Content State                                        |
| ------------------- | --------------------- | :------: | ---------------------------------------------------- |
| AI_SETUP_SPEC.md    | spec/ai-setup.md      |   [x]    | already migrated                                     |
| ARCHITECTURE.md     | spec/architecture.md  |   [x]    | already migrated                                     |
| CI-CD.md            | spec/ci-cd.md         |   [x]    | already migrated                                     |
| COGNI_BRAIN_SPEC.md | spec/cogni-brain.md   |   [x]    | already migrated                                     |
| DATABASES.md        | spec/databases.md     |   [x]    | already migrated                                     |
| OBSERVABILITY.md    | spec/observability.md |   [x]    | already migrated                                     |
| RBAC_SPEC.md        | spec/rbac.md          |   [x]    | already migrated; spec has P0/P1/P2 roadmap to strip |
| SCHEDULER_SPEC.md   | spec/scheduler.md     |   [x]    | already migrated; spec has P1/P2/P3 roadmap to strip |
| STYLE.md            | spec/style.md         |   [x]    | already migrated                                     |

### Specs (37 docs)

| Original                       | Destination                                      | Migrated | Content State      | Notes                                                                             |
| ------------------------------ | ------------------------------------------------ | :------: | ------------------ | --------------------------------------------------------------------------------- |
| ACCOUNTS_API_KEY_ENDPOINTS.md  | spec/accounts-api-key-endpoints.md               |   [ ]    | as-built           | LiteLLM endpoint usage, MVP master key mode                                       |
| ACCOUNTS_DESIGN.md             | spec/accounts-design.md                          |   [ ]    | as-built           | Billing model, identity mapping, account-to-key                                   |
| ACTIVITY_METRICS.md            | spec/activity-metrics.md                         |   [ ]    | as-built           | Data flow, LiteLLM as source, charge receipt schema                               |
| AGENT_DISCOVERY.md             | spec/agent-discovery.md                          |   [ ]    | as-built           | Agent catalog port, discovery pipeline                                            |
| AGENT_REGISTRY_SPEC.md         | spec/agent-registry.md                           |   [ ]    | as-built           | Offchain registry, agent identity, registration                                   |
| AI_EVALS.md                    | spec/ai-evals.md                                 |   [ ]    | as-built           | Eval structure, golden outputs, test harness                                      |
| AI_GOVERNANCE_DATA.md          | spec/ai-governance-data.md                       |   [ ]    | as-built           | Signal ingestion, brief generation, temporal patterns                             |
| AUTHENTICATION.md              | spec/authentication.md                           |   [ ]    | as-built + roadmap | SIWE flow + UX evolution plan                                                     |
| BILLING_EVOLUTION.md           | spec/billing-evolution.md                        |   [ ]    | as-built           | Dual-cost accounting, charge receipt schema                                       |
| CHAIN_ACTION_FLOW_UI_SPEC.md   | spec/chain-action-flow-ui.md                     |   [ ]    | as-built           | Reusable step visualization component API                                         |
| CHAIN_CONFIG.md                | spec/chain-config.md                             |   [ ]    | as-built           | Repo-spec as source of truth, chain alignment                                     |
| CLAUDE_SDK_ADAPTER_SPEC.md     | spec/claude-sdk-adapter.md                       |   [ ]    | as-built           | In-process billing, MCP tool bridging                                             |
| CLAWDBOT_ADAPTER_SPEC.md       | spec/clawdbot-adapter.md                         |   [ ]    | as-built           | Internal executor, DAO workspace, header billing                                  |
| CRED_LICENSING_POLICY_SPEC.md  | spec/cred-licensing-policy.md                    |   [ ]    | as-built           | PolyForm Shield, enrollment-gated federation                                      |
| DAO_ENFORCEMENT.md             | spec/dao-enforcement.md                          |   [ ]    | as-built           | DAO-owned payment loop, repo-spec enforcement                                     |
| DATABASE_RLS_SPEC.md           | spec/database-rls.md                             |   [ ]    | as-built + roadmap | RLS invariants done; P1 hardening pending                                         |
| DATABASE_URL_ALIGNMENT_SPEC.md | spec/database-url-alignment.md                   |   [ ]    | as-built           | DSN configuration, role isolation, trust boundaries                               |
| ERROR_HANDLING_ARCHITECTURE.md | spec/error-handling-architecture.md              |   [ ]    | as-built           | Layered error translation pattern                                                 |
| EXTERNAL_EXECUTOR_BILLING.md   | spec/external-executor-billing.md                |   [ ]    | as-built           | Async reconciliation, correlation keys, usage facts                               |
| GOV_DATA_COLLECTORS.md         | spec/governance-data-collectors.md               |   [ ]    | as-built           | SourceAdapters, CloudEvents, collector types                                      |
| GRAPH_EXECUTION.md             | spec/graph-execution.md + ini.graph-execution.md |   [ ]    | as-built + roadmap | 1023 lines; split: invariants 1-47 + schema → spec; P1/P2 checklists → initiative |
| HUMAN_IN_THE_LOOP.md           | spec/human-in-the-loop.md                        |   [ ]    | as-built + roadmap | Pause/resume contract + implementation checklist                                  |
| LANGGRAPH_SERVER.md            | spec/langgraph-server.md                         |   [ ]    | as-built + roadmap | MVP invariants done; P1 docker not started                                        |
| N8N_ADAPTER_SPEC.md            | spec/n8n-adapter.md                              |   [ ]    | as-built           | n8n workflow adapter billing contract                                             |
| NODE_CI_CD_CONTRACT.md         | spec/node-ci-cd-contract.md                      |   [ ]    | as-built + roadmap | Node sovereignty invariants + update flow phases                                  |
| NODE_FORMATION_SPEC.md         | spec/node-formation.md                           |   [ ]    | as-built           | DAO formation invariants, Aragon token                                            |
| NODE_VS_OPERATOR_CONTRACT.md   | spec/node-vs-operator-contract.md                |   [ ]    | as-built           | Node vs Operator boundaries, sovereignty guarantees                               |
| OBSERVABILITY_REQUIRED_SPEC.md | spec/observability-required.md                   |   [ ]    | as-built + roadmap | Silent death detection; P0 done, P1/P2 pending                                    |
| ONCHAIN_READERS.md             | spec/onchain-readers.md                          |   [ ]    | as-built           | Treasury/ownership read patterns, port design                                     |
| PAYMENTS_DESIGN.md             | spec/payments-design.md                          |   [ ]    | as-built + roadmap | USDC state machine; phase 1 done, phase 2 pending                                 |
| PROMPT_REGISTRY_SPEC.md        | spec/prompt-registry.md                          |   [ ]    | as-built           | Injection architecture, prompt management                                         |
| SANDBOXED_AGENTS.md            | spec/sandboxed-agents.md                         |   [ ]    | as-built + roadmap | Core invariants + phase definitions pending                                       |
| SECURITY_AUTH_SPEC.md          | spec/security-auth.md                            |   [ ]    | as-built           | Auth surfaces, route policy, credential mapping                                   |
| SERVICES_ARCHITECTURE.md       | spec/services-architecture.md                    |   [ ]    | as-built           | Service structure, MVP checklist                                                  |
| SYSTEM_TENANT_DESIGN.md        | spec/system-tenant.md                            |   [ ]    | as-built           | System tenant execution model, policy enforcement                                 |
| TEMPORAL_PATTERNS.md           | spec/temporal-patterns.md                        |   [ ]    | as-built           | Temporal workflow patterns, determinism invariants                                |
| TENANT_CONNECTIONS_SPEC.md     | spec/tenant-connections.md                       |   [ ]    | as-built           | Connection management, credential resolution, schema                              |
| TOOL_USE_SPEC.md               | spec/tool-use.md                                 |   [ ]    | as-built           | Tool execution architecture, wire formats, security                               |
| UI_IMPLEMENTATION_GUIDE.md     | spec/ui-system.md                                |   [ ]    | as-built           | Canonical UI reference: rules, CVA patterns, styling                              |
| UNIFIED_GRAPH_LAUNCH_SPEC.md   | spec/unified-graph-launch.md                     |   [ ]    | as-built + roadmap | May merge with graph-execution spec                                               |
| USAGE_HISTORY.md               | spec/usage-history.md                            |   [ ]    | as-built           | Message artifact persistence, parallel billing                                    |
| features/HEALTH_PROBES.md      | spec/health-probes.md                            |   [ ]    | as-built           | Health probe definitions and requirements                                         |

### Guides (17 docs)

| Original                     | Destination                       | Migrated | Content State | Notes                                              |
| ---------------------------- | --------------------------------- | :------: | ------------- | -------------------------------------------------- |
| AGENTS_CONTEXT.md            | guides/agents-context.md          |   [ ]    | procedural    | Agent tool setup across Codex/Gemini/Claude/Cursor |
| AGENT_DEVELOPMENT_GUIDE.md   | guides/agent-development.md       |   [ ]    | procedural    | Step-by-step howto for adding new agent graphs     |
| ALLOY_LOKI_SETUP.md          | guides/alloy-loki-setup.md        |   [ ]    | procedural    | Grafana Cloud Loki integration runbook             |
| BUILD_ARCHITECTURE.md        | guides/build-architecture.md      |   [ ]    | procedural    | Workspace build order, Docker layering             |
| CHECK_FULL.md                | guides/check-full.md              |   [ ]    | procedural    | Local CI-parity test gate, troubleshooting         |
| ENVIRONMENTS.md              | guides/deployment-environments.md |   [ ]    | procedural    | 6 deployment modes, env var loading                |
| FEATURE_DEVELOPMENT_GUIDE.md | guides/feature-development.md     |   [ ]    | procedural    | Inside-out rule, layer import policy               |
| GIT_SYNC_REPO_MOUNT.md       | guides/git-sync-repo-mount.md     |   [ ]    | procedural    | Boot sequence, UID handling, CI validation         |
| LANGGRAPH_AI.md              | guides/langgraph-ai.md            |   [ ]    | procedural    | LangGraph workflow patterns and runtime            |
| LINTING_RULES.md             | guides/linting-rules.md           |   [ ]    | procedural    | ESLint/Prettier/Biome migration inventory          |
| MODEL_SELECTION.md           | guides/model-selection.md         |   [ ]    | procedural    | Model selection UI and caching                     |
| NEW_PACKAGES.md              | guides/new-package-checklist.md   |   [ ]    | procedural    | Adding packages checklist                          |
| PACKAGES_ARCHITECTURE.md     | guides/packages-architecture.md   |   [ ]    | procedural    | Internal package architecture and setup            |
| SERVICES_MIGRATION.md        | guides/services-migration.md      |   [ ]    | procedural    | Migration phases, port ownership rules             |
| SETUP.md                     | guides/developer-setup.md         |   [ ]    | procedural    | First-time setup and daily development             |
| TESTING.md                   | guides/testing-strategy.md        |   [ ]    | procedural    | Testing environments, fake adapter patterns        |
| TOOLS_AUTHORING.md           | guides/tools-authoring.md         |   [ ]    | procedural    | How to add a new tool, hard rules                  |

### Initiatives (7 docs)

| Original                             | Destination                        | Migrated | Content State | Notes                                     |
| ------------------------------------ | ---------------------------------- | :------: | ------------- | ----------------------------------------- |
| CACHING.md                           | ini.caching.md                     |   [ ]    | roadmap       | Investigation checklist, staleTime tuning |
| CHAIN_DEPLOYMENT_TECH_DEBT.md        | ini.chain-deployment-refactor.md   |   [ ]    | roadmap       | TxEvidence unification, plugin framework  |
| CICD_SERVICES_ROADMAP.md             | ini.cicd-services.md               |   [ ]    | roadmap       | P0 bridge, P1 GitOps, P2 supply chain     |
| CREDITS_PAGE_UI_CONSOLIDATION.md     | ini.credits-ui-consolidation.md    |   [ ]    | roadmap       | Kit component adoption, QA gate           |
| ERROR_HANDLING_IMPROVEMENT_DESIGN.md | ini.error-handling-improvements.md |   [ ]    | roadmap       | LLM error handling, structured logging    |
| INTEGRATION_WALLETS_CREDITS.md       | ini.wallet-integration.md          |   [ ]    | roadmap       | MVP wallet loop, 4+ step progress         |
| MVP_DELIVERABLES.md                  | ini.mvp-deliverables.md            |   [ ]    | roadmap       | MVP Node/Operator scope, vNext deferral   |

### Guides or ADRs (mixed)

| Original                         | Destination                                                   | Migrated | Content State         | Notes                                                     |
| -------------------------------- | ------------------------------------------------------------- | :------: | --------------------- | --------------------------------------------------------- |
| ARCHITECTURE_ENFORCEMENT_GAPS.md | spec/architecture-enforcement-gaps.md                         |   [ ]    | snapshot              | Enforcement status, known gaps; may be stale              |
| DOCS_ORGANIZATION_PLAN.md        | guides/docs-organization.md                                   |   [ ]    | snapshot              | Superseded by docs-work-system spec; keep as guide        |
| METRICS_OBSERVABILITY.md         | guides/metrics-observability.md                               |   [ ]    | roadmap               | Public analytics page phases, k-anonymity                 |
| PAYMENTS_FRONTEND_DESIGN.md      | spec/payments-frontend.md + guides/payments-frontend-setup.md |   [ ]    | as-built + procedural | Component architecture (spec) + integration steps (guide) |
| PAYMENTS_TEST_DESIGN.md          | guides/payments-testing.md                                    |   [ ]    | procedural            | Test checklists, phase breakdown                          |
| PROPOSAL_LAUNCHER.md             | guides/proposal-launcher.md                                   |   [ ]    | procedural            | Integration steps, API paths, validation rules            |
| REPO_STATE.md                    | guides/repo-status.md                                         |   [ ]    | snapshot              | Point-in-time assessment; may be stale                    |
| RUNTIME_POLICY.md                | guides/api-runtime-policy.md                                  |   [ ]    | as-built              | Next.js runtime selection policy                          |
| SOURCECRED.md                    | spec/sourcecred.md + guides/sourcecred-operations.md          |   [ ]    | as-built + procedural | Config specs (spec) + phase status (guide)                |
| SOURCECRED_CONFIG_RATIONALE.md   | guides/sourcecred-config-rationale.md                         |   [ ]    | as-built              | Config rationale, incentive design                        |
| VERCEL_AI_STREAMING.md           | guides/ai-sdk-migration.md                                    |   [ ]    | roadmap               | Post-MVP streaming protocol migration                     |

### Archive / Obsolete (10 docs)

| Original                             | Destination                      | Content State | Notes                                    |
| ------------------------------------ | -------------------------------- | ------------- | ---------------------------------------- |
| HANDOFF_TAILWIND_SPACING_BUG.md      | archive/                         | obsolete      | Completed bug fix; in git history        |
| HANDOFF_WALLET_BUTTON_STABILITY.md   | archive/                         | obsolete      | Completed/deferred UI fix handoff        |
| ISOLATE_LITELLM_DATABASE.md          | archive/                         | obsolete      | Post-incident note, resolved             |
| UI_CLEANUP_CHECKLIST.md              | archive/                         | obsolete      | Completed cleanup phase tracking         |
| UI_CLEANUP_PLAN.md                   | archive/                         | obsolete      | Completed cleanup plan                   |
| archive/COMPLETION_REFACTOR_PLAN.md  | archive/                         | obsolete      | Already archived                         |
| archive/DEPAY_PAYMENTS.md            | archive/                         | obsolete      | Already archived                         |
| archive/FIX_AI_STREAMING_PIPELINE.md | archive/                         | obsolete      | Already archived                         |
| archive/PAYMENTS_WIDGET_DECISION.md  | decisions/adr/payments-widget.md | obsolete      | ADR candidate; archived payment decision |
| archive/triggerdev_analysis.md       | archive/                         | obsolete      | Already archived                         |

### Subdirectory Docs (3 docs)

| Original                                                            | Destination                     | Content State | Notes                                   |
| ------------------------------------------------------------------- | ------------------------------- | ------------- | --------------------------------------- |
| dev/TOOL_STREAMING_ISSUE.md                                         | archive/                        | obsolete      | Feature-specific debugging note         |
| introspection/2026-01-19-design-review-scheduler-execution-tools.md | archive/                        | snapshot      | Dated design review; reference only     |
| introspection/2026-01-21-cross-spec-alignment-review.md             | archive/                        | snapshot      | Dated cross-spec review; reference only |
| postmortems/2026-01-25-main-staging-divergence.md                   | guides/postmortem-2026-01-25.md | snapshot      | Incident postmortem; keep as guide      |

## Summary

- **Total legacy docs**: 88 (excluding 9 already migrated)
- **Already migrated** (need redirect stubs): 9
- **Classified as spec**: 37 (10 need 1:N split — as-built + roadmap)
- **Classified as guide**: 17
- **Classified as initiative**: 7
- **Classified as mixed/other**: 11
- **Classified as archive**: 14
- **Needs 1:N split**: GRAPH_EXECUTION, DATABASE_RLS, OBSERVABILITY_REQUIRED, PAYMENTS_DESIGN, HUMAN_IN_THE_LOOP, LANGGRAPH_SERVER, NODE_CI_CD_CONTRACT, SANDBOXED_AGENTS, AUTHENTICATION, UNIFIED_GRAPH_LAUNCH, PAYMENTS_FRONTEND, SOURCECRED

## PR Checklist

- [ ] **Work Item:** wi.docs-migration-tracker
- [ ] **Spec:** docs/spec/spec-project-lifecycle.md#core-invariants
- [ ] **Invariants Validated:** SPEC_STATE_LIFECYCLE, INV-SPEC-SCOPE-001

## Validation

**Command:**

```bash
node scripts/validate-docs-metadata.mjs
```

**Expected:** All migrated docs pass validation.

## Notes

- **PIVOT**: Switched from Logseq `key::` to Obsidian YAML frontmatter (done)
- 9 already-migrated specs converted to YAML frontmatter (done, `pnpm check:docs` green)
- All migrated docs use `trust: draft` (upgrade later after review)
- **All 97 docs classified** — no blanks remaining
- 12 docs need 1:N split (as-built content → spec, roadmap → initiative)
- 2 already-migrated specs (scheduler, rbac) contain roadmap content that should be stripped
- GRAPH_EXECUTION.md (1023 lines) is the highest-priority split candidate
- Proof-of-concept migration order: GRAPH_EXECUTION → then batch the clean as-built specs
