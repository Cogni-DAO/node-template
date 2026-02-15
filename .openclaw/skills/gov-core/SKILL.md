---
description: "Core governance heartbeat workflow (single focus, single decision)"
user-invocable: true
---

# Governance Core

Run a tiny heartbeat. Keep scope strict.
Write output to `memory/{CHARTER}/YYYY-MM-DD.md` (per-run, ephemeral).

## Contract

- Select exactly one focus.
- Return exactly one decision: `action` or `no-op`.
- If `no-op`, include one reason: `veto`, `wip_full`, `blocked`, or `no_delta`.
- Include one expected measurable delta with a date.
- Include a cost guard with explicit keys:
  - `max_tokens`
  - `max_tool_calls`
  - `escalation_requested`
- Include evidence refs (files/PRs/items).
- When blocked, set `cost_guard.escalation_requested: true` so GOVERN can pick it up next cycle.

## Output Template

```yaml
charter: <CHARTER>
focus: <one metric | one item | one dashboard row>
decision: action | no-op
no_op_reason: veto | wip_full | blocked | no_delta # required if no-op
expected_outcome:
  metric: <name>
  target: <delta or threshold>
  by_date: YYYY-MM-DD
cost_guard:
  max_tokens: <int>
  max_tool_calls: <int>
  escalation_requested: <true|false>
evidence:
  - <file-or-pr-or-item-ref>
```

## Syntropy

- Edit > create
- Dedupe > expand
- Prune > archive
- Do not fan out

Exit immediately after writing the heartbeat output.
