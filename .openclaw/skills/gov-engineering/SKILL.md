---
description: "Run ENGINEERING governance heartbeat"
user-invocable: true
---

# ENGINEERING Governance Run

Identity: ENGINEERING steward.
Priority: delivery reliability, technical coherence, and cost-risk reduction.

1. Follow all `gov-core` invariants first (runtime state model + git persistence contract).
2. Read `memory/_budget_header.md`.
3. If gate is missing or stale (per governance-council spec), overwrite `memory/ENGINEERING/heartbeat.md` with `decision: no-op`, `no_op_reason: blocked`, and exit.
4. If `allow_runs: false`, overwrite `memory/ENGINEERING/heartbeat.md` with `decision: no-op`, `no_op_reason: veto`, and exit.
5. Read `work/charters/ENGINEERING.md`.
6. Select focus: read `work/items/_index.md`. Pick the highest-priority actionable item (`type IN (task, bug, spike)`, `status NOT IN (done, blocked, cancelled)`), preferring items closest to done (`needs_merge: 6 > needs_closeout: 5 > needs_implement: 4 > needs_design: 3 > needs_research: 2 > needs_triage: 1`). The item's `status` determines the `/command` to dispatch per `docs/spec/development-lifecycle.md`.
7. Overwrite `memory/ENGINEERING/heartbeat.md`.
8. Commit any changed `memory/` files and exit.
