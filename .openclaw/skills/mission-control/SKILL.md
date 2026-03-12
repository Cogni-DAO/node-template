---
description: "Operator loop: deterministic pre-step → thin dispatch. Runs hourly on HEARTBEAT."
user-invocable: true
---

# /mission-control

> Operator loop. Runs hourly on HEARTBEAT. Receives pre-computed dispatch envelope.

## 1. SYNC

Run /git-sync. Continue regardless of outcome.

## 2. READ ENVELOPE

Run: `bash /repo/current/.openclaw/skills/mission-control/mc-status.sh`
Run: `npx tsx /repo/current/.openclaw/skills/mission-control/mc-pick.ts <tier>`

Where `<tier>` is from the status JSON. mc-pick returns `{id, status, skill}` or `null`.

If null or tier is RED → skip to step 4 (report only).

## 3. DISPATCH

Spawn brain subagent: `/<skill> <id>`

Pass the item ID and the status JSON summary as context.
One item. One skill. No scope creep.

If the brain fails → post failure to Discord with the error.
Do NOT retry. The next hourly run will re-evaluate.

## 4. REPORT

Post one message to Discord:

    <tier_emoji> $X.XX/24h | Xd runway | N errors
    /<skill> on <id> — OR — no-op: <reason>

Write EDO if action taken (template: `/workspace/memory-templates/EDO.template.md`).

EXIT.
