---
id: openclaw-govern-distributed
type: spec
title: "OpenClaw Distributed GOVERN: Charter-scoped reporting with bounded context"
status: draft
spec_state: draft
trust: draft
summary: "Redesigned GOVERN architecture: instead of one 19-call unbounded loop (29K tokens, 90s latency), spawn charter-scoped GOVERN tasks. Each charter agent orients → picks → executes within its domain, writes a compressed report (200-400 tokens). Main GOVERN reads reports, evaluates decisions, makes ONE high-priority action. Lossless compression: reports are durable and searchable; context is bounded."
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

|                          |                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------- |
| **Current Architecture** | [openclaw-workspace-spec](openclaw-workspace-spec.md) § GOVERN_TRIGGER (Invariant 34)   |
| **Context Analysis**     | [openclaw-context-optimization](openclaw-context-optimization.md) § Context Competition |
| **Project**              | [proj.context-optimization](../../work/projects/proj.context-optimization.md)           |

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

### New State (Charter-Scoped Reporting)

```
GOVERN trigger (one message: "GOVERN")
  |
  v
[Main GOVERN orchestrator reads charter list]
  |
  +---> SPAWN: Charter-A-GOVERN (async, isolated session)
  |       Agent: "You own charter-a (infrastructure). Orient to your items."
  |       Calls: 3-5 (bounded to 15K tokens)
  |       Output: writes "reports/charter-a-digest.md" (200-300 tokens)
  |       Content: "5 in progress, 2 blocked on review, 1 SEV2 bug, priorities: X > Y > Z"
  |
  +---> SPAWN: Charter-B-GOVERN (async, isolated session)
  |       Agent: "You own charter-b (product). Orient to your items."
  |       Calls: 3-5 (bounded to 15K tokens)
  |       Output: writes "reports/charter-b-digest.md" (200-300 tokens)
  |
  +---> SPAWN: Charter-C-GOVERN (async, isolated session)
  |       ... (parallel, each bounded)
  |
  v
[Wait for all reports to be written]
  |
  v
MAIN GOVERN DECISION PHASE (single call):
  Input: 2K (system prompt) + 1K (SOUL.md) + 800 (charter reports) = 3.8K tokens
  Call: "Read reports, evaluate hypotheses, make ONE decision"
  Output: EDO (decision) + next action
  Cost: $0.04, 5 seconds

RESULT: <$0.50 total, <30 seconds, lossless info preservation
```

### Execution Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│ GOVERN HEARTBEAT (Temporal triggers "GOVERN")           │
└────────────────────────┬────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
         v               v               v
    [Charter-A]    [Charter-B]    [Charter-C]
    GOVERN Run     GOVERN Run     GOVERN Run
      (Infra)       (Product)     (Research)
         │               │               │
    Orient → Pick   Orient → Pick  Orient → Pick
    Execute (3-5   Execute (3-5  Execute (3-5
    bounded calls) bounded calls) bounded calls)
         │               │               │
    Write Report:   Write Report:  Write Report:
    charter-a.md    charter-b.md   charter-c.md
    (250 tokens)    (250 tokens)   (250 tokens)
         │               │               │
         └───────────────┼───────────────┘
                         │
              [Wait for all reports]
                         │
                         v
            ┌──────────────────────────┐
            │   MAIN GOVERN PHASE      │
            │ (1 bounded call: 3.8K)   │
            │                          │
            │ Read 3 reports           │
            │ Evaluate EDO hypotheses  │
            │ Make ONE decision        │
            │ Write EDO to memory/     │
            └──────────────────────────┘
                         │
                         v
            [Output: One action/decision]
            [Cost: $0.04, 5 seconds]
```

### Report Format (Lossless Compression)

Each charter-scoped GOVERN writes a **concise, prioritized report** to `reports/{charter-name}-{date}.md`:

```markdown
# Charter-A Digest (2026-02-14)

## Status Summary

- In Progress: 5 items (task.0045, task.0047, task.0053, bug.0062, task.0068)
- Blocked: 2 items (task.0042 waiting on review, task.0050 blocked by task.0048)
- SEV2+: 1 item (bug.0062 context pruning timeout)

## Top Priorities (by ROI)

1. **task.0068**: Lower softTrimRatio to 0.1 (2h, -30% cost) — READY TO START
2. **bug.0062**: Add per-call token budget guardrail (4h, hard guarantee)
3. **task.0065**: UI visibility (uncached tokens, calls-per-run)

## Key Findings

- Context pruning never fires in fast loops (confirms postmortem hypothesis)
- Charter-scoped GOVERN proposal reduces token spend by 90% (POC ready)
- Model routing (Haiku/Sonnet) still not implemented

## EDO Hypothesis (if applicable)

- Event: GOVERN loop cost $5.50/run, unusable
- Decision: Implement distributed charter-scoped GOVERN
- ExpectedOutcome: { metric: "GOVERN cost", threshold: "<$0.50", byDate: "2026-02-28" }

## Dependencies

- Awaiting review on PR#407 (cost tuning fix)
- Blocked by Temporal scheduler upgrade (parallel GOVERN spawning)

## Next Steps

