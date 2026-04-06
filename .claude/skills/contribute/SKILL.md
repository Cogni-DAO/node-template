---
name: contribute
description: "Contribute to a Cogni node repo as an AI agent. Use this skill when you need to: find available tasks, claim work, implement changes, run checks, submit PRs, handle CI failures, or respond to review feedback in a Cogni monorepo. Also use when the user says 'find work', 'pick up a task', 'contribute', 'submit a PR', 'check CI status', or 'fix CI'. This skill orchestrates the full dev lifecycle from task discovery to merged PR."
---

# Contribute to Cogni

You are an AI agent contributing code to a Cogni node repository. This skill guides you through the full lifecycle: find work → understand it → implement → validate locally → push once → handle feedback.

## Quickstart: Ship a Graph Update in 30 Minutes

> See [docs/guides/contributor-quickstart.md](../../../docs/guides/contributor-quickstart.md) for the full walkthrough with a concrete example (add a tool to poly's brain graph).

```bash
git checkout -b feat/my-change origin/canary     # 1. branch
# edit nodes/<node>/graphs/ or packages/langgraph-graphs/
pnpm packages:build                              # 2. rebuild declarations
pnpm check:fast                                  # 3. iterate
pnpm check                                       # 4. full gate (once)
git push -u origin feat/my-change                # 5. push (hooks enforce)
gh pr create --base canary                       # 6. PR → CI → canary
```

## Prerequisites

Before starting, verify:

- `git` configured with push access (fork or direct branch)
- `gh` CLI authenticated (`gh auth status`)
- You're inside a cloned Cogni repo with `work/items/` directory
- `pnpm install` has been run

If any are missing, fix them first. Don't guess — run the checks.

## The Lifecycle

### Phase 1: Find Work

```bash
pnpm cogni-contribute tasks --node poly --status needs_implement
pnpm cogni-contribute tasks                    # all actionable items
```

Before claiming, **read the task thoroughly**:

1. Read the work item file: `work/items/<task_id>.<slug>.md`
2. Read every file in `spec_refs` — these are your contracts
3. Read `CLAUDE.md` at repo root — the operating rules
4. Read `AGENTS.md` in every directory you'll touch

Understanding the task is more important than speed. A wrong implementation wastes a full CI cycle (20+ min).

### Phase 2: Claim and Branch

```bash
pnpm cogni-contribute claim task.0264
git checkout -b feat/task.0264-<slug> origin/canary
```

The CLI sets assignee + branch in frontmatter. You handle git. If the task is already claimed, pick a different one.

### Phase 3: Implement

Follow the work item's Plan section. Key principles:

1. **Stay scoped** — only touch files in Allowed Changes
2. **Reuse first** — search `packages/` before writing new code
3. **Follow patterns** — read neighboring files, match conventions
4. **Hex architecture** — `app → features → ports → core`, adapters implement ports from outside

Run `pnpm check:fast` often during iteration. It auto-fixes lint and format.

**The packages:build gotcha**: If you change anything in `packages/` or `nodes/*/graphs/`, run `pnpm packages:build` before `pnpm check:fast`. Stale `dist/*.d.ts` declarations cause phantom typecheck errors.

### Phase 4: Validate Locally — This Is the Gate

```bash
pnpm check
```

This runs everything: packages build → typecheck → lint → format → arch checks → docs → tests. **Every check must pass before you push.** The pre-push hook runs `check:fast` and will reject your push if it fails. Never use `--no-verify` — fix the code.

Common fixes:

- `pnpm lint:fix` — auto-fixes most lint errors
- `pnpm format` — auto-fixes all formatting
- Arch violations → read `.dependency-cruiser.cjs` for boundary rules
- `pnpm check:docs` errors → the message tells you the exact file and field
- Typecheck errors on fields that clearly exist in source → run `pnpm packages:build` to rebuild stale `dist/*.d.ts` declarations

### Phase 5: Push and PR

One push. Make it count.

```bash
git push -u origin feat/task.0264-<slug>
gh pr create --base canary --title "feat(task.0264): description" --body "Work: task.0264"
```

**Target: `canary`.** Not main. Canary is the integration branch. Preview is human review. Main is production.

Commit message format: `type(scope): lowercase description` under 100 chars. commitlint rejects sentence-case.

### Phase 6: Monitor CI + Review

```bash
pnpm cogni-contribute status task.0264
gh pr checks <pr-number>                # detailed check status
gh run view <run-id> --log-failed       # CI failure logs
```

If CI fails: read the logs, fix locally, run `pnpm check`, push. CI re-runs automatically.

If review requests changes: read the PR comments, fix, push. After 3 rejections, the task auto-blocks for human escalation — that means your approach has a fundamental issue, not a fixup.

### Phase 7: After Merge

The CD pipeline handles everything automatically:

```
PR merges to canary
  → Build Multi-Node: Docker images for all nodes         ~3 min
    → Promote: resolve digests, update k8s overlays        ~1 min
      → Deploy Infra: Compose services on VM               ~1 min
        → Verify: poll /readyz on all 3 nodes              ~1 min
          → E2E: Playwright smoke tests                    ~2 min
            → Promote to preview (CI-gated)                ~1 min
```

Your change is live at `https://test.cognidao.org` after verify passes. You're done after merge to canary.

**Three environments:**

| Environment | Branch   | Domain               | Purpose      |
| ----------- | -------- | -------------------- | ------------ |
| canary      | `canary` | test.cognidao.org    | AI e2e       |
| preview     | —        | preview.cognidao.org | Human review |
| production  | `main`   | cognidao.org         | Production   |

Promotion is automated: canary → preview (CI-gated), preview → production (human-initiated via `release.yml`).

## Architecture Quick Reference

```
nodes/operator/app/     # Operator node (Next.js)
nodes/poly/app/         # Poly node (Next.js)
nodes/resy/app/         # Resy node (Next.js)
nodes/*/graphs/         # Per-node LangGraph graphs
packages/               # Shared pure TS libraries (@cogni/*)
services/               # Deployable workers (scheduler-worker)
work/items/             # Work items (YAML frontmatter markdown)
docs/spec/              # Specs (as-built contracts, invariants)
infra/k8s/              # Kubernetes manifests (Argo CD syncs these)
```

**Hex layers**: `core` → `ports` → `features` → `app`. Adapters implement ports from outside.

**Contracts are truth**: API shapes in `src/contracts/*.contract.ts` (Zod).

**Packages are pure**: No env, no lifecycle, no framework deps. Never import `src/` from `packages/`.

**Graphs are pure factories**: `@langchain/*` only in `packages/langgraph-graphs/` and `nodes/*/graphs/`. No env reads, no side effects.

## What Will Get Your PR Rejected

**Process violations:**

- Using `--no-verify` to bypass hooks
- Skipping `pnpm check` before push
- Blind fixup pushes without running `pnpm check` first (review feedback pushes are expected — just validate locally each time)

**Quality regressions:**

- Weakening arch checks, removing test assertions, widening types to `any`
- Deleting or disabling tests to make CI pass
- Adding `biome-ignore` or `eslint-disable` without a linked issue

**Scope violations:**

- Touching files outside your task's scope
- Adding features or "improvements" beyond what was asked
- Committing `.env` files, credentials, or secrets

**Infra violations:**

- Manual k8s patches (Argo overwrites them)
- Sentence-case commit messages
- PRing to `main` (agents PR to `canary`)
