---
id: openclaw-govern-distributed
type: spec
title: "OpenClaw Distributed GOVERN: Charter-scoped reporting with bounded context"
status: draft
spec_state: draft
trust: draft
summary: "Governance runs are charter-scoped and trigger-routed (`COMMUNITY`, `ENGINEERING`, `SUSTAINABILITY`, `GOVERN`) through one shared prompt stack. Each run emits one compact heartbeat. SUSTAINABILITY writes budget veto header first. GOVERN acts as portfolio balancer and makes one decision."
read_when: "Understanding bounded GOVERN loops, implementing charter-scoped governance, or optimizing multi-call agent workflows."
implements: proj.context-optimization
owner: derekg1729
created: 2026-02-14
verified: 2026-02-14
tags: [openclaw, govern, architecture, context-optimization, governance]
---

# OpenClaw Distributed GOVERN: Charter-scoped reporting with bounded context

> **Problem**: A single GOVERN loop makes ~19 LLM calls with unbounded context growth (327 → 19K tokens), costing $5.50 and taking 90 seconds, before doing any productive work. **Solution**: Distribute GOVERN across charter-scoped agents. Each agent orients to its charter, picks work, reports findings in compressed form. Main GOVERN reads reports and makes one decision. Bounded context + lossless information preservation.

### Key References

|                          |                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| **Current Architecture** | [openclaw-workspace-spec](openclaw-workspace-spec.md) § GOVERNANCE_TRIGGER_ROUTING (Invariant 34) |
| **Context Analysis**     | [openclaw-context-optimization](openclaw-context-optimization.md) § Context Competition           |
| **Project**              | [proj.context-optimization](../../work/projects/proj.context-optimization.md)                     |

---

## Goal

Enable GOVERN loops to remain intelligent and thorough while staying under 10K uncached tokens and <30 seconds per execution. Do this by distributing work across charter-scoped agents, each writing compressed reports, with a lightweight main GOVERN aggregator making one high-priority decision per run.

## Non-Goals

- Changing how individual charter agents work (each remains free to be thorough within its domain)
- Replacing Temporal scheduler or heartbeat mechanism
- Changing how EDOs are recorded or reviewed
- Affecting user-message handling (only impacts GOVERN loop execution)

---

## Design

### Current State (Single Unbounded Loop)

```
GOVERN trigger (one message: "GOVERN")
  |
  v
[Agent reads GOVERN.md checklist: Orient → Pick → Execute → Maintain → Reflect]
  |
  +---> CALL 1: Read all work items (search + parse) = 7K tokens
  |       Output: agent picks 3 items
  |
  +---> CALL 2-7: Execute on each item (read spec, check dependencies, etc)
  |       Context grows: 10K → 12K → 15K → 18K → 22K → 27K
  |
  +---> CALL 8-15: Maintain phase (prune docs, close stale items, etc)
  |       Context: 27K → 29K (uncached tail: 327 → 19K)
  |
  +---> CALL 16-19: Reflect (write EDOs, update MEMORY.md)
  |       All prior context re-sent; output: <100 tokens per call
  |
  v
[Final output: user sees GOVERN summary]

RESULT: 19 calls × ~29K tokens = $5.50, 90 seconds, before any productive work
```

### Runtime State (Trigger-Routed Governance Skills)

```
Scheduler fires charter-scoped triggers by cron:
  - COMMUNITY
  - ENGINEERING
  - SUSTAINABILITY
  - GOVERN

Gateway agent (shared prompt stack: AGENTS/SOUL/TOOLS/MEMORY):
  - routes token to mapped governance skill
  - skill reads charter dashboard + relevant heartbeat notes
  - skill emits one compact heartbeat note
  - exits

SUSTAINABILITY run:
  - writes budget header first (veto gate)

GOVERN run:
  - reads charter heartbeats + budget header
  - resolves portfolio conflict
  - emits one balancing decision (EDO only for real choice)
```

### Execution Flow Diagram

```
┌────────────────────────────────────────────┐
│ Temporal schedules fire charter tokens      │
│ COMMUNITY / ENGINEERING / SUSTAINABILITY / │
│ GOVERN                                     │
└──────────────────────┬─────────────────────┘
                       │
                       v
        ┌──────────────────────────────────┐
        │ Gateway agent (shared prompt)    │
        │ SOUL trigger router maps token → │
        │ /gov-* skill                     │
        └──────────────────┬───────────────┘
                           │
                           v
      ┌────────────────────────────────────────────┐
      │ Skill reads charter dashboard + memory     │
      │ Emits one heartbeat (focus/decision/cost)  │
      │ Writes memory/{CHARTER}/YYYY-MM-DD.md      │
      └──────────────────┬─────────────────────────┘
                         │
                         v
          [SUSTAINABILITY writes veto header first]
          [GOVERN balances portfolio and decides]
```

