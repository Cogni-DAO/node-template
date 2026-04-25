---
id: task.0373
type: task
title: "CI-owned candidate-a digest seed (mirror task.0349 for candidate-a)"
status: needs_design
priority: 1
rank: 1
estimate: 3
summary: "Apply task.0349's pattern (CI owns preview digest seed on main, rsync stops being authority) to the candidate-a environment. Kills the rsync-clobber regression class where stale PR-branch overlay digests roll unrelated nodes to bad images during candidate-flight."
outcome: "After each successful candidate-flight, exactly one `chore(candidate-a): …` commit updates `main:infra/k8s/overlays/candidate-a/**` digest pins for promoted apps; non-promoted overlays retain prior pin. PR-branch rsync onto deploy/candidate-a stops introducing digest regressions because every PR's branch (post-rebase or freshly opened) inherits a current seed from main. Rebase-before-flight bandage retired."
spec_refs:
  - ci-cd
assignees: []
project:
created: 2026-04-25
updated: 2026-04-25
labels: [ci-cd, infra, task.0349-followup]
external_refs:
  - work/items/task.0349.ci-owned-preview-digest-promotion.md
  - docs/spec/ci-cd.md
---

# task.0373 — CI-owned candidate-a digest seed

## Problem

`candidate-flight.yml`'s `Sync base and catalog to deploy branch` step rsyncs `infra/k8s/overlays/candidate-a/**` from the PR branch onto `deploy/candidate-a`. When the PR branch's overlay digests are stale (PR opened before a recent main change, or rebase missed), the rsync writes a regressing digest, Argo rolls the affected node, and the new pod fails — observed twice on PR #1040 (operator rolled to a pre-task.0370 image lacking `migrate.mjs`).

Operational bandage: rebase every PR onto current main before flight. Brittle; agent committers will not consistently honor it.

## Authority model

Single writer for candidate-a digest seed on `main`: `infra/k8s/overlays/candidate-a/<app>/kustomization.yaml` digest fields. Same model as task.0349 v3 (preview).

`deploy/candidate-a` stays machine state + `.promote-state/`. Unchanged ownership.

## Approach (mirror task.0349)

- **Reference implementation**: [`scripts/ci/promote-preview-seed-main.sh`](../../scripts/ci/promote-preview-seed-main.sh) + [`.github/workflows/promote-preview-digest-seed.yml`](../../.github/workflows/promote-preview-digest-seed.yml). Mirror the shape, do not re-derive.
- **Trigger**: open question — `workflow_run` on Candidate Flight success vs. an explicit step inside `candidate-flight.yml` after promote. Argue in design.
- **Tri-state digest resolution**: same as task.0349. Resolve `imagetools` → else retain main pin if still valid → else fail.
- **Skip-self prefix**: extend the existing maintenance-prefix table in `flight-preview.yml` and add the same to `candidate-flight.yml`. Use `chore(candidate-a):`, or unify under `chore(seed):` if it can replace the preview prefix without breakage (argue).
- **Canonical target list**: [`scripts/ci/lib/image-tags.sh`](../../scripts/ci/lib/image-tags.sh) `ALL_TARGETS` / `NODE_TARGETS`. Never hardcode.
- **Spec**: update [`docs/spec/ci-cd.md`](../../docs/spec/ci-cd.md) authority section to extend task.0349's axiom to candidate-a.

## Out of scope

- Touching the shipped preview seed pieces. Additive only.
- Changing the `candidate-flight.yml` rsync model. The rsync stays; the seed makes its writes harmless.
- Production / canary digest seed. Different env, different task if needed.

## Validation

### exercise

1. Land this task; observe one `chore(candidate-a): …` commit on main after the next candidate-flight that promotes any image.
2. Take an open PR whose branch predates the seed (do not rebase). Dispatch candidate-flight.
3. Confirm operator/poly/resy not promoted by the PR retain the digests from main's seed (no rollout, no bad image).
4. Confirm the promoted node flies clean (`/version.buildSha` matches PR head_sha).

### observability

- GHA: digest-seed workflow summary lists per-target resolution outcome (resolved / retained / failed).
- `kubectl rollout status deployment/<node>-node-app -n cogni-candidate-a` succeeds for all 3 nodes within `verify-candidate` timeout, including for affected-only flights.

## Success criteria

- Zero rsync-clobber incidents (operator/resy rolling to stale digests because of a stale PR overlay) on candidate-flights post-merge.
- Rebase-before-flight bandage retired from operational guidance / agent rules.

## PR / Links

- Handoff: [handoff](../handoffs/task.0373.handoff.md)
