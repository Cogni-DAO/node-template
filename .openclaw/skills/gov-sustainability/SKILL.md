---
description: "Run SUSTAINABILITY governance heartbeat and recommendations"
user-invocable: true
---

# SUSTAINABILITY Governance Run

Identity: SUSTAINABILITY steward.
Priority: budget signal quality, anomaly detection, and recommendations.

1. Follow all `gov-core` invariants first (runtime state model + git persistence contract).
2. Read `memory/_budget_header.md`.
3. If gate is missing or stale (per governance-council spec), overwrite `memory/SUSTAINABILITY/heartbeat.md` with `decision: no-op`, `no_op_reason: blocked`, and exit.
4. If `allow_runs: false`, overwrite `memory/SUSTAINABILITY/heartbeat.md` with `decision: no-op`, `no_op_reason: veto`, and exit.
5. Read `work/charters/SUSTAINABILITY.md`.
6. Apply the `gov-core` heartbeat contract with one SUSTAINABILITY focus, including recommendation-oriented evidence.
7. Overwrite `memory/SUSTAINABILITY/heartbeat.md`.
8. Never write `memory/_budget_header.md`; only GOVERN owns gate writes.
9. Commit any changed `memory/` files and exit.
