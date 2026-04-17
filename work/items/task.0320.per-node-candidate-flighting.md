---
id: task.0320
type: task
title: "Per-node candidate flighting (partial overlay promotion)"
status: needs_triage
priority: 3
rank: 99
estimate: 3
summary: "Let candidate-flight.yml promote a subset of nodes into deploy/candidate-a instead of stomping the whole overlay. Unblocks flighting one node (e.g. resy) when another (e.g. poly) is broken, without adding per-node candidate slots."
outcome: |
  - `candidate-flight.yml` accepts a `nodes` CSV input (default = all targets present in the PR payload).
  - `scripts/ci/promote-build-payload.sh` honors a `NODES_FILTER` env: overwrites digests only for the listed targets, leaves untouched digests in the overlay alone.
  - `scripts/ci/smoke-candidate.sh` accepts `NODES_FILTER` and only asserts the flighted subset.
  - `candidate-a` remains a single serialized slot — no new overlays, no new slots.
  - Docs (`docs/spec/ci-cd.md` candidate-flight section) updated to describe partial promotion semantics.
spec_refs:
  - docs/spec/ci-cd.md
assignees: []
project: proj.cicd-services-gitops
created: 2026-04-17
updated: 2026-04-17
labels: [cicd, deployment]
---

# task.0320 — Per-node candidate flighting

## Problem

`candidate-flight.yml` promotes the PR's entire built-image payload into `deploy/candidate-a` atomically. If one node build or smoke is broken, the whole flight fails and no other node can reach candidate-a from that PR. That is counter to the per-node independence goal of the affected-build pipeline — affected-build produces per-node images in parallel, but the promotion lane collapses them back into a unit.

Adding per-node candidate slots (`candidate-a-poly`, `candidate-a-resy`, …) would unlock parallel flights but is a larger architectural move — new overlays, new ApplicationSets, new DNS, new lease files.

The minimalist unlock is **partial promotion**: keep one serialized `candidate-a` slot, but allow a flight to overwrite only the digests for the selected nodes and leave the rest of the overlay alone.

## Outcome

- `candidate-flight.yml` gains a `nodes` input (CSV, default = all built targets in the PR payload).
- `promote-build-payload.sh` filters the payload by `NODES_FILTER`; unfiltered slots in the overlay retain their prior digest.
- `smoke-candidate.sh` honors `NODES_FILTER`; asserts only the flighted subset.
- No new slots, no new overlays. Candidate-a remains serialized.

## Non-goals

- No per-node candidate slots (deferred — revisit when flight contention is measurable).
- No change to the release / production promotion lane.
- No change to pr-build matrix (handled separately — see the pr-build parallel-matrix PR).

## Validation

- Flight PR A with `nodes=poly`: only poly digest changes in `deploy/candidate-a`; operator/resy digests on the overlay are unchanged in the resulting commit diff.
- Flight PR B (broken poly, healthy resy) with `nodes=resy`: flight succeeds, resy is live on candidate-a, poly digest on overlay still points at last-good.
- Default behavior (no `nodes` input) matches today's semantics — all built targets promoted.

## Notes

- `promote-build-payload.sh` already reads the payload JSON — a filter pass there is the entire diff.
- Slot acquisition stays binary (one PR holds candidate-a at a time). Parallel flights are out of scope.
- Follow-up task can introduce per-node slots if/when serialization is a measured bottleneck.
