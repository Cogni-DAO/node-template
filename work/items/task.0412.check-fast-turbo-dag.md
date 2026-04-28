---
id: task.0412
type: task
title: "Speed up `pnpm check:fast` — collapse to one turbo DAG, drop test serialization, cache docs/db checks"
status: needs_implement
priority: 0
rank: 1
estimate: 3
summary: "`pnpm check:fast` is the husky pre-push gate. Today it sequences 8 phases through bash, runs `workspace:test --concurrency=1` (172s), pre-builds all .d.ts (24s) before typecheck, and excludes `check:docs` + `db:check` from the turbo graph so they always run. Total ~4 min on clean main, with hard CPU spikes that make multiple agents on one machine (or one cloud runner) thrash. Phase 1 ships the high-leverage low-risk wins: collapse parallel-safe phases into a single `turbo run` invocation, move `check:docs` and `db:check` into the turbo graph with proper inputs (so they cache), drop `--concurrency=1` on tests, scope vitest to `--changed` against merge-base. Phase 2 (remote cache + tsc project references / isolatedDeclarations) is a follow-up."
outcome: |
  After Phase 1:
    - `pnpm check:fast` on `main` (no changes vs upstream): <30s warm cache, <90s cold cache.
    - `pnpm check:fast` on a typical 1-package PR: <20s warm.
    - One `turbo run lint typecheck test check:docs db:check --affected` invocation drives all parallel-safe work.
    - `check:docs` and `db:check` are turbo tasks with `inputs:` pinned to docs/* and drizzle config/migration files; cached when those don't change.
    - Vitest runs `--changed` against merge-base inside affected packages.
    - `workspace:test --concurrency=1` removed; restored to default (CPU-1).
    - `packages:build` (24s prebuild) still runs but only when global build inputs changed; phase 2 will eliminate it.
    - Husky pre-push hook still calls `pnpm check:fast` and still catches drift.
spec_refs: []
assignees: []
credit:
project:
branch: task/0412-check-fast-turbo-dag
created: 2026-04-28
updated: 2026-04-28
labels: [dev-loop, monorepo, turbo, p0]
---

# task.0412 — Speed up `pnpm check:fast`

## Problem

`pnpm check:fast` is the husky pre-push gate (every push from every dev/agent runs it). Observed wall-time on clean `main`:

```
✓ packages:build       24s   (tsc emit of .d.ts so workspace typecheck can resolve types)
✓ workspace:typecheck  17s   (turbo run typecheck --affected)
✓ lint                  6s   (root biome+eslint)
✓ workspace:lint        3s   (turbo run lint --affected)
✓ format               18s   (prettier --check on the world)
✓ check:docs            3s   (always runs; not in turbo graph)
✓ db:check              8s   (4 drizzle-kit check invocations; not in turbo graph)
✓ workspace:test      172s   (turbo run test --affected --concurrency=1)
                     ─────
                      ~4 min
```

Two compounding problems:

1. **Wall-clock pain.** ~4 min per push. Pre-push gate that long discourages small commits and trains agents to bypass with `--no-verify`.
2. **Resource thrash.** `workspace:test` spikes every CPU; running multiple agents on one laptop, or in a cloud runner with limited CPU, causes thrash, OOM-kills, and flaky tests.

Five root causes:

- **R1. Bash sequencer, not a DAG.** `scripts/check-fast.sh` runs 8 named phases in series via `run_check`. Phases that have no inter-dependency (lint vs typecheck vs test vs format) wait on each other for no reason. Turbo already builds the per-package DAG; we re-serialize it at the script level.
- **R2. `--concurrency=1` on tests.** Disables Turbo's parallelism across packages. Likely a band-aid for testcontainer port collisions or DB contention; punishes everyone on every push.
- **R3. `packages:build` prebuild tax (24s).** Exists because workspace consumers import `.d.ts` from sibling package `dist/`. TS project references or `isolatedDeclarations` would eliminate this. Phase 2.
- **R4. `check:docs` + `db:check` not in turbo graph.** No `inputs:` declared, no caching. They run on every invocation even when nothing they care about changed.
- **R5. No remote cache.** Every fresh worktree, every CI runner, every agent VM starts from cold cache. Phase 2.

## Phase 1 scope (this PR)

Ship the wins that don't touch the package import surface or require infra:

### 1. Single `turbo run` invocation for parallel-safe tasks

Replace this:

```bash
run_check "workspace:typecheck" "bash scripts/run-turbo-checks.sh typecheck"
run_check "lint"                "pnpm lint"
run_check "workspace:lint"      "bash scripts/run-turbo-checks.sh lint"
run_check "format"              "pnpm format:check"
run_check "check:docs"          "pnpm -s check:docs"
run_check "db:check"            "pnpm -s db:check"
run_check "workspace:test"      "bash scripts/run-turbo-checks.sh test --concurrency=1"
```

With:

```bash
# packages:build still runs first (Phase 2 removes it) — captured as a pre-step
run_check "packages:build" "node scripts/run-scoped-package-build.mjs"

# One turbo invocation, full parallelism, affected-aware, with all checks in the DAG.
# Per-task caching means rerun on no-change is ~2s (graph hash + cache restore).
run_check "workspace" "bash scripts/run-turbo-checks.sh lint typecheck test check:docs db:check"

# Root-only checks that aren't packageable (biome/prettier on root files, root-layout, etc.)
run_check "root:lint+format" "pnpm lint && pnpm format:check"
```

This is 3 `run_check` calls instead of 8, and the middle one runs all 5 turbo tasks in one process so Turbo can schedule across the whole graph.

### 2. Drop `--concurrency=1` on tests

Default (CPU-1) restored. If a specific package has DB/port flakiness, fix it inside that package (e.g., dynamic ports, test-scoped containers) — never globally serialize all packages. Tracked as follow-up bug if any flake surfaces.

### 3. Move `check:docs` and `db:check` into the turbo graph

Add to `turbo.json`:

```jsonc
"check:docs": {
  "inputs": [
    "docs/**/*.md",
    "AGENTS.md",
    "**/AGENTS.md",
    "work/**/*.md",
    "scripts/validate-docs-metadata.mjs",
    "scripts/validate-doc-headers.ts",
    "scripts/validate-agents-md.mjs",
    "scripts/generate-work-index.mjs"
  ],
  "outputs": ["work/items/_index.md"]
},
"db:check": {
  "inputs": [
    "nodes/*/drizzle.config.ts",
    "nodes/*/drizzle.doltgres.config.ts",
    "nodes/*/packages/db-schema/**",
    "nodes/*/packages/doltgres-schema/**",
    "nodes/*/migrations/**"
  ]
}
```

Both become root-package turbo tasks (root `package.json` already exposes them). Re-runs on no-change hit cache in <500ms.

### 4. Vitest `--changed` for affected pkgs

Each package's `test` script becomes (or is wrapped to become):

```jsonc
"test": "vitest run --changed=${TURBO_SCM_BASE:-origin/main} --passWithNoTests"
```

Combined with `turbo --affected`, only test files whose source changed run, inside packages whose surface changed. Wired via env propagation in `run-turbo-checks.sh` (already exports `TURBO_SCM_BASE`).

If `--changed` finds nothing in a package, vitest exits 0 instantly.

### 5. Compact turbo logs (already wired)

`run-turbo-checks.sh` already sets `--output-logs=errors-only --log-order=grouped`. Verify it propagates to the new single-invocation form.

## Phase 2 (follow-up — separate task)

- **Turbo Remote Cache** (Vercel free tier or self-hosted `turborepo-remote-cache` on R2/S3). Cold worktree → warm cache → 5-10s `check:fast`. Single biggest agent/CI win.
- **TS project references** OR `isolatedDeclarations: true` to delete `packages:build` entirely. Workspace typecheck reads sibling sources, not built `.d.ts`.
- **Root format → biome only**, drop prettier from the gate (move to commit-time only). Prettier check on the world is 18s.

## Risks

- **R-1: Husky pre-push regression.** Mitigation: keep the same `pnpm check:fast` entrypoint, same exit-code semantics, same drift detection. Run before/after wall-time benchmarks on `main` and on a 1-file change.
- **R-2: Removing `--concurrency=1` exposes a real flake.** Mitigation: if CI flakes after this PR, revert just that line and file a bug for the underlying flake — don't block the whole speed-up.
- **R-3: Turbo cache key for `check:docs` misses an input.** Mitigation: include the full set of validator scripts + every doc directory those scripts touch in `inputs:`. If a docs change slips through, cache-bust by editing `globalDependencies`.

## Design

### Outcome

The husky pre-push gate `pnpm check:fast` becomes fast enough that no agent or human is tempted to bypass it: <30s warm-cache on a clean `main` rerun, <90s cold-cache on a fresh worktree, dominated by actual changed-code work rather than orchestration tax.

### Approach

**Solution**: Collapse the bash sequencer into a single `turbo run` invocation that drives lint + typecheck + test + check:docs + db:check as one DAG; pull `check:docs` and `db:check` into the turbo graph with explicit `inputs:` so they cache; drop `--concurrency=1`; scope vitest to `--changed`. Keep the existing `scripts/check-fast.sh` shell as the husky entrypoint and keep the drift-detection guardrails.

**Reuses**:

- Existing Turbo `--affected` infrastructure already wired in `scripts/run-turbo-checks.sh`.
- Existing per-package vitest configs and `turbo.json` task definitions.
- Existing husky `pre-push` hook contract — no change to what husky calls.

**Rejected**:

- _Replace husky pre-push with CI-only gating_ — pushes broken code into PRs and burns CI minutes; defeats the loop.
- _Switch to Nx or Bazel_ — replaces a tuning problem with a migration project; Turbo already covers everything we need.
- _Implement remote cache + project references in this PR_ — large surface, requires infra/secret setup and TS config rewrites across all packages. Split into Phase 2 to keep this PR reviewable in <300 LOC.
- _Skip prebuild step now via tsconfig `paths` only_ — would work but masks a real architectural debt; do it properly with project references in Phase 2.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] HUSKY_PREPUSH_UNCHANGED: `.husky/pre-push` still calls `pnpm check:fast` and exits non-zero on any failure.
- [ ] DRIFT_DETECTION_INTACT: `scripts/check-fast.sh` still snapshots tree hash before/after and fails on mid-run mutation.
- [ ] CACHE_INPUTS_COMPLETE: `check:docs` and `db:check` task `inputs:` cover every file the validators read; missing inputs → silent stale cache → broken push.
- [ ] NO_GLOBAL_TEST_SERIALIZATION: `--concurrency=1` removed from the test invocation; per-package serialization stays inside that package's vitest config if needed.
- [ ] AFFECTED_FALLBACK_PRESERVED: On `main` (no upstream), behavior falls back to full workspace run, same as today.
- [ ] SIMPLE_SOLUTION: One turbo invocation + two new task entries; no new orchestration code.
- [ ] PHASE_2_DEFERRED: Remote cache, project references, prebuild removal explicitly out of scope; tracked separately.

### Files

<!-- High-level scope -->

- Modify: `scripts/check-fast.sh` — collapse 8 `run_check` calls into 3 (prebuild, single turbo run, root lint/format).
- Modify: `scripts/run-turbo-checks.sh` — accept multiple task names in one invocation; pass through unchanged.
- Modify: `turbo.json` — add `check:docs` and `db:check` task definitions with `inputs:`.
- Modify: per-package `package.json` `test` scripts that need vitest `--changed` wiring (audit first; some may already use `vitest run`).
- Modify: `package.json` root scripts — ensure `check:docs` and `db:check` are turbo-discoverable as root tasks.
- Test: manual benchmark before/after on (a) clean `main` rerun (b) 1-file change (c) global build input change. Capture in PR description.

## Validation

### exercise

```bash
# Worktree freshly bootstrapped (cold cache):
cd /tmp && rm -rf cogni-bench && git clone --depth 1 git@github.com:Cogni-DAO/node-template cogni-bench
cd cogni-bench && git checkout task/0412-check-fast-turbo-dag
pnpm install --frozen-lockfile
time pnpm check:fast   # cold-cache target: <90s

# Same worktree, second run (warm cache):
time pnpm check:fast   # warm-cache target: <30s

# Trivial 1-file change in one package:
echo "// noop" >> packages/db-schema/src/index.ts
time pnpm check:fast   # affected-only target: <30s

# Drift still detected:
# (pre-stage a check that mutates a tracked file mid-run; verify exit 1 + git status surfaced)
```

### observability

Local-only task — no Loki signal needed. Capture before/after wall-time table in PR description, including:

- Cold-cache vs warm-cache.
- Single-package change vs full-workspace change.
- CPU usage during `workspace:test` phase (was 100% all cores due to default concurrency; should still be parallel but not pinned to 1).

The "before" baseline is the screenshot in the design conversation: `packages:build 24s, workspace:typecheck 17s, lint 6s, workspace:lint 3s, format 18s, check:docs 3s, db:check 8s, workspace:test 172s`.
