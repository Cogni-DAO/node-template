---
id: task.0381
type: task
title: "Single-node-scope CI gate — reject PRs that touch >1 node domain (operator owns repo infra)"
status: needs_design
priority: 0
rank: 1
estimate: 1
summary: "Static CI invariant that fails any PR whose changes span more than one node's domain. Each non-operator node owns `nodes/<X>/`. The `operator` node is special — it owns `nodes/operator/` PLUS the repo-wide infra (`infra/`, `.github/`, `packages/`, `services/`, `docs/`, `work/`, `scripts/`, root configs). A PR may touch exactly one domain. Operator's domain is broader, but it is still ONE domain — a non-operator node cannot ride changes to `packages/` or `.github/` along with its own code; that's a request into operator territory and must be a separate, operator-owned PR."
outcome: "When a contributor (or AI agent) opens a PR that touches `nodes/poly/` and `nodes/resy/` simultaneously, OR touches `nodes/poly/` and `packages/`, OR touches `nodes/poly/` and `nodes/operator/`, CI fails with a clear message naming the conflicting domains and instructing to split the PR. PRs entirely within one domain — a single non-operator node, or operator's full domain (which legitimately spans operator/ + infra) — pass. The matrix in task.0372 degenerates to ≤1 node cell per PR in practice; multi-cell flights are reserved for operator-domain PRs that legitimately fan out to all consumer nodes."
spec_refs:
  - node-ci-cd-contract
assignees: []
project: proj.cicd-services-gitops
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-25
updated: 2026-04-25
labels: [cicd, policy, monorepo, node-sovereignty]
---

# Single-Node-Scope CI Gate

## Problem

Task.0372's per-node matrix fan-out _supports_ multi-node PRs by design — multiple matrix cells run in parallel, one per affected node. But the underlying policy this monorepo wants is stricter: **a PR must touch at most one sovereign node**. Cross-node changes mask coordination bugs, complicate review (one node's reviewer cannot speak for another's rules), and undermine node sovereignty — the central architectural promise of the multi-node layout.

There is no current static enforcement of this. Without it:

- AI contributors (the inflood task.0372 + the per-node reviewer story exist to support) can land cross-node PRs that pass review on one node's rules and break invariants on another's.
- The reviewer, after task.0382's `extractOwningNode` lands, cannot answer "which node owns this PR?" deterministically when paths span multiple nodes.
- The candidate-flight matrix's `fail-fast: false` semantics lets a partial-success state ship — node A's cell green, node B's cell red, PR merged anyway because reviewers focused on A.

This is a policy gate, not a function. Implementation surface is small (~30 lines bash) but the _invariant_ it locks is load-bearing for every downstream multi-node story.

## Design

### Outcome

A required CI check `single-node-scope` that fails any PR whose changes span more than one node's domain.

### Domain model

Every node owns a domain. Domains are disjoint and partition the repo:

- **`poly`** owns `nodes/poly/**`
- **`resy`** owns `nodes/resy/**`
- **`node-template`** owns `nodes/node-template/**`
- **`operator`** owns `nodes/operator/**` PLUS everything else in the repo: `infra/`, `.github/`, `packages/`, `services/`, `docs/`, `work/`, `scripts/`, `tests/`, `e2e/`, root configs (`pnpm-workspace.yaml`, `turbo.json`, `package.json`, `tsconfig*.json`, `biome.json`, `.dependency-cruiser.cjs`, `.changeset/`, …) — all of it.

The operator IS a node, not an infra exemption. It is special only in that its domain extends beyond `nodes/operator/` to include all repo-wide infra/policy/governance — because that infra IS the control plane the operator runs. Other nodes are not permitted to modify operator's domain in their own PRs; doing so would cross domain boundaries. A `poly` change that needs a `packages/` update is two PRs: one in poly's domain (after the package lands), one in operator's domain (the package change itself).

### Rule (the entire policy in one paragraph)

For each changed path, classify it into exactly one domain:

```
domain(path) = X   if path matches  nodes/<X>/**  for X in {poly, resy, node-template}
             = operator   otherwise   (i.e., path is under nodes/operator/** OR anywhere else)
```

Let `S` = the set of distinct domains over the changed paths. The gate fails iff `|S| > 1`. Empty diffs and single-domain diffs (including operator-only diffs that span operator/ + infra/ + packages/ + .github/) all pass.

The "everything else is operator" formulation eliminates the rotting infra-allow-list problem: there is no enumeration of infra paths to maintain. Adding a new top-level directory (`tools/`, `e2e/`, etc.) automatically belongs to the operator domain. The only enumeration is the small set of non-operator nodes — which is `nodes/*` minus `operator`, i.e., the directory listing.

### Approach — OSS-first, no bespoke shell

