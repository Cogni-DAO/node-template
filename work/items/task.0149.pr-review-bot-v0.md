---
id: task.0149
type: task
title: "PR Review Bot V0 — LangGraph agent + gate orchestrator for automated PR review"
status: needs_implement
priority: 1
rank: 1
estimate: 4
summary: "Port cogni-git-review's core review logic into cogni-template: a new LangGraph pr-review graph, a deterministic gate orchestrator, webhook routing for PR events, and GitHub Checks + PR comment output. V0 is self-install only (reviews PRs on this repo)."
outcome: "When a PR is opened/updated on this repo, the existing GitHub App webhook fires, a new pr-review LangGraph agent evaluates the diff against `.cogni/rules/*.yaml`, a gate orchestrator applies success_criteria thresholds, and results post as a GitHub Check Run + PR comment."
spec_refs:
  - vcs-integration
assignees: []
credit:
project: proj.vcs-integration
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-10
updated: 2026-03-10
labels: [vcs, ai, review, langgraph]
external_refs:
  - https://github.com/cogni-dao/cogni-git-review
---

# PR Review Bot V0 — LangGraph Agent + Gate Orchestrator

## Problem

`cogni-git-review` is a standalone Probot app that reviews PRs against declarative rules. This repo already has the GitHub App webhook infrastructure (for attribution ingestion), the LangGraph graph framework, and `.cogni/repo-spec.yaml` with gate + rule definitions — but no review agent. We need to absorb the review logic without Probot, running it through our existing infrastructure.

## Design

### Crawl/Walk/Run Phasing

**Crawl** — Simplest possible PR review agent. A single ReAct LangGraph agent that receives PR diff + file list, evaluates against rule statements, and emits structured output (per-metric 0-1 scores + observations). No gate orchestrator yet — the webhook handler applies `success_criteria` thresholds directly. Posts a GitHub Check Run with pass/fail + a PR comment with observations. Self-install only (this repo).

**Walk** — Gate orchestrator. Factor out threshold evaluation into a deterministic gate runner that processes `gates[]` from repo-spec in order. Built-in gates (`review-limits` for PR size checks) run without LLM. AI-rule gates invoke the pr-review graph. Each gate returns a normalized result. Orchestrator aggregates to overall pass/fail/neutral with per-gate timeout + crash isolation.

**Run** — Multi-repo install support. DB-backed installation tracking (`operator_node_registrations`). Dynamic repo-spec fetching from installed repos. Token provider selects correct installation token per repo. This is task.0122 territory.

### Architecture (Crawl + Walk combined — both fit in one PR)

```
GitHub webhook (pull_request.opened / .synchronize / .reopened)
  │
  ├─ [existing] POST /api/internal/webhooks/github
  │     └─ [existing] GitHubWebhookNormalizer → attribution events
  │
  └─ [NEW] PR review handler (parallel path, not blocking attribution)
        │
        ├─ Filter: pull_request events with action in [opened, synchronize, reopened]
        ├─ Create GitHub Check Run (status: in_progress)
        ├─ Load .cogni/repo-spec.yaml gates config (local fs, self-install)
        │
        ├─ Gate Orchestrator (deterministic, no LLM)
        │   ├─ For each gate in spec order:
        │   │   ├─ review-limits: check file count + diff size → pass/fail
        │   │   └─ ai-rule: invoke pr-review LangGraph graph
        │   │       ├─ Gather evidence (diff summary, file patches)
        │   │       ├─ Build dynamic eval schema from rule's evaluations[]
        │   │       ├─ ReAct agent scores each metric 0-1 + observations
        │   │       └─ Return structured metrics
        │   │   Apply success_criteria thresholds → gate pass/fail/neutral
        │   ├─ Per-gate timeout (default 120s) → neutral on timeout
        │   └─ Aggregate: fail > neutral > pass
        │
        ├─ Update GitHub Check Run (conclusion: success/failure/neutral)
        │   └─ Summary: per-gate markdown with scores + observations
        │
        └─ Post PR Comment (with staleness guard — skip if HEAD SHA changed)
            └─ Developer-friendly summary with DAO vote link if configured
```

