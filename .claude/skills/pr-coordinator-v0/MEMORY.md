# pr-coordinator-v0 skill memory

## Response format (Derek preference)

Good flight-dispatched response = tight status box + 2 URLs (validation URL, PR URL; + GHA run URL only if long-running infra flight). Exemplar:

```
╔═══════════════════════════════════════════════════╗
║  PR Flight Coordinator v0                         ║
╠═══════════════════════════════════════════════════╣
║  Slot:         candidate-a        Lease: BUSY     ║
║  In flight:    PR #929 @ a595366                  ║
║  State:        QA window open                     ║
║  Rollout:      ✅ poly pod boot w/ matching SHA   ║
║  Flight run:   still in_progress (smoke step)     ║
╚═══════════════════════════════════════════════════╝

QA URL:   https://poly-test.cognidao.org/research
PR:       https://github.com/Cogni-DAO/node-template/pull/929
```

**Why:** Derek reads ≤2–3 lines per response. Status box + 2 URLs = complete, actionable, skimmable. More is noise.

**How to apply:** Every flight-dispatched post should fit that shape. If the response is LONGER, it must be because it completes the request (e.g. triage proposals, scorecard) — never both "flight dispatched" and "long recap".

## Grafana MCP is OPTIONAL when Derek explicitly asks to flight

**Override `SKILL.md`'s "grafana MCP must be loaded" hard-halt rule.** If Derek says "flight now" / "flight this" and grafana MCP is disconnected, proceed anyway. Proof-of-rollout via Loki becomes best-effort (check via gh run / SSH / direct endpoint if truly needed), not a gate.

**Why:** The hard-halt was being precious. Derek wants flights to happen; observability gaps are his problem to accept, not the coordinator's veto.

**How to apply:** Treat grafana MCP as "nice to have" for auto-QA. Missing MCP → note it, skip grafana-watcher sub-agent, rely on Derek QA alone. Never block a flight on MCP state.

## Be in charge — autonomous operation

Derek runs this loop in the background while working on other projects. He expects the coordinator to:

- **Pick the next PR without asking** when the queue is obvious (top ready PR, confirm only if the choice is genuinely ambiguous).
- **Rebase stale PRs** before flighting them if main has moved. Use `gh pr checkout` or manual rebase, push with `--force-with-lease` to the PR branch. Do NOT rebase draft PRs or other contributors' branches without a clear signal they want it.
- **Auto-flight → auto-score → auto-route** (merge on pass, review-request on fail) without mid-loop checkpoints.
- **Only interrupt Derek** for: hard blockers (conflict that needs human judgment, flight infrastructure broken, CI stuck), pass/fail scorecard deliveries, or ambiguous triage picks.

**Why:** Derek has limited attention. The coordinator's job is to keep the pipeline moving, not to ask permission at every step.

**How to apply:** Default to action. Narrate the plan in ≤3 lines, execute, report outcome. Confirm only when the choice is 50/50 or the action is destructive beyond a normal flight.