- Start task.0068 (softTrimRatio tuning) — UNBLOCKED
- Review charter-c findings for cross-charter priorities
```

**Why this works**:

- **Lossless**: All information is captured and searchable
- **Compressed**: 250 tokens vs 7K for raw work items (97% reduction)
- **Prioritized**: Top 3 items + key findings = easy for human/main-GOVERN to scan
- **Durable**: Reports are versioned with date, archived in `reports/` (git-tracked)
- **Bounded**: Each charter agent stays within its domain (~3-5 calls, ~15K tokens max)

---

## Core Invariants

| Rule                  | Constraint                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| DISTRIBUTE_BY_CHARTER | Each charter gets its own GOVERN task (spawned as subagent or separate session). Charter agents never interfere.          |
| ONE_DECISION_PER_RUN  | Main GOVERN reads all reports and makes exactly ONE high-priority decision/action per heartbeat. No multi-decision runs.  |
| REPORT_COMPRESSION    | Each charter report ≤400 tokens. If larger, refactor into 2+ reports or move detail to on-demand docs.                    |
| REPORTS_ARE_DURABLE   | Reports written to `reports/{charter}-{YYYY-MM-DD}.md`, committed to git. Are the source of truth for GOVERN decisions.   |
| BOUNDED_CALL_COUNT    | Each charter GOVERN: ≤10 LLM calls per run (vs 19 for old single-loop). If approaching limit, narrow scope.               |
| BOUNDED_CONTEXT       | Charter GOVERN contexts stay ≤20K tokens (cached + uncached combined). If larger, use on-demand reading for tool results. |
| PARALLEL_SAFETY       | Charter GOVERN runs execute in parallel (no race conditions on shared state). Each writes to own report file.             |

---

## Implementation Contract

### Temporal Scheduler Changes

Temporal still sends `GOVERN` trigger, but the handler now:

1. **Detects charter list** from `work/charters/` directory
2. **Spawns one subagent per charter** (or parallel GOVERN runs) with:
   ```json
   {
     "message": "GOVERN: {charter-name}",
     "model": "gemini-3-flash", // Fast, cheap for reporting
     "context": {
       "charter_id": "charter-a",
       "charter_path": "work/charters/charter-a.md"
     }
   }
   ```
3. **Waits for all subagents to complete** (configurable timeout: 60s)
4. **Main GOVERN phase** reads reports, aggregates, makes one decision
5. **Writes decision** to `memory/` and/or `docs/governance/decisions.md`

### Charter Agent Behavior

When a charter agent receives `GOVERN: {charter-name}`:

1. **Read charter doc** → understand mission, scope, invariants
2. **Orient** → list all items in this charter (work/items/, work/charters/{name}-items.md, etc.)
3. **Pick** → select top 3 by ROI (or signal highest-priority blocker)
4. **Execute** → if relevant, take one action (merge PR, close stale item, etc.) or prepare action for main GOVERN
5. **Report** → write compressed digest to `reports/{charter}-{date}.md`
6. **Done** → exit, return report path

Goal: Finish in <20 seconds, <15K tokens (3-5 calls).

### Main GOVERN Behavior

When main GOVERN runs after all charter reports are written:

1. **Read all reports** from `reports/`
2. **Evaluate hypotheses** → which charter's top priority aligns with platform goals?
3. **Make ONE decision** → e.g., "task.0068 (softTrimRatio tuning) is critical path. Unblock it. Charter-A take it."
4. **Record EDO** → event/decision/expected outcome in `memory/{date}-edo.md`
5. **Communicate** → output summary to user/Slack

Goal: Finish in <10 seconds, <5K tokens (1 call).

---

## File Pointers

| File                                                    | Purpose                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `work/charters/`                                        | Charter definitions (charter-a.md, charter-b.md, etc.)                         |
| `work/charters/{name}-items.md`                         | Items assigned to each charter (optional; can use work/items with charter tag) |
| `reports/`                                              | Output directory for charter digests (git-tracked, durable)                    |
| `memory/{date}-edo.md`                                  | Main GOVERN decisions (ephemeral working memory)                               |
| `docs/governance/decisions.md`                          | Policy/architecture/cost EDOs (durable, committed decisions)                   |
| `services/sandbox-openclaw/gateway-workspace/GOVERN.md` | Checklist (updated to reference charter scoping)                               |

---

## Open Questions

- [ ] How to assign items to charters? (tag-based, filename, separate index file?)
- [ ] Should charter GOVERN runs be sequential or parallel? (Parallel faster but risks resource contention)
- [ ] Timeout for waiting on all charter reports? (Suggest 60s, fail if any charter >45s)
- [ ] How to handle cross-charter dependencies? (Charter reports include dependency section; main GOVERN resolves)
- [ ] Should each charter have its own SOUL/AGENTS/MEMORY or share main agent's? (Recommend: share main workspace, add charter-specific context in task parameter)

---

## Related

- [openclaw-context-optimization](openclaw-context-optimization.md) — Context budget analysis that motivated this design
- [openclaw-workspace-spec](openclaw-workspace-spec.md) — Current GOVERN architecture (Invariant 34)
- [pm.openclaw-govern-call-storm.2026-02-14](../postmortems/pm.openclaw-govern-call-storm.2026-02-14.md) — Root cause postmortem
- [proj.context-optimization](../../work/projects/proj.context-optimization.md) — Implementation roadmap