**Solution**: a single new job in `.github/workflows/ci.yaml` that uses [`dorny/paths-filter`](https://github.com/dorny/paths-filter) (a widely-used, pinned-by-SHA OSS action) to compute which sovereign-node filters matched, then a one-line `if:` step that fails when >1 matched. No bespoke shell script, no awk, no path-regex parser.

```yaml
single-node-scope:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@<sha>
      with: { fetch-depth: 0 } # required so paths-filter can resolve base...HEAD on fork PRs
    - id: domains
      uses: dorny/paths-filter@<sha>
      with:
        filters: |
          poly:          ['nodes/poly/**']
          resy:          ['nodes/resy/**']
          node-template: ['nodes/node-template/**']
          operator:
            - '**'
            - '!nodes/poly/**'
            - '!nodes/resy/**'
            - '!nodes/node-template/**'
    - name: Enforce single-domain scope
      env:
        MATCHED: ${{ steps.domains.outputs.changes }} # JSON array of matched filter names
      run: |
        count=$(jq 'length' <<<"$MATCHED")
        if [ "$count" -gt 1 ]; then
          echo "::error::PR spans $count node domains: $(jq -r 'join(", ")' <<<"$MATCHED"). Each node owns its directory; operator owns nodes/operator + repo infra. Split into $count PRs, one per domain."
          exit 1
        fi
```

The `operator` filter is expressed as the negation of the other-node filters — `dorny/paths-filter` uses picomatch, which supports `!` negation. This keeps "operator owns everything else" derived from the small list of non-operator nodes; it does not enumerate any infra paths.

Why `dorny/paths-filter`:

- Already understands base-vs-head diff resolution for PRs, pushes, fork PRs, and force-pushes (handles edge cases like missing `origin/main` on shallow checkouts).
- Handles renames natively (counts both endpoints).
- Filters live next to the workflow that uses them — declarative, reviewable in one place.
- ~20k stars, actively maintained, pinned by SHA per existing repo convention.

### Source-of-truth invariant — closed by static check, not runtime discovery

Enumerating non-operator nodes in the workflow loses runtime auto-discovery. Closed by a tiny meta-test (vitest, using the `yaml` package already in the repo) under `tests/ci-invariants/` that:

1. Reads `nodes/*` from disk, drops `operator`.
2. Parses the `single-node-scope.filters` block from `.github/workflows/ci.yaml` with `yaml.parse`.
3. Asserts the non-operator filter names == the directory listing.
4. Asserts the `operator` filter equals `['**', '!nodes/<X>/**', …]` for exactly the same `<X>` set — keeping the negation list in sync with the positive filters.
5. Asserts the action's `uses:` line is pinned by full SHA, not by tag.

This makes "add a node and forget the gate" a green→red local test failure (`pnpm test:ci`), not a runtime hazard.

### Coordination with task.0382 — shared classification semantics

Both the CI gate and the operator's runtime resolver consume the same source: the `nodes/*` directory listing. There is no third "policy file." Both implement the same classification:

```
domain(path) = X         if path matches nodes/<X>/** for X in (nodes/* minus operator)
             = operator   otherwise
```

A parity test under `tests/ci-invariants/single-node-scope-parity.test.ts` runs both implementations against shared diff fixtures and asserts they produce the same domain-set. The fixture file is shared; either side drifting fails CI. This task lands the fixture file + a stub parity test that exercises the CI-gate side and asserts the empty case for the resolver; task.0382 fills in the resolver assertions when it lands.

### Rejected

- _Bespoke `scripts/ci/check-single-node-scope.sh` (awk + git diff)_ — works but reinvents diff resolution, rename handling, and fork-CI edge cases that `dorny/paths-filter` already gets right. Higher maintenance, more LOC, no upside.
- _`turbo ls --affected --filter='./nodes/*/...'`_ — answers a different question (which workspaces are affected by import graph), not "which top-level node dirs does the diff touch." Adds install + scope-base resolution cost for nothing. Drop.
- _Operator-as-exemption (an earlier draft of this design)_ — treated `nodes/operator/**` + infra paths as "exempt, may ride alongside any node PR." Wrong: it dilutes node sovereignty and lets a `poly` PR change `packages/` or `.github/` without operator review. Operator is a node, not an exemption — it owns its directory AND the repo infra as one domain.
- _Enumerated infra-allow-list_ — would require listing `tsconfig*.json`, `pnpm-workspace.yaml`, `turbo.json`, `pnpm-lock.yaml`, `biome.json`, `.changeset/`, `.husky/`, `e2e/`, `tests/`, root `*.md`, etc. Would rot. Replaced by "operator owns everything not under another node's directory" via a single negation filter.
- _CODEOWNERS-based enforcement_ — doesn't fail PRs on multi-owner diffs, only routes review requests.
- _GraphQL/GitHub-API check inside operator review-handler_ — couples policy to operator runtime; operator outages would let violations through. Static CI is independent.
- _Soft warning instead of hard fail_ — defeats the gate.
- _Listing sovereign nodes only in a separate config file_ — the directory layout `nodes/*` (minus `operator`) IS the source of truth; the workflow filter list is a derived view enforced by the meta-test.
- _Putting this in `arch:check` (dep-cruiser)_ — depcruise reasons about imports, not git diffs. Wrong layer.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] **SINGLE_DOMAIN_HARD_FAIL**: When >1 node domain is touched, CI fails with non-zero exit. No warning mode, no override flag.
- [ ] **OPERATOR_IS_A_NODE**: The operator domain is `nodes/operator/**` ∪ everything not under another node's directory. Operator changes count as a domain — a `poly` PR cannot ride a `packages/` change.
- [ ] **DIRECTORY_IS_SOURCE_OF_TRUTH**: A meta-test asserts the workflow's non-operator filter list equals `ls nodes/ | grep -v operator`, AND the `operator` filter's negation list matches the same set. Adding `nodes/ai-only/` without updating both fails `pnpm test:ci`.
- [ ] **NO_INFRA_ENUMERATION**: The workflow does not list any infra paths (`packages/`, `.github/`, etc.). Operator's domain is expressed via negation of the other-node filters, never via a positive allow-list.
- [ ] **CLEAR_FAILURE_MESSAGE**: The failure annotation names the conflicting domains and instructs the contributor to split the PR. Uses `::error::` so it surfaces in the PR Files Changed view.
- [ ] **REQUIRED_CHECK**: The job is a required status check on `main`, not informational.
- [ ] **POLICY_PARITY_WITH_0382**: A parity test runs the CI gate and the runtime resolver from task.0382 against shared diff fixtures and asserts identical domain-set classification.
- [ ] **ACTION_PINNED_BY_SHA**: `dorny/paths-filter` is pinned by full commit SHA, not by `@vN` tag. Meta-test enforces.

