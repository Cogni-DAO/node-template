---
id: model-catalog
type: spec
title: LLM Model Catalog
status: active
spec_state: active
trust: reviewed
summary: Curated model tiers for the Cogni platform — thinking (strong reasoning + writes), flash (fast scanning + synthesis), and free (zero-cost fallback)
read_when: Choosing models for agent config, updating LiteLLM or OpenClaw model lists, evaluating new models
owner: derekg1729
created: 2026-02-13
verified: 2026-02-13
tags: [ai, models, openclaw, billing]
---

# LLM Model Catalog

All models route through OpenRouter via LiteLLM proxy. The gateway agent selects models per-task; these tiers guide that selection.

## Thinking Tier

Strong reasoning models for all file mutations: writes, edits, commits, code generation, architecture decisions, EDOs. The main governance agent runs on this tier.

| Model | Provider | Context | Max Out | $/M in | $/M out | ZDR | Notes |
|-------|----------|---------|---------|--------|---------|-----|-------|
| **Claude Opus 4.6** | Anthropic | 1M | 128k | $5 | $25 | Yes | Default main agent. Sustained knowledge work, coding, extended thinking |
| Gemini 3 Pro | Google | 1M | 65k | $2 | $12 | Yes | Multimodal reasoning, configurable depth (low/high) |
| GPT-5 | OpenAI | 200k | 32k | — | — | No | Reasoning model, strong at code |
| Kimi K2 Thinking | Moonshot | 262k | 65k | $0.45 | $2.25 | No | Agent swarm paradigm, multimodal |

## Flash Tier

Fast, cheap models for read-only subagent work: scanning, grep-and-summarize, data extraction, synthesis. No file mutations.

| Model | Provider | Context | Max Out | $/M in | $/M out | ZDR | Notes |
|-------|----------|---------|---------|--------|---------|-----|-------|
| **Gemini 3 Flash** | Google | 1M | 65k | $0.50 | $3 | Yes | Default subagent. Configurable reasoning, tool use, multimodal |
| Gemini 2.5 Flash | Google | 1M | 65k | $0.15 | $0.60 | Yes | Previous default, still capable |
| GPT-4o Mini | OpenAI | 128k | 16k | — | — | No | Budget option |
| Grok 4.1 Fast | xAI | 131k | 32k | — | — | No | Fast inference |

## Free Tier

Zero-cost models for development, testing, and low-priority tasks. Rate-limited (50 req/day free plan, 1000 req/day with credits).

| Model | Provider | Context | Tool Use | Notes |
|-------|----------|---------|----------|-------|
| Nemotron Nano 30B | NVIDIA | 256k | Yes | Default free model |
| TNG Chimera | TNG | 163k | Yes | Reasoning-capable |
| Trinity Mini | Arcee | 131k | Yes | — |
| Solar Pro 3 | Upstage | 128k | Yes | — |
| GLM 4.5 Air | Zhipu | 131k | Yes | — |

## Config Mapping

| LiteLLM alias | OpenRouter ID | Gateway catalog ID |
|---------------|---------------|-------------------|
| `claude-opus-4.6` | `openrouter/anthropic/claude-opus-4-6` | `cogni/claude-opus-4.6` |
| `gemini-3-pro` | `openrouter/google/gemini-3-pro-preview` | `cogni/gemini-3-pro` |
| `gemini-3-flash` | `openrouter/google/gemini-3-flash-preview` | `cogni/gemini-3-flash` |
| `gemini-2.5-flash` | `openrouter/google/gemini-2.5-flash` | `cogni/gemini-2.5-flash` |
| `claude-opus-4.5` | `openrouter/anthropic/claude-opus-4.5` | `cogni/claude-opus-4.5` |

## Current Defaults

```
Main agent:    cogni/claude-opus-4.6  (thinking tier)
Subagents:     cogni/gemini-3-flash   (flash tier)
```

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
