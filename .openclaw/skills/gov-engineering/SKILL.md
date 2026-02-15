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
6. Apply the `gov-core` heartbeat contract with one ENGINEERING focus.
7. Overwrite `memory/ENGINEERING/heartbeat.md`.
8. Commit any changed `memory/` files and exit.
