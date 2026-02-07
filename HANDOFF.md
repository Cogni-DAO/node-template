# Docs Migration Handoff

## Project Goal

Migrate ~100 legacy `docs/*.md` files (SCREAMING_CASE, no frontmatter) into a typed document system with CI-enforced YAML frontmatter. **Zero data loss.**

## Worktree

`/private/tmp/docs-integration/` on branch `refactor/docs-migrate-batch-4`. **All work happens here, never in `/Users/derek/dev/cogni-template/`.**

## Current Status

**80 done, 20 remaining.** All 20 are `AB+road` splits (mixed as-built + roadmap content → each produces a spec + initiative appendage). Validator passes: `pnpm check:docs` → 77 files, 77 unique IDs. Working tree is clean (only this HANDOFF.md modified).

**Last commit:** `b536beab` — migrate 13 roadmap docs + 2 AB+road splits (squash-merged from batch-3)

**Last session completed:**

1. `PROPOSAL_LAUNCHER.md` → new `ini.web3-gov-mvp.md` (pure roadmap, archived original)
2. `SERVICES_MIGRATION.md` → appended "Node → Operator Migration Track" to `ini.cicd-services-gitops.md` (archived original)
3. `N8N_ADAPTER_SPEC.md` → `docs/spec/n8n-adapter.md` (draft) + new `ini.n8n-integration.md` (reclassified from roadmap → AB+road — had spec-grade invariants, TypeScript interfaces, flow diagrams)
4. `PROMPT_REGISTRY_SPEC.md` → `docs/spec/prompt-registry.md` (draft) + new `ini.prompt-registry.md` (reclassified from roadmap → AB+road — had port interface, injection architecture, classification tables)

**Next up:** Start working through the 20 remaining AB+road splits. Suggested order is lower complexity first, high complexity last. See "Remaining Docs" section below.

---

## HARD INVARIANTS — READ THESE BEFORE DOING ANYTHING

These are non-negotiable. Every previous developer on this migration learned them the hard way. Violating any will produce broken output or data loss.

1. **ZERO DATA LOSS** — every fact, snippet, table row, ASCII diagram from originals must appear **verbatim** in output. Roadmap content → initiatives, never deleted. Do not summarize or paraphrase content — **copy it**. If the original has an ASCII UI mockup with specific characters, the output must have the identical mockup.

2. **SAFE ORDER** — when splitting a doc (spec + initiative), create initiative content **FIRST**, verify no data loss by reading the initiative back, **THEN** restructure the spec. Never overwrite before content is safely landed elsewhere. **This is the most critical invariant.**

3. **`pnpm check:docs` AFTER EVERY DOC** — validate individually, fix before proceeding. The validator checks frontmatter fields, required H2 headings (for specs with `spec_state`), unique IDs, and type↔directory matching.

4. **UPDATE TRACKER AFTER EVERY DOC** — mark `[x]` in Done column of `work/issues/wi.docs-migration-tracker.md`. Also update the Ini/Spec columns if the actual destination differs from what was pre-planned.

5. **UPDATE SPEC_INDEX AFTER EVERY SPEC** — add to `docs/spec/SPEC_INDEX.md`, alphabetical by ID.

6. **TODOs/future work → initiatives, NOT spec Open Questions.** Spec Open Questions is ONLY for minor clarifications about the spec itself. Planned work, phase checklists, and implementation TODOs go to initiatives.

7. **SOURCE ATTRIBUTION** — when appending to initiatives, use `> Source: docs/ORIGINAL.md` and link to the related spec. This preserves provenance.

8. **`git mv` + surgical edits** — preserve git history. Don't delete + create.

9. **PREFER EXISTING INITIATIVES** — do NOT blindly create new `ini.*` files. There are now **14** existing initiatives. Always search them first for a topical match. When appending, add a clearly segmented track/section with its own heading and source attribution. Only create a new initiative when no existing one covers the domain.

10. **DESIGN CONTENT STAYS IN SPECS** — many "roadmap" docs contain spec-grade content (invariants, schemas, type definitions, architecture diagrams). Split smartly: design → spec (`spec_state: draft`), checklists/phases → initiative. Don't shove design into initiatives where it doesn't belong.

11. **ONE DOC AT A TIME** — migrate one doc completely (read → classify → route roadmap → restructure spec → validate → update tracker) before starting the next. Commit in small batches (2-3 docs per commit is fine).

---

## Migration Process (per doc)

1. **Read** the source doc end-to-end. Understand every section.
2. **Classify content** section-by-section: as-built design → spec, procedural → guide, future work → initiative, obsolete → archive.
3. **If splitting (AB+road):**
   a. Route roadmap content to initiative FIRST (create track in existing ini, or new ini if no fit)
   b. Read the initiative back and verify ALL roadmap content landed verbatim
   c. THEN restructure the source into a spec via `git mv` + edit
