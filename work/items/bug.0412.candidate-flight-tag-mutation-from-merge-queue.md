---
id: bug.0412
type: bug
title: "candidate-flight verify fails when merge-queue rebuild mutates pr-{N}-{X} GHCR tag mid-flight"
status: needs_design
priority: 1
rank: 10
estimate: 3
created: 2026-04-28
updated: 2026-04-28
summary: "pr-build.yml tags both pull_request and merge_group builds with `pr-{N}-{ORIGINAL_HEAD_SHA}`, even though the two builds bake different `BUILD_SHA` labels. When PR #1098 entered the merge queue, the merge_group rebuild overwrote the GHCR tag pointer for `pr-1098-de87108b8...` with a new image whose `/version.buildSha` is the queue commit `33aa1a003...`. A candidate-flight dispatched against PR head `de87108b8...` resolved that tag → got the merge_group's digest → Argo synced → /version returned `33aa1a003`, and verify-buildsha failed with a phantom mismatch even though the deploy branch was internally consistent. Per Derek: candidate-a flights must be node-independent and unaffected by other merge activity."
outcome: "pr-build.yml emits distinct GHCR tags for pull_request vs merge_group events so the PR-head image is immutable post-build. Candidate-flight resolves the immutable PR-time tag and is unaffected by any subsequent merge-queue rebuild for the same PR. flight-preview.yml continues to consume the merge_group's rebased-tree image via the new tag namespace."
spec_refs:
  - docs/spec/ci-cd.md
assignees: []
project: proj.ci-cd-reusable
labels: [cicd, candidate-flight, merge-queue, ghcr, race]
---

# bug.0412 — candidate-flight verify fails when merge-queue rebuild mutates pr-{N}-{X} GHCR tag

## Failing flight

https://github.com/Cogni-DAO/node-template/actions/runs/25031806256 (PR #1098, 2026-04-28 03:14 UTC).

verify-candidate (operator, resy) failed:

```
EXPECTED_BUILDSHA: de87108b8a043e1a9025cc519cfe9ac4fe45e88f
NODES: operator
…
❌ operator: buildSha=33aa1a00399d != expected de87108b8a04 after 90s / 18 attempts
```

Poly happened to win the race (its `/version` returned the expected SHA); operator + resy lost it.

## Root cause — `pr-{N}-{X}` GHCR tag mutation

`.github/workflows/pr-build.yml` produces images on **both** `pull_request` and `merge_group` events. The tag is built from `ORIGINAL_HEAD_SHA` (the PR head), but `BUILD_SHA` (baked into the image as `/version.buildSha`) differs by event:

- `pull_request`: `BUILD_SHA = ORIGINAL_HEAD_SHA = de87108b8…` → image tagged `pr-1098-de87108b8…`
- `merge_group`: `BUILD_SHA = queue commit Y = 33aa1a003…` → image **also** tagged `pr-1098-de87108b8…`

The second push silently overwrites the GHCR tag pointer. The PR-time digest is no longer reachable by tag. Verified in PR Build run `25031696932` (merge_group event for PR #1098): `IMAGE_TAG: pr-1098-de87108b8…`, `BUILD_SHA: 33aa1a003…`.

This collision is intentional for the preview path — `flight-preview.yml` retags `pr-{N}-{X} → preview-{mainSHA}` on push to main, and the design wants the preview env to reflect the _rebased_ tree, not the PR head. But it breaks any consumer that resolves `pr-{N}-{X}` _between_ the merge_group rebuild and the post-merge retag — including `candidate-flight.yml`.

## Why "exclusive slot" framing in the original triage was a red herring

I initially suspected main's auto-promote was writing to `deploy/candidate-a-{operator,resy}` mid-flight. Git log on those branches between the flight push (03:12:24) and the next flight (03:37:15) shows **no intervening commits**: the deploy branch is untouched. There is no auto-promote path to candidate-a — `infra/k8s/argocd/check-image-updater-scope.sh` enforces an empty allowlist (candidate-a + production are explicitly annotation-free), and `promote-and-deploy.yml` only writes `deploy/{preview,production}-*`. The race is in GHCR tag space, not in the deploy branch.

## Timeline (PR #1098)

| Time (UTC) | Event                                                                                                                                                 |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 03:01:35   | `pr-build` (pull_request) builds at `de87108b8`, pushes `pr-1098-de87108b8` (BUILD_SHA=de87108b8).                                                    |
| 03:07:34   | `pr-build` (merge_group) builds at queue commit `33aa1a003`, **overwrites** `pr-1098-de87108b8` tag (BUILD_SHA=33aa1a003).                            |
| ~03:08     | `candidate-flight` resolves `pr-1098-de87108b8` → gets the merge_group digest, pins it in `deploy/candidate-a-{operator,poly,resy,scheduler-worker}`. |
| 03:12:24   | Flight push lands on the per-node deploy branches.                                                                                                    |
| 03:14:32   | PR #1098 squash-merges to `main`.                                                                                                                     |
| 03:14:52   | verify-buildsha hits `/version` — returns `33aa1a003` (the actually-deployed image's BUILD_SHA). Hard mismatch vs. EXPECTED `de87108b8`.              |

## Fix shape

Split the GHCR tag namespace by event so the PR-head image is immutable post-build:

- `pull_request` → `pr-{N}-{ORIGINAL_HEAD_SHA}` (unchanged)
- `merge_group` → `mq-{N}-{BUILD_SHA}` (new — keyed on the queue commit)

Update `flight-preview.yml` (the only post-merge consumer of the merge_group rebuild) to resolve `mq-{N}-{HEAD_SHA}` on push to main. With merge queue enabled, the squash-merged main commit equals the queue commit, so `HEAD_SHA = github.sha = mq-tag SHA`. Direct pushes to main are already explicitly forbidden in the same workflow (no PR resolvable → exits 1).

`candidate-flight.yml`, `resolve-pr-build-images.sh`, and any other consumer of `pr-{N}-{X}` keep the existing tag — but it now strictly references the immutable PR-time image.

## Validation

```yaml
exercise: |
  1. Push this PR. Wait for `pr-build` (pull_request) to finish.
  2. Trigger `candidate-flight` against the PR head SHA
     (`gh workflow run candidate-flight.yml -f pr_number=<N>`).
  3. Enqueue the PR via merge queue (`gh pr merge --auto --squash <N>`)
     so that `pr-build (merge_group)` runs in parallel with the flight.
  4. Confirm `candidate-flight` verify-buildsha succeeds for every promoted
     node — `/version.buildSha` per node equals the PR head SHA.
  5. After merge, confirm `flight-preview` resolves images at
     `mq-{N}-{mainSHA}` and re-tags them to `preview-{mainSHA}` cleanly.
observability: |
  - candidate-flight verify-buildsha logs: `/version.buildSha` matches
    EXPECTED_BUILDSHA per node (no 33aa1a-style mismatch).
  - flight-preview logs: "Resolve PR image digests" succeeds against the
    new `mq-` tag pattern; "Re-tag PR images" emits `preview-{mainSHA}`
    entries for every affected target.
  - GHCR `pr-{N}-{X}` tag pointer is unchanged after the merge_group
    build (verifiable via `docker buildx imagetools inspect
    ghcr.io/cogni-dao/cogni-template:pr-{N}-{X} --format
    '{{.Manifest.Digest}}'` before vs. after merge).
```
