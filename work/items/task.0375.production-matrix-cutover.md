---
id: task.0375
type: task
title: "Production matrix cutover — extend per-node lanes to prod"
status: needs_design
priority: 2
rank: 1
estimate: 3
summary: "Follow-up to task.0372. After candidate-a + preview ship the per-node matrix model, design and ship the production half: refactor production-applicationset.yaml to 4 git generators, fan-out the production half of promote-and-deploy.yml, and resolve release.yml current-sha semantics for per-node preview promotion."
outcome: "Production environment has the same per-node lane isolation as candidate-a + preview (a failed verify on one node cannot block siblings). release.yml has a documented, verified rule for selecting 'what's promotable to prod' from per-node preview branches — either a roll-up commit on deploy/preview or per-node release timing."
spec_refs:
  - docs/spec/ci-cd.md
assignees: []
project: proj.cicd-services-gitops
created: 2026-04-25
updated: 2026-04-25
labels: [ci-cd, deployment, task.0372-followup]
external_refs:
  - work/items/task.0372.candidate-flight-matrix-cutover.md
---

# task.0375 — Production matrix cutover (deferred follow-up)

## Why deferred from task.0372

dev2 design review on task.0372 (2026-04-25) flagged Gap 3: `release.yml` reads `deploy/preview/.promote-state/current-sha` to decide what's promotable to prod. After per-node preview branches, no single SHA represents "all preview is green". Two acceptable answers:

- **(a) Roll-up branch.** Final aggregate job in flight-preview commits a roll-up SHA to `deploy/preview` only when all matrix cells passed; release.yml keeps reading from there.
- **(b) Per-node release timing.** Each node releases on its own cadence; release.yml fans out per-node, no roll-up.

Picking (a) vs (b) without first observing how candidate-a + preview behave under the matrix is premature. task.0372 ships scoped to candidate-a + preview (with deploy/preview fast-forwarded to a roll-up commit so release.yml's read remains valid as a transitional measure). This task picks the long-term answer.

## Open questions

- Does `release.yml`'s current-sha read need to remain monolithic, or can it fan out per-node?
- If roll-up: where does the roll-up commit live, and what guarantees does it carry (all-green only? partial-green with explicit waivers?)?
- Production digest seed: still an open Known Unknown (per ci-cd.md). This task is a candidate consolidation point.

## Dependencies

- **Hard-blocked on**: task.0372 merged + candidate-a / preview lane isolation observed in production for at least one full release cycle.
- **Soft-blocked on**: task.0374 (catalog SSoT) — a per-node release.yml fan-out reads the same catalog.

## Out of scope

- Anything that lands before observing task.0372's matrix in production.

## Validation

Deferred — this task is at `needs_design`. Validation block to be authored when the task moves to `needs_implement`.
