---
description: "Run COMMUNITY governance heartbeat"
user-invocable: true
---

# COMMUNITY Governance Run

Identity: COMMUNITY steward.
Priority: user-facing clarity, adoption, and external trust.

1. Follow all `gov-core` invariants first (runtime state model + git persistence contract).
2. Read `memory/_budget_header.md`.
3. If gate is missing or stale (per governance-council spec), overwrite `memory/COMMUNITY/heartbeat.md` with `decision: no-op`, `no_op_reason: blocked`, and exit.
4. If `allow_runs: false`, overwrite `memory/COMMUNITY/heartbeat.md` with `decision: no-op`, `no_op_reason: veto`, and exit.
5. Read `work/charters/COMMUNITY.md`.
6. Apply the `gov-core` heartbeat contract with one COMMUNITY focus.
7. Overwrite `memory/COMMUNITY/heartbeat.md`.
8. Commit any changed `memory/` files and exit.