4. **If pure roadmap:** Archive the source (`git mv` → `docs/archive/`), append all content to an initiative
5. **Add YAML frontmatter** matching the destination type (see templates)
6. **Restructure into required headings** — spec needs: Context, Goal, Non-Goals, Core Invariants, Design, Acceptance Checks
7. **Update SPEC_INDEX** (for specs)
8. **Run `pnpm check:docs`** — HARD REQUIREMENT
9. **Mark `[x]` in tracker** — HARD REQUIREMENT

---

## Remaining Docs (20) — All AB+road Splits

Every one of these has both as-built design content AND roadmap/TODO content. Each produces at minimum: a spec (`docs/spec/`) + initiative content (appended to existing or new `work/initiatives/`).

### Lower complexity (smaller docs, clearer splits) — start here

| Source                         | Tracker Spec                                     | Tracker Ini              | Notes                                                                  |
| ------------------------------ | ------------------------------------------------ | ------------------------ | ---------------------------------------------------------------------- |
| `SYSTEM_TENANT_DESIGN.md`      | system-tenant.md                                 | —                        | Check if it needs an ini or if TODOs are minor                         |
| `USAGE_HISTORY.md`             | usage-history.md                                 | —                        | Check if it needs an ini or if TODOs are minor                         |
| `features/HEALTH_PROBES.md`    | health-probes.md                                 | —                        | Check if it needs an ini or if TODOs are minor                         |
| `AI_GOVERNANCE_DATA.md`        | ai-governance-data.md                            | ini.governance-agents.md | Tracker suggests new ini — evaluate if existing ini fits               |
| `HUMAN_IN_THE_LOOP.md`         | human-in-the-loop.md                             | ini.hil-graphs.md        | Tracker suggests new ini — evaluate if existing ini fits               |
| `NODE_CI_CD_CONTRACT.md`       | node-ci-cd-contract.md                           | ini.ci-cd-reusable.md    | Tracker suggests new ini — might fold into ini.cicd-services-gitops.md |
| `ONCHAIN_READERS.md`           | onchain-readers.md                               | ini.onchain-indexer.md   | Tracker suggests new ini — evaluate                                    |
| `SOURCECRED.md`                | sourcecred.md + sourcecred-operations.md (guide) | —                        | May be a 3-way split                                                   |
| `UNIFIED_GRAPH_LAUNCH_SPEC.md` | unified-graph-launch.md                          | —                        | Check if it needs an ini                                               |

### Medium complexity

| Source                           | Tracker Spec                  | Tracker Ini                    | Notes                                                                                                           |
| -------------------------------- | ----------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `ACCOUNTS_API_KEY_ENDPOINTS.md`  | accounts-api-endpoints.md     | ini.accounts-api-keys.md       | Appends to existing ini                                                                                         |
| `ACCOUNTS_DESIGN.md`             | accounts-design.md            | ini.accounts-api-keys.md       | Appends to same existing ini — migrate together with above                                                      |
| `OBSERVABILITY_REQUIRED_SPEC.md` | observability-requirements.md | ini.observability-hardening.md | Appends to existing ini                                                                                         |
| `TENANT_CONNECTIONS_SPEC.md`     | tenant-connections.md         | ini.tenant-connections.md      | Tracker suggests new ini                                                                                        |
| `TOOL_USE_SPEC.md`               | tool-use.md                   | ini.tool-use-evolution.md      | Tracker suggests new ini                                                                                        |
| `SANDBOXED_AGENTS.md`            | sandboxed-agents.md           | ini.sandboxed-agents.md        | **CAUTION: Active development on feat/sandbox-0.5 branch.** Migrate carefully — content may be stale or in flux |

### High complexity (large docs, multi-way splits)

| Source                   | Tracker Spec                                          | Tracker Ini                        | Notes                                                                                            |
| ------------------------ | ----------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| `GRAPH_EXECUTION.md`     | graph-execution.md                                    | ini.graph-execution.md             | **1023 lines — largest remaining doc.** Highest priority split candidate. New ini likely needed. |
| `LANGGRAPH_SERVER.md`    | langgraph-server.md + langgraph-server-dev.md (guide) | ini.langgraph-server-production.md | 3-way split: spec + guide + initiative                                                           |
| `LANGGRAPH_AI.md`        | langgraph-patterns.md + langgraph-guide.md (guide)    | —                                  | spec + guide split                                                                               |
| `PAYMENTS_DESIGN.md`     | payments-design.md + payments-setup.md (guide)        | ini.payments-enhancements.md       | spec + guide + append to existing ini                                                            |
| `NODE_FORMATION_SPEC.md` | node-formation.md + node-formation-guide.md (guide)   | ini.node-formation-ui.md           | spec + guide + new ini                                                                           |

