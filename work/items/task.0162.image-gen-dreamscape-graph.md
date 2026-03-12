---
id: task.0162
type: task
title: "Image generation graph (dreamscape) + PR CLI"
status: needs_implement
priority: 1
rank: 10
estimate: 3
summary: Add image generation as a first-class LangGraph capability via a "dreamscape" graph that uses Gemini Flash Image through OpenRouter, plus a CLI script for generating solarpunk PR images
outcome: Image generation works through the standard graph execution pipeline (observability, billing, preflight); PR dreamscape CLI generates and uploads images to GitHub
spec_refs:
assignees:
  - derekg1729
credit:
project:
branch: feat/image-gen-dreamscape
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-12
updated: 2026-03-12
labels: [ai-graphs, creative-ai, developer-experience]
external_refs:
---

# Image Generation Graph (Dreamscape) + PR CLI

## Context

Image generation models on OpenRouter (Gemini Flash Image, GPT-5 Image) work through the **chat completions API** — they're chat models that return images in `message.images[]`. OpenRouter does NOT have a dedicated `/images/generations` endpoint.

This means image generation fits naturally into the existing LangGraph graph pattern: a graph factory that uses an image-capable model as its LLM. No new tool contract or capability interface is needed for v1 — the LLM itself IS the image generator.

The first consumer is a "PR dreamscape" workflow that generates solarpunk visualizations of PRs and adds them to the PR description (currently done manually).

## Design

### Architecture

```
┌──────────────────────────────────────────────────────┐
│  CLI (scripts/pr-dreamscape.sh)                      │
│  1. Fetch PR info via gh                             │
│  2. Craft image prompt via cheap LLM (gpt-4o-mini)   │
│  3. Invoke dreamscape graph                          │
│  4. Extract image from response                      │
│  5. Upload to GitHub + update PR body                │
└──────────────────────┬───────────────────────────────┘
                       │ invokes (direct or via API)
                       ▼
┌──────────────────────────────────────────────────────┐
│  LangGraph: dreamscape graph                         │
│  Model: gemini-2.5-flash-image (via OpenRouter)      │
│  Pattern: single-call, no tools (like pr-review)     │
│  Input: image generation prompt                      │
│  Output: text + images[] (base64 data URIs)          │
└──────────────────────────────────────────────────────┘
                       │ routes through
                       ▼
┌──────────────────────────────────────────────────────┐
│  GraphExecutorPort pipeline                          │
│  Observability → Preflight → Billing → Provider      │
│  (all existing infrastructure, no changes needed)    │
└──────────────────────────────────────────────────────┘
```

### Key decisions

1. **No `core__image_generate` tool for v1** — Image gen models work through chat completions. The LLM IS the tool. A tool contract wrapping another LLM call is graph-as-tool territory (proj.tool-use-evolution P3). Add it later when multiple graphs need image gen as a composable step.

2. **Two-step prompt pipeline in CLI, not in graph** — The CLI uses gpt-4o-mini to craft the image prompt, then passes it to the dreamscape graph. This keeps the graph simple (single-call) and allows the prompt engineering to evolve independently.

3. **Image data flows as standard message content** — Gemini returns images in `message.images[].image_url.url` as `data:image/png;base64,...` URIs. The graph doesn't need special handling — it returns whatever the LLM returns.

4. **GitHub upload is CLI-only concern** — The graph generates images. The CLI handles PR-specific logic (fetch, upload, update). Clean separation.

### Available OpenRouter image models (verified 2026-03-12)

| Model ID                                | Notes                         |
| --------------------------------------- | ----------------------------- |
| `google/gemini-2.5-flash-image`         | Default — cheap, good quality |
| `google/gemini-3.1-flash-image-preview` | Newer                         |
| `google/gemini-3-pro-image-preview`     | Higher quality                |
| `openai/gpt-5-image-mini`               | OpenAI mini                   |
| `openai/gpt-5-image`                    | OpenAI flagship               |

## Requirements

- `gemini-2.5-flash-image` model registered in LiteLLM config, routed through OpenRouter
- `dreamscape` graph factory in `@cogni/langgraph-graphs` following the `pr-review` single-call pattern
- Graph registered in `LANGGRAPH_CATALOG` with proper entries in `LANGGRAPH_GRAPH_IDS`
- `cogni-exec.ts` + `server.ts` entrypoints + `langgraph.json` entry
- `scripts/pr-dreamscape.sh` CLI script that orchestrates the full PR dreamscape flow
- `.claude/commands/git-review.md` Claude Code command wrapping the script
- All graph invariants upheld: PURE_FACTORY, TYPE_TRANSPARENT_RETURN, CATALOG_SINGLE_SOURCE_OF_TRUTH, HELPERS_DO_NOT_IMPORT_CATALOG
- Graph runs through standard `GraphExecutorPort` pipeline with no executor changes

## Allowed Changes

- `infra/compose/runtime/configs/litellm.config.yaml` — add image model
- `packages/langgraph-graphs/src/graphs/dreamscape/` — new graph directory (graph.ts, prompts.ts, tools.ts, server.ts, cogni-exec.ts)
- `packages/langgraph-graphs/src/catalog.ts` — add dreamscape entry
- `packages/langgraph-graphs/langgraph.json` — add server entrypoint
- `packages/langgraph-graphs/src/index.ts` — export graph name + factory
- `scripts/pr-dreamscape.sh` — new CLI script
- `.claude/commands/git-review.md` — new Claude Code command

## Plan

- [ ] **LiteLLM config**: Add `gemini-2.5-flash-image` model entry routed through OpenRouter
- [ ] **Graph factory**: Create `packages/langgraph-graphs/src/graphs/dreamscape/graph.ts` — single-call graph with image generation system prompt, no tools
- [ ] **Prompts**: Create `prompts.ts` with solarpunk dreamscape system prompt
- [ ] **Tools**: Create `tools.ts` with empty tool IDs (no tools needed)
- [ ] **Entrypoints**: Create `cogni-exec.ts` and `server.ts` following poet pattern
- [ ] **Catalog**: Add `dreamscape` entry to `LANGGRAPH_CATALOG`, `LANGGRAPH_GRAPH_IDS`
- [ ] **langgraph.json**: Add `dreamscape` server entrypoint
- [ ] **Package exports**: Export graph name + factory from package index
- [ ] **CLI script**: Create `scripts/pr-dreamscape.sh` — fetch PR, craft prompt, call OpenRouter for image, upload to GitHub, update PR body
- [ ] **Claude Code command**: Create `.claude/commands/git-review.md` wrapping the script
- [ ] **Validate**: `pnpm check` passes, `pnpm packages:build` succeeds

## Validation

**Command:**

```bash
pnpm check && pnpm packages:build
```

**Expected:** All lint, type-check, and build passes. New graph visible in catalog.

**Manual validation:**

```bash
# Test image generation via OpenRouter (requires OPENROUTER_API_KEY)
./scripts/pr-dreamscape.sh <PR_NUMBER>
```

**Expected:** Image generated and added to PR description.

## Review Checklist

- [ ] **Work Item:** `task.0162` linked in PR body
- [ ] **Spec:** all graph invariants upheld (PURE_FACTORY, TYPE_TRANSPARENT_RETURN, CATALOG_SINGLE_SOURCE_OF_TRUTH)
- [ ] **Tests:** manual validation of image generation pipeline
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
