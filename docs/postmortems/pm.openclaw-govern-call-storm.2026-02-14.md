---
id: pm.openclaw-govern-call-storm.2026-02-14
type: postmortem
title: "Postmortem: OpenClaw webchat triggers a multi-call GOVERN loop (call storm) with rapidly growing prompt tokens"
status: draft
trust: draft
severity: SEV2
duration: "≈2 minutes per user message (observed 2026-02-14)"
services_affected: [openclaw-gateway, litellm, app]
summary: "A single webchat message to sandbox:openclaw triggered ~19 sequential Claude Opus calls in one run, rapidly inflating prompt tokens to ~29k and driving high cost. Prompt caching worked for a stable ~9.8k-token prefix, but the uncached tail grew quickly and the system lacked guardrails and visibility."
read_when: "Debugging high OpenClaw costs, prompt caching behavior, or webchat agent loops."
owner: derekg1729
created: 2026-02-14
verified: 2026-02-14
tags: [incident, openclaw, cost, prompt-caching, reliability]
---

# Postmortem: OpenClaw webchat triggers a multi-call GOVERN loop (call storm) with rapidly growing prompt tokens

**Date**: 2026-02-14  
**Severity**: SEV2  
**Status**: Resolved (reproduced + diagnosed; mitigations pending)  
**Duration**: ≈2 minutes per user message (run duration), ongoing risk until mitigations ship

---

## Summary

A single user message to the `sandbox:openclaw` webchat caused the OpenClaw gateway agent to execute an internal “GOVERN”-style loop, issuing **~19 sequential `claude-opus-4.5` requests** within one run while repeatedly using tools. Prompt tokens grew from ~10k to ~29k across the burst, with small outputs between calls, resulting in unexpectedly high cost and an unusable user experience.

OpenRouter prompt caching was active and confirmed via `cached_tokens`, but only for a stable **~9.8k-token prefix**. The remaining (uncached) portion of the prompt grew quickly (tool output + accumulating assistant/user turns), so caching reduced cost less than expected. The system lacked guardrails (bounded work per message/run) and lacked visibility into “calls per run” and cached-vs-uncached tokens, making diagnosis confusing from the Activity page alone.

## Timeline

<!-- All times UTC. Include detection, escalation, mitigation, resolution. -->

| Time                | Event                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 2026-02-14 09:23:00 | OpenClaw embedded run starts for webchat (runId `cogni-8bef0a44-...`; spend_logs `run_id = 6cabd011-a668-42ce-bb60-886ce2aa74b2`) |
| 2026-02-14 09:23:00 | 1st LiteLLM spend log for this run: `prompt_tokens=10127`, `cache_write_tokens=9785`, `cached_tokens=0` (OpenRouter cache write)  |
| 2026-02-14 09:23:04 | 2nd call: `prompt_tokens=10696`, `cached_tokens=9785` (cache read begins)                                                         |
| 2026-02-14 09:23:06 | 3rd call: `prompt_tokens=15589`, `cached_tokens=9785` (uncached tail expands rapidly)                                             |
| 2026-02-14 09:23:27 | Call reaches `prompt_tokens=22463`, `cached_tokens=9785` (still only stable prefix cached)                                        |
| 2026-02-14 09:24:28 | Last observed call in burst: `prompt_tokens=28971`, `cached_tokens=9785`                                                          |
| 2026-02-14 09:24:41 | OpenClaw embedded run ends (`aborted=false`)                                                                                      |

**Evidence**:

- LiteLLM Postgres (`litellm_dev`) `LiteLLM_SpendLogs` grouped by `metadata.spend_logs_metadata.run_id = 6cabd011-a668-42ce-bb60-886ce2aa74b2` shows 19 `anthropic/claude-opus-4.5` successes with `cached_tokens=9785` for calls 2–19 and a single `cache_write_tokens=9785` on call 1.

## Root Cause

### What Happened

The OpenClaw gateway agent treated a user webchat message as a trigger to run an internal multi-step governance workflow (“GOVERN: Orient/Pick/Maintain/Reflect” style). Instead of responding with a single bounded model call, it proceeded through many tool interactions and produced multiple assistant responses, each requiring another LLM call. Because each call included the expanding transcript/tool outputs, prompt tokens increased rapidly.

Prompt caching was enabled and functioning, but only for a stable prefix (cached ~9785 tokens). The uncached tail grew from a few hundred tokens to ~19k tokens by the end of the burst.

### Contributing Factors

1. **Proximate cause**: A single user message resulted in **~19 sequential Opus calls** in one run with no “bounded work per message/run” guardrails.
2. **Contributing factor**: Prompt caching markers effectively applied to the **system prefix only**, so the cached portion remained constant while the uncached tail grew quickly.
3. **Systemic factor**: UI/observability did not make “calls per run” and cached-vs-uncached tokens obvious, causing repeated false conclusions that caching was “off”.

## Detection & Response

### What Worked

- LiteLLM spend logs retained `prompt_tokens_details.cached_tokens` and `cache_write_tokens`, enabling definitive confirmation of prompt caching behavior.
- `spend_logs_metadata.run_id` correlation enabled grouping all LLM calls attributable to a single OpenClaw run.