### Files

- Modify: `.github/workflows/ci.yaml` — add `single-node-scope` job (~20 lines YAML, no script).
- Create: `tests/ci-invariants/single-node-scope-meta.test.ts` — asserts workflow filter list == `nodes/*` minus `operator`.
- Create (deferred to task.0382 if more natural there): `tests/ci-invariants/single-node-scope-parity.test.ts` — shared-fixture parity between CI gate logic and runtime resolver.
- Modify: `docs/spec/node-ci-cd-contract.md` — add SINGLE_NODE_HARD_FAIL row to the merge-gate matrix.
- Modify: branch protection — add `single-node-scope` as a required check. Captured as the exact `gh api` invocation in the work item's `## Manual Steps` section (not just "do it in the UI").

### Out of scope

- Auto-splitting cross-node PRs (manual contributor action).
- Detecting _semantic_ cross-node coupling (e.g., a `packages/` change that breaks node A but not node B) — that's task.0382's runtime resolver + the per-node reviewer's job.
- Retroactive enforcement on already-merged PRs.

## Manual Steps

The CI job and meta-test land via this PR. Making the check _required_ in branch protection is a one-time human action, captured here so the next agent does not have to rediscover it:

```bash
gh api -X PATCH repos/Cogni-DAO/node-template/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": false,
    "contexts": ["single-node-scope", "<existing checks…>"]
  }
}
JSON
```

`deploy_verified: true` on this work item is blocked until the above runs and `gh api repos/Cogni-DAO/node-template/branches/main/protection` shows `single-node-scope` in the required contexts list.

## Links

- Handoff: [handoff](../handoffs/task.0381.handoff.md)

## Validation

```yaml
exercise: |
  # 1. Cross-node PR — touches nodes/poly/ and nodes/resy/.
  #    Expectation: job FAILS with annotation naming poly + resy.
  # 2. Node + operator PR — touches nodes/poly/ and nodes/operator/.
  #    Expectation: job FAILS with annotation naming poly + operator
  #    (operator is a domain, not an exemption).
  # 3. Node + infra PR — touches nodes/poly/ and packages/foo/.
  #    Expectation: job FAILS with annotation naming poly + operator
  #    (packages/ is operator's domain).
  # 4. Operator-domain PR — touches nodes/operator/, packages/, .github/, docs/.
  #    Expectation: job PASSES — single domain (operator), span is fine.
  # 5. Single-node PR — touches only nodes/poly/.
  #    Expectation: job PASSES.
  # 6. Add a stub `nodes/ai-only/` directory locally and run `pnpm test:ci`.
  #    Expectation: meta-test FAILS with "Add nodes/ai-only/** filter (and
  #    matching negation in the operator filter) to single-node-scope job."
observability: |
  - GitHub Actions run for the cross-node test PR shows the `single-node-scope`
    job red with a `::error::` annotation surfaced in the PR Files Changed view.
  - `gh api repos/Cogni-DAO/node-template/branches/main/protection` lists
    `single-node-scope` in `required_status_checks.contexts` (post Manual Step).
  - `pnpm test:ci` includes `single-node-scope-meta.test.ts` and passes on main.
```