### Key Porting Decisions

| cogni-git-review | cogni-template adoption | Rationale |
|---|---|---|
| Probot framework | Drop entirely | NO_PROBOT_DEPENDENCY; we have Next.js webhook routes |
| Express server | Use existing Next.js API route | Already handles GitHub webhooks |
| `context.vcs.*` abstraction | Skip for V0 | Self-install reads local fs + uses existing Octokit |
| Gate registry (filesystem scan) | Static registry map | Simpler; 2 gate types (review-limits, ai-rule) |
| `goal-evaluations` LangGraph workflow | New `pr-review` graph in `packages/langgraph-graphs/` | Follows existing graph pattern (brain, research, etc.) |
| `spec-loader.js` | Reuse `packages/repo-spec/` + new gate schema | Extend existing Zod schema for gates |
| `summary-adapter.js` | New `pr-review-summary.ts` | Markdown formatting for Check Run output |
| `pr-comment.js` | New `pr-comment.ts` with staleness guard | Port the SHA-comparison guard |
| Model selection (env-based) | Use existing LLM config from repo | Leverages `providers.openrouter` from repo-spec |
| `.cogni/rules/*.yaml` | Already exists in this repo | repo-spec.yaml already references rule files |
| AJV schema validation | Use Zod (project standard) | Consistent with codebase |

## Requirements

- **R1**: `pull_request` webhooks with action `opened`, `synchronize`, or `reopened` trigger PR review (in addition to existing attribution normalization)
- **R2**: A GitHub Check Run named "Cogni PR Review" is created at start (in_progress) and updated on completion (success/failure/neutral)
- **R3**: Gate orchestrator processes `gates[]` from `.cogni/repo-spec.yaml` in order, with per-gate timeout (120s default), crash isolation (gate crash → neutral), and priority aggregation (fail > neutral > pass)
- **R4**: `review-limits` gate checks `max_changed_files` and `max_total_diff_kb` without LLM — pure numeric comparison
- **R5**: `ai-rule` gate invokes the pr-review LangGraph graph with the rule's `evaluations[]`, receives per-metric 0-1 scores, and applies `success_criteria` thresholds deterministically (no LLM for threshold evaluation)
- **R6**: PR comment posted with staleness guard (skip if HEAD SHA changed during review)
- **R7**: Check Run summary includes per-gate results with scores, observations, and overall conclusion
- **R8**: DAO "Propose Vote to Merge" link included in summary when `cogni_dao` is configured in repo-spec
- **R9**: Review does not block attribution webhook processing (parallel execution path)
- **R10**: Self-install only — reads `.cogni/` from local filesystem, uses existing `GH_REVIEW_APP_*` credentials

## Allowed Changes

- `packages/langgraph-graphs/src/graphs/pr-review/` — new graph (graph.ts, state.ts, prompts.ts, tools.ts)
- `packages/langgraph-graphs/src/catalog.ts` — register pr-review graph
- `packages/ai-tools/src/tools/` — new PR-specific tools (get-pr-diff, get-pr-files)
- `packages/ai-tools/src/catalog.ts` — register new tools
- `packages/repo-spec/src/` — extend schema for gates + rules Zod validation
- `src/features/review/` — new feature module (gate orchestrator, review handler, summary formatter, PR commenter)
- `src/app/api/internal/webhooks/[source]/route.ts` — add review handler dispatch (parallel to attribution)
- `src/adapters/server/review/` — GitHub Checks API + PR comment adapter
- `src/shared/env.ts` — any new env vars if needed
- `.cogni/repo-spec.yaml` — no changes needed (already has gates config)
- `.cogni/rules/*.yaml` — no changes needed (already exist)
- Test files for all new modules

## Plan

### Phase 1: Gate + Rule Schema (packages/repo-spec)

- [ ] Add Zod schemas for `gates[]` entries (review-limits config, ai-rule config with rule_file reference)
- [ ] Add Zod schema for rule YAML files (evaluations[], success_criteria with require/any_of + comparison operators)
- [ ] Add `loadRule(rulePath)` function that reads + validates `.cogni/rules/*.yaml`
- [ ] Unit tests for gate + rule schema validation

