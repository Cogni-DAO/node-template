- [ ] **Orient** — health analytics, read charters, scan `work/items/_index.md`, top priorities
- [ ] **Pick** — select 1–3 items (WIP ≤ 3), prefer In Progress
- [ ] **Execute** — small PRs, close items, validate
- [ ] **Maintain** — update stale docs, dedupe, delete rot, weekly prune
- [ ] **Reflect** — record EDOs for real decisions, check due outcomes

---

## EDO Format

One EDO per real decision. No EDO for routine work.

```markdown
## EDO: [short title]

- Event: what happened or was observed
- Decision: what we chose to do
- ExpectedOutcome: { metric: "...", threshold: "...", byDate: "YYYY-MM-DD" }
- Confidence: high/medium/low
- Owner: who checks
- Evidence: [file refs, PRs, work items]

### OutcomeCheck (YYYY-MM-DD)

- ActualOutcome: what actually happened
- Verdict: confirmed/missed/adjusted
- Next: keep / new EDO / policy change
```

### Example

```markdown
## EDO: Keep gateway prompt lean via on-demand GOVERN.md

- Event: User traffic is high; always-injected GOVERN checklist bloats context and increases cost/noise.
- Decision: Move checklist into /workspace/gateway/GOVERN.md; on `GOVERN`, read it explicitly.
- ExpectedOutcome: { metric: "avg tokens per non-GOVERN reply", threshold: "-20%", byDate: "2026-02-20" }
- Confidence: medium
- Owner: Cogni
- Evidence: [SOUL.md, GOVERN.md, task.0023]

### OutcomeCheck (2026-02-20)

- ActualOutcome: avg tokens per non-GOVERN reply -27%; no missed GOVERN runs observed.
- Verdict: confirmed
- Next: keep; apply same pattern to other non-critical prompt content
```