### What Didn't Work

- No guardrail prevented a single user message from issuing dozens of model calls.
- The Activity page did not surface cached-vs-uncached tokens or calls-per-run clearly.

## Impact

### Customer Impact

- Webchat interaction became unusable: one message produced many internal steps instead of a single bounded answer.
- High and surprising costs for a short interaction, reducing confidence in long governance sessions.

### Technical Impact

- One run produced **19 Opus calls** and grew prompt tokens to **~29k** within ~90 seconds.
- Prompt caching saved some cost (cached ~9.8k tokens per call after the first), but the uncached tail dominated due to rapid transcript/tool expansion.

## Lessons Learned

### What Went Well

1. Spend logs included cache token details and run correlation metadata, enabling fast diagnosis without packet capture.

### What Went Wrong

1. Interactive webchat messages could enter governance-style multi-step loops.
2. The runtime had no bounded-work guardrails for “calls per user message/run”.

### Where We Got Lucky

1. The incident was caught quickly during interactive testing and could be diagnosed from local DB logs.

## Action Items

| Pri | Action                                                                                                                               | Owner | Work Item |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ----- | --------- |
| P0  | Deep dive OpenClaw loop trigger/continuation to enable long multi-turn governance sessions without runaway spend                     | —     | task.0053 |
| P0  | Add bounded-work guardrails for gateway runs (calls/tools/duration/spend) and surface call-count + cached-vs-uncached tokens per run | —     | task.0053 |

## Related

- `docs/postmortems/pm.billing-observability-gaps.2026-02-14.md`
- `work/items/task.0053.token-model-optimization.md`

---

id: pm.openclaw-govern-call-storm.2026-02-14
type: postmortem
title: "Postmortem: OpenClaw webchat triggers a multi-call GOVERN loop (call storm) with rapidly growing prompt tokens"
status: draft
trust: draft
severity: SEV2
duration: "≈2 minutes per user message (observed 2026-02-14)"
services_affected: [openclaw-gateway, litellm, app]
summary: "A single webchat message to sandbox:openclaw triggered ~19 sequential Claude Opus calls in one run, rapidly inflating prompt tokens to ~29k and driving high cost. Prompt caching worked for a stable ~9.8k-token prefix, but the uncached tail grew quickly and the system lacked guardrails and visibility."
read_when: "Debugging high OpenClaw costs, prompt caching behavior, or webchat agent loops."
owner: derekg1729
created: 2026-02-14
verified: 2026-02-14
tags: [incident, openclaw, cost, prompt-caching, reliability]

---

# Postmortem: OpenClaw webchat triggers a multi-call GOVERN loop (call storm) with rapidly growing prompt tokens

**Date**: 2026-02-14  
**Severity**: SEV2  
**Status**: Resolved (reproduced + diagnosed; mitigations pending)  
**Duration**: ≈2 minutes per user message (run duration), ongoing risk until guardrails ship

---

## Summary

A single user message to the `sandbox:openclaw` webchat caused the OpenClaw gateway agent to execute an internal “GOVERN”-style loop, issuing **~19 sequential `claude-opus-4.5` requests** within one run while repeatedly reading/executing tools. Prompt tokens grew from ~10k to ~29k across the burst, with small outputs between calls, resulting in unexpectedly high cost and an unusable user experience.

OpenRouter prompt caching was active and confirmed via `cached_tokens`, but only for a stable **~9.8k-token prefix**. The remaining (uncached) portion of the prompt grew quickly (tool output + accumulating assistant/user turns), so caching reduced cost less than expected. The system lacked hard guardrails (max calls, max prompt growth, max spend per run) and the UI lacked visibility into “calls per run” and cached-vs-uncached tokens, making the incident confusing to diagnose from the Activity page alone.

## Timeline (UTC)

| Time                | Event                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 2026-02-14 09:23:00 | OpenClaw embedded run starts for webchat (`openclaw` logs: `embedded run start`, runId `cogni-8bef0a44-...`)                     |
| 2026-02-14 09:23:00 | 1st LiteLLM spend log for this run: `prompt_tokens=10127`, `cache_write_tokens=9785`, `cached_tokens=0` (OpenRouter cache write) |
| 2026-02-14 09:23:04 | 2nd call: `prompt_tokens=10696`, `cached_tokens=9785` (cache read begins)                                                        |
| 2026-02-14 09:23:06 | 3rd call: `prompt_tokens=15589`, `cached_tokens=9785` (uncached tail expands rapidly)                                            |
| 2026-02-14 09:23:27 | Call reaches `prompt_tokens=22463`, `cached_tokens=9785` (still only system prefix cached)                                       |
| 2026-02-14 09:24:28 | Last observed call in burst: `prompt_tokens=28971`, `cached_tokens=9785`                                                         |
| 2026-02-14 09:24:41 | OpenClaw embedded run ends (`durationMs≈101912`, `aborted=false`)                                                                |

**Evidence**:

- LiteLLM Postgres (`litellm_dev`) `LiteLLM_SpendLogs` grouped by `metadata.spend_logs_metadata.run_id = 6cabd011-a668-42ce-bb60-886ce2aa74b2` shows 19 `anthropic/claude-opus-4.5` successes with `cached_tokens=9785` for calls 2–19 and a single `cache_write_tokens=9785` on call 1.
- OpenClaw gateway file log (`/tmp/openclaw/openclaw-2026-02-14.log`) shows a single embedded run (`cogni-8bef0a44-...`) with many tool invocations (`read`, `exec`) during the same time window.

## Root Cause

### What Happened

The OpenClaw gateway agent treated a user webchat message as a trigger to run an internal multi-step governance workflow (“GOVERN: Orient/Pick/Maintain/Reflect” style). Instead of responding with a single model call and bounded tool use, it proceeded through many tool interactions and emitted multiple assistant message completions, each requiring another LLM call. Because each call included the expanding transcript/tool outputs, **prompt tokens increased rapidly**.

Prompt caching was enabled and functioning, but only for a stable prefix (system message). Once the cache was written, each subsequent call reused **~9785 cached tokens**, while the uncached tail grew from a few hundred tokens to ~19k tokens by the end of the burst.

### Contributing Factors

1. **Proximate cause**: A single user message resulted in **19 sequential Opus calls** in one run with no “max calls / max prompt growth / max spend” limits.
2. **Contributing factor**: Prompt caching markers were effectively applied to the **system prefix only**, so the cached portion remained constant while the uncached tail grew quickly.
3. **Contributing factor**: Activity UI emphasizes total prompt tokens and cost but does not clearly show **calls per run** nor **cached vs uncached tokens**, so the behavior looked like “no caching” from the surface.
4. **Systemic factor**: No automated guardrails/alerts exist for “run produces N LLM calls” or “prompt_tokens slope exceeds threshold,” and no product-level budget enforcement stops runaway agent behavior.

### 5 Whys (high cost per single message)

1. **Why was the message expensive?** → The system made ~19 model calls and repeatedly sent large prompts.
2. **Why were there ~19 model calls?** → The agent entered a multi-step workflow (GOVERN loop) instead of answering once.
3. **Why did the agent enter a loop from a user message?** → The system prompt / runtime allows governance-style self-management behaviors without gating them to explicit scheduler heartbeats.
4. **Why didn’t caching prevent the cost spike?** → Only ~9.8k stable prefix was cached; the uncached portion quickly grew to ~19k tokens.
5. **Why wasn’t this detected/stopped?** → No per-run budgets (call count / tokens / spend) and insufficient visibility in UI/metrics for call storms.

## Detection & Response

### What Worked

- LiteLLM spend logs retained `prompt_tokens_details.cached_tokens` and `cache_write_tokens`, enabling definitive determination of prompt caching behavior.
- `spend_logs_metadata.run_id` correlation enabled grouping all LLM calls attributable to a single OpenClaw run.

### What Didn’t Work

- No guardrail prevented a single user message from issuing dozens of model calls.
- The Activity page did not surface cached-vs-uncached tokens (and already has a known issue: `bug.0004` cost column confusion), leading to repeated “caching isn’t working” false alarms.

## Impact

### Customer Impact

- Webchat interaction became effectively unusable: one message produced many partial responses/tool steps instead of a single bounded answer.
- High and surprising costs for a short interaction, eroding trust and making the system impractical to use.

### Technical Impact

- One run produced **19 Opus calls** and grew prompt tokens to **~29k** within ~90 seconds.
- Prompt caching saved some cost (cached ~9.8k tokens per call after the first), but the uncached tail dominated due to rapid transcript/tool expansion.

## Lessons Learned

### What Went Well

1. The system had enough correlation metadata (`run_id`) to debug the call storm without packet captures.
2. Prompt caching markers were present and verified via usage fields.

### What Went Wrong

1. The runtime lacked hard budgets for “calls per user message / run.”
2. Governance-like loops were reachable from normal user messages.
3. UI/observability did not make cached-vs-uncached and call-count-per-run obvious.

### Where We Got Lucky

1. The incident was caught quickly during interactive use and did not require a long-running schedule to trigger.

## Action Items

| Pri | Action                                                                                                                                                     | Owner | Work Item |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------- |
| P0  | Add OpenClaw guardrail: cap LLM calls + tool steps per user message/run; fail closed with a clear error when exceeded                                      | —     | bug.0062  |
| P0  | Add product-level budget enforcement for gateway runs: max prompt tokens growth, max spend per run, max duration                                           | —     | task.0063 |
| P1  | Expand prompt caching coverage: inject cache breakpoints beyond system prefix (e.g., stable user/context blocks) and document expected cached token ranges | —     | task.0064 |
| P1  | Add observability + UI surfacing: show calls-per-run, cached_tokens/cache_write_tokens, and uncached_tokens on Activity; alert on call storms              | —     | task.0065 |

## Related

- `docs/postmortems/pm.billing-observability-gaps.2026-02-14.md` (related billing/visibility issues)
- `work/items/task.0053.token-model-optimization.md` (token/cost optimization track)
- `work/items/bug.0004.md` (Activity cost column issues)