### Phase 2: PR Review LangGraph Graph

- [ ] Create `packages/langgraph-graphs/src/graphs/pr-review/` with state.ts, prompts.ts, tools.ts, graph.ts
- [ ] State: extends MessagesAnnotation with PR context (diff summary, file patches, rule evaluations)
- [ ] Prompts: evaluation prompt that instructs agent to score each metric 0-1 with observations
- [ ] Graph: ReAct agent with structured output (dynamic schema from rule's evaluations[])
- [ ] Register in catalog.ts with tool IDs
- [ ] Unit tests for graph creation + prompt formatting

### Phase 3: PR Tools (packages/ai-tools)

- [ ] `get-pr-diff` tool — fetches PR diff via Octokit, returns truncated summary within budget
- [ ] `get-pr-files` tool — lists changed files with status (added/modified/removed) and patch excerpts
- [ ] Register in TOOL_CATALOG
- [ ] Unit tests with mocked Octokit responses

### Phase 4: Gate Orchestrator (src/features/review)

- [ ] `gate-orchestrator.ts` — processes gates[] in order, per-gate timeout, crash isolation, result aggregation
- [ ] `gates/review-limits.ts` — file count + diff size check (no LLM)
- [ ] `gates/ai-rule.ts` — invokes pr-review graph, applies success_criteria thresholds
- [ ] `types.ts` — GateResult, ReviewResult, ReviewContext interfaces
- [ ] `criteria-evaluator.ts` — deterministic threshold evaluation (require[], any_of[], comparison operators)
- [ ] Unit tests for orchestrator, each gate, and criteria evaluator

### Phase 5: GitHub Output Adapters (src/adapters/server/review)

- [ ] `check-run.ts` — create/update GitHub Check Run via Octokit (in_progress → conclusion)
- [ ] `pr-comment.ts` — post PR comment with staleness guard (compare HEAD SHA before posting)
- [ ] `summary-formatter.ts` — markdown rendering for Check Run output + PR comment
- [ ] Unit tests with mocked Octokit

### Phase 6: Webhook Integration

- [ ] `src/features/review/services/review-handler.ts` — orchestrates full review flow (check run → gates → update check → comment)
- [ ] Wire into webhook route: dispatch review handler on `pull_request` events (parallel to attribution)
- [ ] Octokit client creation using existing `GH_REVIEW_APP_*` credentials (JWT → installation token)
- [ ] Integration test: mock webhook payload → verify check run + comment calls

### Phase 7: Validation

- [ ] `pnpm check` passes (lint + type + format)
- [ ] All new unit tests pass
- [ ] Manual test: create a PR on this repo, verify Check Run appears + PR comment posts

## Validation

**Command:**

```bash
pnpm check
```

**Expected:** Clean lint, types, format.

**Command:**

```bash
pnpm test packages/repo-spec/
pnpm test packages/langgraph-graphs/src/graphs/pr-review/
pnpm test packages/ai-tools/src/tools/
pnpm test src/features/review/
pnpm test src/adapters/server/review/
```

**Expected:** All tests pass.

**Manual validation:**

1. Push a branch, open a PR against staging
2. GitHub Check Run "Cogni PR Review" appears with in_progress → success/failure
3. PR comment with per-gate scores and observations appears
4. If PR is updated (new push), new review runs and old comment is superseded

## Review Checklist

- [ ] **Work Item:** `task.0149` linked in PR body
- [ ] **Spec:** vcs-integration invariants upheld (NO_PROBOT_DEPENDENCY, WEBHOOK_SIGNATURE_REQUIRED, REVIEW_HANDLER_VIA_GRAPH)
- [ ] **Tests:** unit tests for all new modules, integration test for webhook → review flow
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Sister repo: https://github.com/cogni-dao/cogni-git-review
- Spec: docs/spec/vcs-integration.md
- Existing gates config: .cogni/repo-spec.yaml
- Existing rules: .cogni/rules/*.yaml

## Attribution

-
