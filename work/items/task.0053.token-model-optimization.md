---
id: task.0053
type: task
title: "Token + model optimization — stop 85K input token hemorrhage on Opus"
status: Todo
priority: 0
estimate: 2
summary: "OpenClaw sandbox agent sends ~85K input tokens per LLM call to claude-opus-4.6. At Opus pricing this is catastrophically expensive ($20/30min observed). Root cause diagnosed: unbounded conversation history (~45K+), mandatory memory_search on every query (~2.4K/search accumulating), and default model = Opus. Fix via prompt caching, history caps, and model defaults."
outcome: "Prompt caching enabled (90% savings on stable prefix). History capped. Memory search optional not mandatory. Default model is cheap tier. Typical call < 20K input tokens."
spec_refs:
  - openclaw-sandbox-spec
  - openclaw-sandbox-controls
  - ai-setup
project: proj.openclaw-capabilities
branch:
pr:
reviewer:
created: 2026-02-14
updated: 2026-02-14
labels: [openclaw, cost, tokens, model-routing, p0, caching]
external_refs:
assignees: derekg1729
credit:
---

# task.0053 — Token + model optimization

## Context

On 2026-02-14, the sandbox OpenClaw agent was observed sending ~85K input tokens **per call** to claude-opus-4.6 via OpenRouter:

```
2/14/2026, 1:14:58 AM    sandbox:openclaw    claude-opus-4.6    83940    89    $0.000000
2/14/2026, 1:14:58 AM    sandbox:openclaw    claude-opus-4.6    83760    89    $0.000000
2/14/2026, 1:14:48 AM    sandbox:openclaw    claude-opus-4.6    83602    67    $0.000000
...17 calls in ~3 minutes, all 57K-84K input tokens
```

This burned $20 in ~30 minutes and hit the OpenRouter weekly key limit. The $0.000000 cost is a separate bug (bug.0037 — proxy doesn't capture streaming cost).

## Root Cause (Diagnosed)

Three factors stacking:

### 1. Unbounded conversation history (~45K+ tokens, growing)

The gateway agent runs persistently. Every interaction adds messages + tool calls + tool results to the session with **no history windowing or truncation**. The 55K starting point is accumulated context from prior interactions. Grows ~1,700 tokens per round-trip.

- OpenClaw has `compaction` config (`maxHistoryShare`, `reserveTokensFloor`) and per-channel `historyLimit` — **none configured**.

### 2. "Mandatory recall step" on every query (~2.4K tokens/search, accumulating)

The `memory_search` tool description is hardcoded as "Mandatory recall step" (`openclaw/src/agents/tools/memory-tool.ts:44`). System prompt reinforces: "Before answering anything about prior work... run memory_search" (`openclaw/src/agents/system-prompt.ts:53`).

Each search returns `maxResults: 6` chunks × ~400 tokens = ~2,400 tokens of results, all accumulating in conversation history.

- `memorySearch.enabled: false` removes both tools AND the system prompt section
- The "mandatory" language is hardcoded — **no config to soften it**
- Override via SOUL.md instruction: "Only use memory_search when you genuinely need historical context. Do NOT search on every message."
- `extraPaths` indexing is fine — keeps docs searchable on-demand. Not the problem.

### 3. Default model = Opus 4.6 (most expensive)

`openclaw-gateway.json:178`: `"model": { "primary": "cogni/claude-opus-4.6" }`

### What's NOT the problem

- Context files (SOUL.md, AGENTS.md, etc.) = only ~2,750 tokens total
- Tool schemas = ~2K tokens for ~20 tools
- Skills metadata = ~2K tokens for 26 skills
- System prompt base text = ~5K tokens

## Plan — Do Now (90% of savings)

All changes in `services/sandbox-openclaw/openclaw-gateway.json` unless noted.

### 1. Enable prompt caching (90% savings on stable prefix)

Prompt caching **works through OpenRouter** for Anthropic models. OpenClaw supports it natively via `cacheRetention` param. The system prompt + context files (~10K tokens) are stable across turns — perfect cache candidates.

```jsonc
// In agents.defaults or per-model params:
"agents": {
  "defaults": {
    "model": { "primary": "cogni/claude-sonnet-4.5" },
    // Add:
    "params": {
      "cacheRetention": "short"  // 5-min TTL, 90% discount on cache reads
    }
  }
}
```

- Cache write: 1.25× base price (one-time)
- Cache read: 0.1× base price = **90% savings** on repeated prefix
- Break-even at ~10 requests

### 2. Cap conversation history

```jsonc
"agents": {
  "defaults": {
    "compaction": {
      "mode": "default",
      "maxHistoryShare": 0.3,       // max 30% of context for history
      "reserveTokensFloor": 8000    // always reserve 8K for response
    }
  }
}
```

Or use per-channel `historyLimit` if gateway exposes it.

### 3. Override mandatory memory search via SOUL.md

Add to `services/sandbox-openclaw/gateway-workspace/SOUL.md`:

```markdown
## Memory Search Policy

memory_search is a tool, not a ritual. Use it ONLY when you genuinely need historical context —
prior decisions, dates, people, or preferences. Do NOT search on routine questions, code tasks,
or when the answer is in the current conversation. Most messages don't need a memory search.
```

### 4. Change default model

```jsonc
"agents": {
  "defaults": {
    "model": { "primary": "cogni/gemini-3-flash" }  // was claude-opus-4.6
  }
}
```

Opus/Sonnet only when user explicitly selects via model picker.

### 5. Enable context pruning

```jsonc
"agents": {
  "defaults": {
    "contextPruning": {
      "mode": "cache-ttl",
      "ttl": 300  // match cacheRetention TTL (5 min)
    }
  }
}
```

## Validation

After applying config changes:

1. Check OpenRouter usage dashboard for cache hit indicators
2. Verify typical input tokens < 20K per call
3. Confirm memory_search is NOT called on every message
4. Confirm default model is cheap tier in spend logs
5. If zero cache effects: system prompt or tool list is unstable across turns — investigate prefix stability

## Estimated Impact

| Metric                         | Before | After             |
| ------------------------------ | ------ | ----------------- |
| Input tokens/call              | 55-85K | 15-20K            |
| Cost per call (Opus)           | ~$1.50 | N/A (not default) |
| Cost per call (Flash)          | N/A    | ~$0.01            |
| Cost per call (Sonnet + cache) | N/A    | ~$0.05            |
| 30-min burn rate               | $20    | < $1              |

## PR / Links

- Related: bug.0037 (gateway proxy billing records $0 cost — why we see $0.000000)
- Related: task.0010 (model selection — already done, but defaults wrong)
- Related: task.0052 (Grafana access — need visibility to verify fix)
- Related: task.0029 (callback billing — need accurate cost data)
- Spec: docs/spec/openclaw-sandbox-controls.md
- OpenClaw source: `src/agents/system-prompt.ts`, `src/agents/tools/memory-tool.ts`, `src/agents/memory-search.ts`

## Attribution

-
