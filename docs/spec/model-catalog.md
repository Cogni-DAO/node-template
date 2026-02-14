---
id: model-catalog
type: spec
title: LLM Model Catalog
status: active
spec_state: active
trust: reviewed
summary: VALUE-FIRST model tiers for Cogni — DeepSeek/QwQ for thinking, Haiku/GPT-4o-Mini/Llama for agents. Reserve Opus strictly for governance.
read_when: Choosing models for agent config, updating LiteLLM or OpenClaw model lists, evaluating new models
owner: derekg1729
created: 2026-02-13
verified: 2026-02-13
tags: [ai, models, openclaw, billing]
---

# LLM Model Catalog

All models route through OpenRouter via LiteLLM proxy. The gateway agent selects models per-task; these tiers guide that selection.

## Goal

**COST CRISIS RESPONSE.** Value is now 10x more important than premium. Maintain a value-first tiered catalog: thinking tier defaults to DeepSeek ($0.25/0.38) and QwQ ($0.05/0.22), NOT Opus. Flash tier defaults to Haiku ($1/$5), GPT-4o-Mini ($0.15/$0.60), or Llama ($0.10/$0.32). Reserve Opus + Sonnet strictly for governance agent only. Both "fast" (flash) and "thinking" (reasoning) remain required, but cost discipline is non-negotiable.

## Non-Goals

- Model fine-tuning or self-hosted inference
- Automatic model rotation or A/B testing
- Per-user model preferences (single-tenant agent)

## Design

## Thinking Tier

Strong reasoning models for all file mutations: writes, edits, commits, code generation, architecture decisions, EDOs. **VALUE FIRST.** These tiers reflect 2026 pricing via OpenRouter.

| Model             | Provider  | Context | Max Out | $/M in | $/M out | ZDR | Preference  | Notes                                                                                        |
| ----------------- | --------- | ------- | ------- | ------ | ------- | --- | ----------- | -------------------------------------------------------------------------------------------- |
| **QwQ-32B**       | Qwen      | 16k     | —       | $0.05  | $0.22   | No  | 🎯 USE THIS | Cheapest reasoning model. Competitive with o1-mini on hard problems. 100x cheaper than Opus. |
| **DeepSeek-V3.2** | DeepSeek  | 64k     | 8k      | $0.25  | $0.38   | No  | 🎯 USE THIS | Remarkable cost + strength. Base + configurable reasoning depth. 200x cheaper than Opus.     |
| Claude Sonnet 4.5 | Anthropic | 200k    | 4k      | $3.00  | $15.00  | Yes | Fallback    | Excellent reasoning at lower cost. Use if DeepSeek/QwQ insufficient for governance.          |
| Claude Opus 4.6   | Anthropic | 1M      | 128k    | $5.00  | $25.00  | Yes | Gold        | Frontier reasoning. **GOVERNANCE ONLY.** Unsustainable for general agents ($20/30min).       |
| Kimi K2 Thinking  | Moonshot  | 256k    | 65k     | $0.60  | $2.50   | No  | Strong      | Advanced MoE reasoning. Best for persistent multi-turn agentic workflows.                    |
| Kimi K2.5         | Moonshot  | 256k    | 65k     | ~$0.50 | ~$2.00  | No  | Strong      | Latest iteration. Enhanced efficiency over K2.                                               |

## Flash Tier

Fast, cheap models for read-only subagent work: scanning, grep-and-summarize, data extraction, synthesis, research. No file mutations. **Optimized for ultra-low cost at scale — these are primary agents.**

| Model                  | Provider  | Context | Max Out | $/M in | $/M out | ZDR | Preference  | Notes                                                                  |
| ---------------------- | --------- | ------- | ------- | ------ | ------- | --- | ----------- | ---------------------------------------------------------------------- |
| **Llama 3.3 70B**      | Meta      | 128k    | 8k      | $0.10  | $0.32   | No  | 🎯 USE THIS | Incredible for open-weight. Strong coding. $0.42/M total cost.         |
| **GPT-4o Mini**        | OpenAI    | 128k    | 16k     | $0.15  | $0.60   | No  | 🎯 USE THIS | Ultra-cheap + capable. Best cost/quality ratio. $0.75/M total cost.    |
| **Claude Haiku 4.5**   | Anthropic | 200k    | 4k      | $1.00  | $5.00   | Yes | Strong      | Premium if budget allows. 2× speed of 3.5, matches Sonnet 4 on coding. |
| Qwen3 Coder 480B       | Qwen      | 128k    | 8k      | ~$0.20 | ~$0.40  | No  | Value       | Specializes in coding. Competitive with GPT-4o mini.                   |
| Gemini 2.5 Flash Lite  | Google    | 1M      | 8k      | ~$0.15 | ~$1.00  | Yes | Value       | Lighter version of 2.5 Flash. Good for high-volume scanning.           |
| Gemini 2.5 Flash       | Google    | 1M      | 8k      | $0.30  | $2.50   | Yes | Strong      | Excellent balance. 1M context, built-in thinking, strong reasoning.    |
| Mistral Large (latest) | Mistral   | 128k    | 4k      | ~$0.27 | ~$0.81  | No  | Value       | Multimodal capable, solid all-rounder.                                 |
| Llama 3.3 70B (free)   | Meta      | 128k    | 8k      | $0     | $0      | No  | Free (dev)  | Rate-limited (~1k req/day) but viable for local dev/testing only.      |