---

## Key Files

| File                                       | Purpose                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| `work/issues/wi.docs-migration-tracker.md` | Master tracker — Done/Refs columns, destination mappings for all ~100 docs     |
| `docs/spec/SPEC_INDEX.md`                  | Spec index — update after each spec, alphabetical by ID                        |
| `docs/_templates/spec.md`                  | Spec template — required frontmatter fields + H2 headings                      |
| `work/_templates/initiative.md`            | Initiative template — Crawl/Walk/Run deliverable tables                        |
| `docs/_templates/guide.md`                 | Guide template                                                                 |
| `scripts/validate-docs-metadata.mjs`       | CI validator — run via `pnpm check:docs`                                       |
| `work/initiatives/`                        | **14 existing initiative files** — always search here before creating new ones |

## Existing Initiatives (14)

| Initiative                          | Domain             | Key Topics                                                                                               |
| ----------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------- |
| `ini.accounts-api-keys.md`          | auth, wallet       | SIWE auth, session management, API key storage                                                           |
| `ini.agent-registry.md`             | ai-graphs          | Multi-adapter discovery, ERC-8004 identity                                                               |
| `ini.chain-deployment-refactor.md`  | web3, deployment   | Signed repo-spec, attested builds, deployment verification                                               |
| `ini.cicd-services-gitops.md`       | deployment, infra  | Docker builds, check:full CLI, DSN provisioning, GitOps, service spawning, **Node → Operator migration** |
| `ini.claude-sdk-adapter.md`         | ai-graphs          | Claude SDK as GraphExecutorPort                                                                          |
| `ini.cred-licensing.md`             | web3, security     | Federation enrollment, policy signing                                                                    |
| `ini.development-workflows.md`      | workflow           | Spec lifecycle, PR conventions, agent operating model                                                    |
| `ini.docs-system-infrastructure.md` | docs, infra        | CI gates, MkDocs, Plane integration                                                                      |
| `ini.n8n-integration.md`            | ai-graphs, billing | n8n webhook execution adapter, LiteLLM billing reconciliation                                            |
| `ini.observability-hardening.md`    | data, testing      | Activity metrics, LLM error handling, public analytics frontend                                          |
| `ini.payments-enhancements.md`      | billing            | External executor reconciliation, billing hardening, on-chain settlement                                 |
| `ini.performance-efficiency.md`     | performance        | Web caching, LLM caching, CI performance                                                                 |
| `ini.prompt-registry.md`            | ai-graphs          | Langfuse prompt management, prefetch injection, label rollout                                            |
| `ini.web3-gov-mvp.md`               | web3, governance   | Proposal launcher deep-link integration                                                                  |

---

## Gotchas

- **`spec_state` triggers heading validation** — if a spec has `spec_state: draft` (or any value), the validator requires H2 headings: Context, Goal, Non-Goals, Core Invariants, Design, Acceptance Checks
- **Initiative state enum:** `Active|Paused|Done|Dropped` (NOT `Proposed`)
- **`docs/archive/` is excluded from validator** — no frontmatter needed there
- **Prettier runs on commit** and reformats tables — expected, don't fight it
- **SPEC_INDEX** entries are alphabetical by ID. Also has a "Pending Migration" list — remove entries from it as you migrate them.
- **Validator requires `assignees`** field to be non-empty on initiatives
- **Tracker Ini column may be wrong** — the pre-planned destinations sometimes suggest new initiatives when content should fold into existing ones. Previous developers updated destinations on-the-fly (e.g., ERROR_HANDLING → `ini.observability-hardening.md` instead of creating `ini.error-handling-improvements.md`, SERVICES_MIGRATION → `ini.cicd-services-gitops.md` instead of creating `ini.services-migration.md`). Always evaluate the right home.
- **"Roadmap" state in tracker can be wrong** — N8N_ADAPTER_SPEC.md and PROMPT_REGISTRY_SPEC.md were classified as "roadmap" but actually had substantial spec-grade design content (invariants, TypeScript interfaces, architecture diagrams). Read every doc yourself; don't trust the classification blindly.
- **AGENTS.md pointers** — when you migrate a doc, check if AGENTS.md (root) has a link to the old location. Update it to point to the new spec/initiative.
- **SANDBOXED_AGENTS.md** — active development on another branch (feat/sandbox-0.5). Content may be stale. Migrate what's there but don't spend time reconciling with in-flight work.
