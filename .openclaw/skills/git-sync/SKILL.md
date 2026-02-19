---
description: "Deterministic git branch delta check with Discord status post"
user-invocable: true
---

# Git Sync — Heartbeat v0

You are executing a deterministic checklist. Do not reason about what to do — run these commands verbatim, format the output, and exit.

## Procedure

### 1. Fetch

```bash
cd /workspace/repo && git fetch origin
```

### 2. Branch delta scan

For each branch in `gov/ideas` and `gov/development`:

```bash
AHEAD=$(git rev-list --count origin/staging..origin/gov/ideas 2>/dev/null || echo 0)
COMMITS=$(git log --oneline -n 5 origin/staging..origin/gov/ideas 2>/dev/null || echo "(branch not found)")
```

```bash
AHEAD=$(git rev-list --count origin/staging..origin/gov/development 2>/dev/null || echo 0)
COMMITS=$(git log --oneline -n 5 origin/staging..origin/gov/development 2>/dev/null || echo "(branch not found)")
```

### 3. Check for open PRs

```bash
gh pr list --head gov/ideas --base staging --state open --json number,title 2>/dev/null || echo "[]"
gh pr list --head gov/development --base staging --state open --json number,title 2>/dev/null || echo "[]"
```

### 4. Compare to last snapshot

Read `/workspace/gateway/memory/heartbeat-state.json`. If the file doesn't exist, treat everything as changed (first run).

The snapshot format:

```json
{
  "gov/ideas": { "ahead": 3, "top_sha": "abc1234" },
  "gov/development": { "ahead": 0, "top_sha": "" }
}
```

Compare `ahead` count and `top_sha` (first commit SHA from the log) for each branch.

### 5. Decision

- **If nothing changed** (all ahead counts and top SHAs match the snapshot): write "No changes since last heartbeat." and **stop here**. Do not post to Discord.
- **If anything changed**: continue to step 6.

### 6. Post to Discord

Use the `message` tool to post to the governance status channel. Max 5 commits per branch.

```
message({
  action: "send",
  channel: "discord",
  target: "1473931118603534356",
  message: "<formatted message>"
})
```

Message format:

```
**Heartbeat** (<UTC timestamp>)
- **gov/ideas**: <N> ahead of staging | <PR status or "no PR">
  <commit list, max 5 lines>
- **gov/development**: <N> ahead of staging | <PR status or "no PR">
  <commit list, max 5 lines>
```

### 7. Save snapshot

Write the new snapshot to `/workspace/gateway/memory/heartbeat-state.json`.

```bash
cat > /workspace/gateway/memory/heartbeat-state.json << 'SNAPSHOT'
{ ... }
SNAPSHOT
```

## Rules

- Run every command. Do not skip steps or add steps.
- Do not summarize, analyze, or editorialize. Just report deltas.
- If a branch doesn't exist on the remote, report it as "not found" and move on.
- Hard cap: 5 commits per branch in the Discord message.
- If the `message` tool call fails, log the error and continue. Never retry.