## Free Tier

Zero-cost models for development, testing, and low-priority tasks. ⚠️ **Severely rate-limited (typically ~1,000 requests/day with credits)** — unusable for OpenClaw workloads due to high per-call token volume and multi-turn conversation overhead.

| Model             | Provider | Context | Tool Use | Notes              |
| ----------------- | -------- | ------- | -------- | ------------------ |
| Nemotron Nano 30B | NVIDIA   | 256k    | Yes      | Default free model |
| TNG Chimera       | TNG      | 163k    | Yes      | Reasoning-capable  |
| Trinity Mini      | Arcee    | 131k    | Yes      | —                  |
| Solar Pro 3       | Upstage  | 128k    | Yes      | —                  |
| GLM 4.5 Air       | Zhipu    | 131k    | Yes      | —                  |

## Config Mapping

| LiteLLM alias       | OpenRouter ID                                  | Gateway catalog ID        | Tier  |
| ------------------- | ---------------------------------------------- | ------------------------- | ----- |
| `claude-opus-4.6`   | `openrouter/anthropic/claude-opus-4-6`         | `cogni/claude-opus-4.6`   | Think |
| `claude-sonnet-4.5` | `openrouter/anthropic/claude-sonnet-4.5`       | `cogni/claude-sonnet-4.5` | Think |
| `claude-haiku-4.5`  | `openrouter/anthropic/claude-haiku-4.5`        | `cogni/claude-haiku-4.5`  | Flash |
| `deepseek-v3.2`     | `openrouter/deepseek/deepseek-chat-v3.2`       | `cogni/deepseek-v3.2`     | Think |
| `qwq-32b`           | `openrouter/qwen/qwq-32b`                      | `cogni/qwq-32b`           | Think |
| `kimi-k2-thinking`  | `openrouter/moonshotai/kimi-k2-thinking`       | `cogni/kimi-k2-thinking`  | Think |
| `gemini-2.5-flash`  | `openrouter/google/gemini-2.5-flash`           | `cogni/gemini-2.5-flash`  | Flash |
| `gpt-4o-mini`       | `openrouter/openai/gpt-4o-mini`                | `cogni/gpt-4o-mini`       | Flash |
| `llama-3.3-70b`     | `openrouter/meta-llama/llama-3.3-70b-instruct` | `cogni/llama-3.3-70b`     | Flash |
| `qwen3-coder-480b`  | `openrouter/qwen/qwen3-coder`                  | `cogni/qwen3-coder-480b`  | Flash |

## Current Defaults

```
Governance agent:  cogni/claude-opus-4.6      (thinking tier — frontier reasoning)
Fallback thinking: cogni/claude-sonnet-4.5    (thinking tier — 3× cheaper than Opus)
Value thinking:    cogni/deepseek-v3.2        (thinking tier — $0.63/M total, strong reasoning)
Primary subagent:  cogni/claude-haiku-4.5     (flash tier — real-time agents, coding)
Budget subagent:   cogni/gpt-4o-mini          (flash tier — ultra-cheap, $0.75/M total)
Ultra-budget:      cogni/llama-3.3-70b        (flash tier — $0.42/M total, open-weight)
```

## Invariants

| Rule                  | Constraint                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| WRITES_REQUIRE_STRONG | All file mutations use thinking-tier models. Flash and free models are read-only.                                 |
| MODELS_VIA_PROXY      | All LLM calls route through LiteLLM proxy. No direct provider API calls from agents.                              |
| ZDR_PREFERRED         | Prefer Zero Data Retention providers (Anthropic, Google) for production workloads.                                |
| COST_CONTROL          | Use value-tier thinking models (DeepSeek, QwQ) for research; reserve Opus for governance. Avoid Opus agent loops. |
| REASONING_EXPLICIT    | Enable reasoning/thinking modes only when task genuinely requires step-by-step analysis.                          |

## Evaluation Criteria

When evaluating new models for this catalog:

1. **Tool use support** — must support function calling via OpenRouter
2. **Context window** — prefer ≥200k for thinking, ≥128k for flash
3. **Reasoning** — thinking tier must support extended thinking / configurable reasoning depth
4. **ZDR (Zero Data Retention)** — prefer providers that support it (Anthropic, Google)
5. **Cost** — thinking tier ≤$30/M output, flash tier ≤$5/M output, free tier = $0
6. **Streaming** — must support streaming responses

## Related

- [LiteLLM config](../../platform/infra/services/runtime/configs/litellm.config.yaml) — proxy routing
- [openclaw-gateway.json](../../services/sandbox-openclaw/openclaw-gateway.json) — agent model catalog
- [external-executor-billing](./external-executor-billing.md) — billing reconciliation
- [openclaw-subagents](./openclaw-subagents.md) — subagent model tier strategy
