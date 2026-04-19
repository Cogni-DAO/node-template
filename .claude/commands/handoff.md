It's time to hand this project off to a new developer. Assume they have no context of the task you've been working on, but avoid over-prescribing implementation details. Focus on the goals, functional requirements, and pointers to documentation + important files + functions.

Write a handoff to `work/handoffs/{workItemId}.handoff.md` following the contract in `work/README.md#Handoffs` and the template at `work/_templates/handoff.md`.

Rules:

- Max 200 lines, 6 sections, no pasted logs/transcripts
- Link to files/commits instead of copying code blocks > 60 lines
- Frontmatter must include work_item_id, status, branch, last_commit
- If a handoff already exists, archive the old one to `work/handoffs/archive/{workItemId}/{datetime}.md` first (datetime format: YYYY-MM-DDTHH-MM-SS)
- After writing the handoff, append a link to the work item's `## PR / Links` section: `- Handoff: [handoff](../handoffs/{workItemId}.handoff.md)`

## Final output to the user

End with a fenced block the incoming developer can paste or read cold — no prose summary above it, no decorative headings. The block is the handoff. Include, in this order:

1. **Worktree** — absolute path (`pwd` output).
2. **Branch** — current branch (`git branch --show-current`) and upstream (`git rev-parse --abbrev-ref @{u}` if it exists).
3. **Handoff doc** — path to the file you just wrote.
4. **Immediate next action** — always of the shape: _"Read the handoff + <supporting docs>, then <the first concrete thing to do>, and from there you are in charge."_ The handoff doc is the primary briefing; the next-action line is the bridge from "read the briefing" into "you own this now." Example: _"Read `work/handoffs/task.0331.handoff.md` and `docs/spec/ci-cd.md`, then run `pnpm test:stack:dev tests/stack/poly-mirror.test.ts` against the current branch. From there you're in charge — the task's `## Validation` block is the success criterion."_ If the immediate next action is blocked by something only a human can resolve (missing auth, revoked access, decision the agent cannot make), say what is blocking and who unblocks — do not hand the loop to the next agent only to have them bounce.

This is the high-leverage surface of the handoff — the incoming agent should know where they are, what the primary briefing is, and what to do within the first 10 seconds.

ARGUMENTS: $ARGUMENTS
