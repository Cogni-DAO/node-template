---
id: bug.0371
type: bug
title: "operator pr-build doesn't bust BUILD_SHA layer cache on CI-only PRs"
status: needs_design
priority: 2
rank: 3
estimate: 1
created: 2026-04-25
updated: 2026-04-25
project: proj.cicd-services-gitops
assignees: []
summary: "When a PR's diff is CI/workflow-only (no operator app source), pr-build for operator hits Docker layer cache and produces an image at `pr-{N}-{HEAD}-operator` whose internal BUILD_SHA is the value from the FIRST build that produced byte-identical image content — typically a prior commit's SHA. poly and resy correctly invalidate cache when BUILD_SHA changes; operator does not. verify-buildsha.sh then fails for operator on these flights even though the substrate is healthy."
outcome: "Every operator pr-build with a new BUILD_SHA produces an image whose `/version.buildSha` matches that BUILD_SHA, regardless of whether app-source changed. Same parity as poly + resy."
---

# Bug: operator pr-build doesn't bust BUILD_SHA layer cache on CI-only PRs

## Symptoms

- task.0374 dogfood flight (run #24926033843, candidate-flight #1053 from `feat/catalog-ssot-pivot`) verify-candidate failure:
  ```
  ❌ operator: buildSha=8c36deba9a7e != expected 173c26e6ebe7
  ✅ poly:     buildSha=173c26e6ebe7 matches expected
  ✅ resy:     buildSha=173c26e6ebe7 matches expected
  ```
- The promoted operator digest in GHCR (`pr-1053-173c26e6e-operator`) is **byte-identical** to the digest at `pr-1053-8c36deba9-operator`. Docker layer cache reused the entire build.
- poly and resy at the same SHA-pair correctly produced two distinct content-digests with their respective BUILD_SHA values baked in.

## Root cause hypothesis

Operator's Dockerfile receives BUILD_SHA as a build-arg, but the layer that consumes it (writes `/version.buildSha`) is positioned such that Docker treats the resulting image as content-equivalent across BUILD_SHA values. poly and resy's Dockerfiles either bake BUILD_SHA earlier (forcing downstream layers to invalidate) or use a different content-derivation path.

Latent until now because real-PR flights almost always include app-code changes that incidentally bust cache before BUILD_SHA bake-in. CI-only PRs (workflow / script / catalog edits with no node code change) are the rare case that exposes it.

## Reproduce

1. Open a PR that changes only `.github/workflows/**`, `scripts/ci/**`, or `infra/catalog/**` — nothing under `nodes/operator/**`.
2. Push two commits in sequence (e.g., A then B). pr-build runs for both.
3. `docker buildx imagetools inspect ghcr.io/cogni-dao/cogni-template:pr-{N}-A-operator` → digest D.
4. `docker buildx imagetools inspect ghcr.io/cogni-dao/cogni-template:pr-{N}-B-operator` → digest D (same).
5. Pod from D serves `BUILD_SHA=A` regardless of which tag deployed it.

Compare to poly: same exercise produces two distinct digests, each with its own BUILD_SHA.

## Validation

### exercise

1. Land the fix on a PR.
2. Open a CI-only PR (e.g., docs-only or workflow-only diff). Push two commits A → B.
3. Inspect operator digests: `pr-{N}-A-operator` and `pr-{N}-B-operator` must be **distinct** content-digests.
4. Pod from each digest must serve its respective BUILD_SHA at `/version.buildSha`.
5. Re-run the task.0374 dogfood flight — operator's verify-buildsha must pass.

### observability

- `docker buildx imagetools inspect` digest comparison across two tags built at the same source state but different BUILD_SHA values returns two different digests.
- candidate-flight verify-buildsha green for operator on a CI-only PR.

## Out of scope

- Re-architecting the multi-stage Docker build for operator. Find the smallest change that puts BUILD_SHA into a cache-key-affecting position; mirror what poly/resy do.
- General build-cache hygiene across all targets — covered by task.0260 if it ever ships affected-only image builds.

## References

- task.0374 dogfood flight: GHA run #24926033843 (failure case), run #24926222261 (re-flight against real-PR #1033 pending at file time).
- bug.0313 (PR #873): the original BUILD_SHA-must-match-PR-head fix. Same class, different surface — that one was about ephemeral merge-SHA vs PR head; this one is about Docker layer cache reusing baked BUILD_SHA. Read for context.
- `nodes/operator/app/Dockerfile`, `nodes/poly/app/Dockerfile`, `nodes/resy/app/Dockerfile` — diff to find why poly/resy bust cache and operator doesn't.
