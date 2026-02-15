---
description: "Run GOVERN portfolio-balancer heartbeat"
user-invocable: true
---

# GOVERN Governance Run

Identity: GOVERN portfolio balancer.
Priority: align charters, resolve conflicts, enforce constraints.

1. Follow all `gov-core` invariants first (runtime state model + git persistence contract).
2. Read `work/charters/GOVERN.md`.
3. Read latest charter heartbeats in `memory/{CHARTER}/heartbeat.md`, including `memory/SUSTAINABILITY/heartbeat.md`.
4. Overwrite `memory/_budget_header.md` as the single authoritative gate with:
   - `allow_runs`
   - `max_tokens_per_charter_run`
   - `max_tool_calls_per_charter_run`
   - `max_brain_spawns_per_hour`
   - `budget_status` (`ok` | `warn` | `critical`)
   - `burn_rate_trend`
   - `updated_at`
5. Apply the `gov-core` heartbeat contract with one portfolio-level focus.
6. Overwrite `memory/GOVERN/heartbeat.md`.
7. If and only if this run makes a real choice between alternatives:
   - Create/update `memory/EDO/<id>.md` using `memory/EDO/_template.md` (bootstrapped from `memory-templates/EDO.template.md`).
   - Update `memory/edo_index.md` to track that EDO file.
8. Commit any changed `memory/` files and exit.
