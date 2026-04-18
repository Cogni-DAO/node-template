---
id: task.0320
type: task
title: "Per-node candidate flighting (partial promotion + per-node leases)"
status: needs_triage
priority: 3
rank: 99
estimate: 3
summary: "Replace the single candidate-a lease with per-node leases and filter partial overlay promotion by the nodes being flighted. Lets teams fly one node's PR while another node is broken or being flighted concurrently. V0 is manually scoped (coordinator picks the node); no auto-derivation."
outcome: |
  - `candidate-flight.yml` accepts a required `nodes` CSV input (e.g. `poly` or `operator,migrator`).
  - Per-node lease files under `infra/control/` (one per node; legacy single-file `candidate-lease.json` retired or re-shaped).
  - `acquire-candidate-slot.sh` / `release-candidate-slot.sh` operate on the lease subset listed in `nodes`.
  - `promote-build-payload.sh` honors `NODES_FILTER`: overwrites digests only for the listed targets; untouched overlay digests remain at their last-good value.
  - `smoke-candidate.sh` honors `NODES_FILTER`: only the flighted subset is asserted.
  - `wait-for-argocd.sh` honors `NODES_FILTER`: only the flighted apps are awaited.
  - pr-coordinator-v0 skill updated: picks one PR AND one node per flight; confirms the node with the user alongside the PR.
spec_refs:
  - docs/spec/ci-cd.md
assignees: []
project: proj.cicd-services-gitops
created: 2026-04-17
updated: 2026-04-18
labels: [cicd, deployment]
---

# task.0320 — Per-node candidate flighting

## Problem

`candidate-flight.yml` today acquires a single `candidate-lease.json` and promotes the entire built-image payload into `deploy/candidate-a` atomically. Two consequences:

1. A broken node (e.g. poly build failing) blocks flights that only wanted to touch resy — the whole overlay write is all-or-nothing.
2. Only one PR can hold candidate-a at a time, regardless of whether two PRs touch disjoint nodes.

As node count grows and team activity parallelizes, both constraints become artificial serialization.

## Outcome

- **Per-node leases.** Lease state lives per node under `infra/control/` (e.g. `candidate-lease-poly.json`) instead of a single global file. A flight takes only the leases for the nodes it's about to change.
- **Partial overlay promotion.** `promote-build-payload.sh` writes digests only for the listed targets; the rest of the overlay is untouched at its last-good value.
- **Per-node smoke + Argo wait.** `smoke-candidate.sh` and `wait-for-argocd.sh` only assert / block on the flighted subset, so an unrelated broken node doesn't fail this flight.
- **Manual node selection (v0).** `candidate-flight.yml` takes a required `nodes` input. The pr-coordinator-v0 skill specifies one node at a time per dispatch. No auto-derivation from the build manifest — a follow-up can add that once the manual model is proven.
- **Infra lever remains a full stop.** `candidate-flight-infra.yml` still touches the whole VM; v0 rule is "coordinator must not dispatch infra while any node lease is busy." No new lease-set acquire logic required.

## Non-goals (v0)

- **No auto-classifier** deriving `nodes` from the PR diff or build manifest. Coordinator specifies.
- **No multi-writer git-push race handling** on `deploy/candidate-a`. V0 relies on the coordinator's serialization (one dispatch at a time per node, rare enough globally that natural ordering works).
- **No change to release / production promotion.** Overlay promotion there already runs digest-by-digest.
- **No per-node candidate VMs.** Shared candidate-a VM; per-node leases only.

## Validation

- Flight PR A with `nodes=poly`: only poly digest changes in `deploy/candidate-a`; operator/resy digests are unchanged in the resulting commit diff.
- Flight PR B (broken poly, healthy resy) with `nodes=resy`: flight succeeds, resy is live on candidate-a, poly digest on overlay still points at last-good.
- Two dispatches for different nodes at roughly the same time: both acquire their own lease, both run; one `git push` may need a manual retry if they land simultaneously (acceptable in v0).
- `smoke-candidate.sh NODES_FILTER=poly`: asserts only poly endpoints.
- `wait-for-argocd.sh APPS=<subset>`: only blocks on the subset.
- pr-coordinator-v0 dispatch: prompts for PR + node, dispatches with `-f nodes=<node>`.

## Notes

- `promote-build-payload.sh` already reads the payload JSON — a filter pass there is the core diff.
- Lease acquire/release scripts already exist (`acquire-candidate-slot.sh`, `release-candidate-slot.sh`); extend them to a `LEASE_NAME` param or equivalent.
- Multi-node / shared-package PRs use `nodes=operator,poly,resy` to take multiple leases in one flight. Still explicit, not auto.
- Follow-up (not this task): auto-derive `nodes` from `build-manifest.json`; rebase-retry loop for concurrent push safety; lease-set acquire for the infra lever.