### Heartbeat Contract (shared output shape)

Every governance run writes one compact heartbeat note to `memory/{CHARTER}/YYYY-MM-DD.md` with this exact shape:

- `charter`: one charter id
- `focus`: one object only (metric or work item or dashboard row)
- `decision`: `action` or `no-op`
- `no_op_reason`: required when decision is `no-op` (`veto`, `wip_full`, `blocked`, `no_delta`)
- `expected_outcome`: one measurable delta + date
- `cost_guard`: max tokens/tool calls for this run + escalation requested bool
- `evidence`: file refs / PR refs / item refs

`cost_guard` is recorded per run inside the heartbeat note in `memory/{CHARTER}/YYYY-MM-DD.md` (not in charter headers).

This contract prevents sprawl, keeps run cost bounded, and makes downstream GOVERN balancing deterministic.

---

## Core Invariants

| Rule                   | Constraint                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| ROUTE_BY_TRIGGER       | Scheduler sends one token (`COMMUNITY`, `ENGINEERING`, `SUSTAINABILITY`, `GOVERN`). SOUL router maps token to one governance skill immediately. |
| HEARTBEAT_CONTRACT     | Every run emits one heartbeat with the shared shape; no free-form report formats.                                                               |
| ONE_DECISION_PER_RUN   | Each run returns exactly one decision (`action` or `no-op`).                                                                                    |
| REPORTS_ARE_EPHEMERAL  | Charter notes live in `memory/{CHARTER}/YYYY-MM-DD.md`. Durable policy decisions move to committed docs only when warranted.                    |
| SUSTAINABILITY_VETO    | `SUSTAINABILITY` writes budget header first; other charters no-op when vetoed.                                                                  |
| GLOBAL_WRITE_WIP_CAP   | Write-work WIP is globally bounded (`<= 3`).                                                                                                    |
| GLOBAL_ESCALATION_CAP  | Brain/escalation runs are globally bounded (`<= 1 per hour`).                                                                                   |
| BOUNDED_CONTEXT_AND_IO | Governance skills keep output and tool usage small; no fan-out workflows inside a single run.                                                   |

---

## Implementation Contract

### Scheduler and Prompt Routing

Scheduler runs are charter-scoped and send one trigger token per run:

- `COMMUNITY`
- `ENGINEERING`
- `SUSTAINABILITY`
- `GOVERN`

The gateway agent loads one shared prompt stack (AGENTS/SOUL/TOOLS/MEMORY) and routes each trigger immediately to its mapped governance skill (`/gov-community`, `/gov-engineering`, `/gov-sustainability`, `/gov-govern`).

### Skill-Level Behavior

Each governance skill:

1. Reads its charter dashboard (`work/charters/{CHARTER}.md`)
2. Applies shared heartbeat contract
3. Writes one heartbeat note to `memory/{CHARTER}/YYYY-MM-DD.md`
4. Exits

`/gov-sustainability` writes budget header first (veto gate).  
`/gov-govern` reads charter heartbeats and budget header, resolves portfolio conflicts, and outputs one balancing decision (EDO only for real choices).

---

## File Pointers

| File                                                  | Purpose                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| `work/charters/`                                      | Charter definitions (charter-a.md, charter-b.md, etc.)                         |
| `work/charters/{name}-items.md`                       | Items assigned to each charter (optional; can use work/items with charter tag) |
| `memory/`                                             | Working notes + EDOs (ephemeral, reset-prone)                                  |
| `docs/governance/decisions.md`                        | Policy/architecture/cost EDOs (durable, committed decisions)                   |
| `.openclaw/skills/gov-core/SKILL.md`                  | Shared heartbeat contract and syntropy constraints                             |
| `.openclaw/skills/gov-*/SKILL.md`                     | Charter-specific governance wrappers                                           |
| `services/sandbox-openclaw/gateway-workspace/SOUL.md` | Trigger router and governance operating mode                                   |

---

## Open Questions

- [ ] How to assign items to charters? (tag-based, filename, separate index file?)
- [ ] Should charter GOVERN runs be sequential or parallel? (Parallel faster but risks resource contention)
- [ ] Timeout for waiting on all charter reports? (Suggest 60s, fail if any charter >45s)
- [ ] How to handle cross-charter dependencies? (Charter reports include dependency section; main GOVERN resolves)

---

## Related

- [openclaw-context-optimization](openclaw-context-optimization.md) — Context budget analysis that motivated this design
- [openclaw-workspace-spec](openclaw-workspace-spec.md) — Current GOVERN architecture (Invariant 34)
- [pm.openclaw-govern-call-storm.2026-02-14](../postmortems/pm.openclaw-govern-call-storm.2026-02-14.md) — Root cause postmortem
- [proj.context-optimization](../../work/projects/proj.context-optimization.md) — Implementation roadmap
