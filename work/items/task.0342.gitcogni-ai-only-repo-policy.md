---
id: task.0342
type: task
title: "gitcogni — ai-only-repo-policy rule: scope fence + auto-approve-when-green"
status: needs_design
priority: 1
estimate: 2
rank: 6
summary: "New gitcogni AI rule that canary PRs must satisfy. Enforces CANARY_SCOPE_FENCE (paths the canary may/may not touch) and enables auto-approval when standard CI + candidate-flight are green. No human reviewer required — AI PRs get merged on signal quality alone."
outcome: "`.cogni/rules/ai-only-repo-policy.yaml` exists and is wired into `.cogni/repo-spec.yaml` gates. A canary-authored PR that modifies only `nodes/canary/**` with green CI + green candidate-flight auto-merges. A canary-authored PR touching `infra/**` or other nodes auto-fails the gate."
spec_refs:
  - canary
  - gitcogni-rules
assignees: derekg1729
project: proj.cogni-canary
created: 2026-04-20
updated: 2026-04-20
labels: [canary, gitcogni, policy, autonomy]
external_refs:
  - .cogni/rules/
  - .cogni/repo-spec.yaml
---

# gitcogni ai-only-repo-policy

## Context

The canary is a PR-churn machine. Without a new policy:

- Every PR needs a human reviewer (unscalable)
- Scope fence is enforced only by author convention, not by the gate (brittle)

This rule makes the canary's autonomy enforceable by the bot, not by human vigilance.

## Policy shape

```yaml
id: cogni-git-review-ai-only-repo-policy
schema_version: "0.3"
blocking: true
workflow_id: ai-only-repo

evaluations:
  - scope_fence:
      description: PR only touches allowed paths
      allowed_paths:
        - "nodes/canary/**"
        - "work/items/**"
        - "docs/research/**"
      denied_paths:
        - ".github/workflows/**"
        - "scripts/ci/**"
        - "infra/**"
        - "work/charters/**"
        - "nodes/operator/**"
        - "nodes/poly/**"
        - "nodes/resy/**"
        - "nodes/node-template/**"
  - ci_green:
      description: Standard CI (pnpm check, pnpm check:full) passes
      required_checks: ["ci/check", "ci/check-full"]
  - candidate_flight_green:
      description: candidate-flight.yml reached Healthy + verify-buildsha
      required_checks: ["candidate-flight/verify-buildsha"]
  - author_allowlist:
      description: PR author is a canary-owned bot identity
      allowed_authors: ["canary-bot[bot]", "canary-4omini[bot]"]

success_criteria:
  all_of:
    - metric: scope_fence
      eq: true
    - metric: ci_green
      eq: true
    - metric: candidate_flight_green
      eq: true
    - metric: author_allowlist
      eq: true

auto_merge: true
```

## Deliverables

- [x] `.cogni/rules/ai-only-repo-policy.yaml` stub committed in this PR
- [ ] Rule schema validation — does gitcogni currently support `allowed_paths`/`denied_paths`/`allowed_authors`/`auto_merge`? If not, design + implement the schema extension
- [ ] `.cogni/repo-spec.yaml` gates block — add `- type: ai-rule / rule_file: ai-only-repo-policy.yaml`
- [ ] GitHub App / PAT for `canary-bot[bot]` — scoped write to `nodes/canary/**`, `work/items/**`, `docs/research/**` only
- [ ] Branch protection on `main` — require `ai-only-repo-policy` check for PRs from canary authors

## Validation

- `exercise:` — manually open a PR as `canary-bot` touching `infra/k8s/base/canary/kustomization.yaml`. The policy gate fails with `scope_fence: false`. Then open a PR touching only `nodes/canary/app/src/foo.ts`. Gate passes (assuming CI + candidate-flight pass).
- `observability:` — policy check event appears in gitcogni audit log for each canary PR; auto-merged PRs have `merged_by: canary-bot[bot]` in GitHub event stream.

## Non-goals

- Applying this policy to non-canary PRs (operator/poly/resy keep human review)
- Replacing human review for charter changes in `work/charters/**` (explicitly denied in scope)

## Open questions

- Does gitcogni's current schema support path-based allow/deny? If not, this task balloons into a gitcogni feature PR first. Check `@cogni/git-cogni` package schema before implementing.
- Auto-merge mechanism: GitHub's native `--auto` flag vs. an explicit merge bot. Lean: native `--auto` is simpler.
