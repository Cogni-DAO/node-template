---
id: openclaw-memory-workspace-alignment
type: research
title: "Research: OpenClaw Memory Backend & Workspace Alignment"
status: active
trust: draft
summary: How to configure OpenClaw memory search and bootstrap files for cogni-template repo context
read_when: Configuring OpenClaw workspace, memory search, or bootstrap file alignment
owner: derekg1729
created: 2026-02-11
verified: 2026-02-11
tags: [openclaw, memory, research]
---

# Research: OpenClaw Memory Backend & Workspace Alignment for Cogni-Template

> spike: (ad-hoc research) | date: 2026-02-11

## Question

How can we configure OpenClaw's memory backend so that an agent running inside OpenClaw can semantically search and retrieve context from the cogni-template repo (especially `/docs` and `/work`)? Will this work harmoniously with OpenClaw's existing bootstrap file system (AGENTS.md, SOUL.md, MEMORY.md) and tool retrieval?

## Context

OpenClaw is our sandboxed agent runtime. Today, the cogni-template repo is mounted read-only at `/repo` inside the OpenClaw container (via `repo_data:/repo:ro` in docker-compose). The agent's workspace is a tmpfs at `/workspace`. The gateway config (`openclaw-gateway.json`) sets `agents.list[0].workspace = "/repo/current"` — pointing the agent's working directory at the repo mount.

The agent can already `read`, `grep`, and `find` files in `/repo/current`. But it has no **memory search** (vector/hybrid semantic retrieval) over our docs, and no curated workspace bootstrap files (AGENTS.md, SOUL.md, MEMORY.md) tailored to the cogni-template context.

### Core Questions

1. How does OpenClaw's memory backend work, and how do we point it at our repo's docs?
2. How do workspace bootstrap files (AGENTS.md, SOUL.md, etc.) get injected into the system prompt?
3. Can we have both cogni-template-specific context AND OpenClaw's native memory system?
4. What's the minimal config change to wire this up?

## Findings

### OpenClaw's Two Context Delivery Mechanisms

OpenClaw has **two independent systems** for giving the agent repo awareness:

#### Mechanism 1: Bootstrap Files → System Prompt Injection

**How it works:**

- On session start, OpenClaw loads files from the workspace directory: `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`, `USER.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`, `MEMORY.md` (+ `memory.md`)
- Source: `src/agents/workspace.ts` → `loadWorkspaceBootstrapFiles()`
- These are injected verbatim into the system prompt under `# Project Context`
- Source: `src/agents/system-prompt.ts:552-569`
- Each file gets its own `## <filename>` section
- Files are trimmed if they exceed `bootstrapMaxChars` (default: 20,000 chars per file) — 70% head + 20% tail with truncation marker
- Source: `src/agents/pi-embedded-helpers/bootstrap.ts:84-136`

**Subagent filtering:** Subagents only get `AGENTS.md` and `TOOLS.md` (security — no MEMORY.md/SOUL.md leakage to subagents).

**Key insight:** Since our gateway config sets `workspace: "/repo/current"`, OpenClaw will look for `AGENTS.md` at `/repo/current/AGENTS.md` — **which already exists in our repo!** Our root `AGENTS.md` is already being loaded as a bootstrap file.

**But:** The current config has `"skipBootstrap": true`, which skips the template-writing step for brand-new workspaces. This doesn't skip _loading_ existing files — it just doesn't create missing ones. So our existing `AGENTS.md` should already be getting loaded if the workspace points at `/repo/current`.

#### Mechanism 2: Memory Search → Vector/Hybrid RAG

**How it works:**

- OpenClaw has a built-in vector memory backend using SQLite + sqlite-vec extension
- Source: `src/memory/manager.ts` (2,412 lines)
- By default, it indexes:
  - `MEMORY.md` in workspace root
  - `memory.md` in workspace root
  - `memory/**/*.md` — all markdown in the `memory/` subdirectory
- **`extraPaths`** — additional directories/files to index
- Source: `src/memory/internal.ts:78-144` (`listMemoryFiles()`)
- The agent can search via `memory_search` tool (semantic query → ranked results)
- The agent can retrieve via `memory_get` tool (fetch specific file/lines)
- Embeddings: OpenAI `text-embedding-3-small` by default, with Gemini/Voyage/local fallbacks

**The key config knob: `memorySearch.extraPaths`**

```json
{
  "agents": {
    "defaults": {
      "memorySearch": {
        "enabled": true,
        "extraPaths": ["docs", "work"],
        "provider": "auto"
      }
    }
  }
}
```

From `src/agents/memory-search.ts:180-183`:

```typescript
const rawPaths = [
  ...(defaults?.extraPaths ?? []),
  ...(overrides?.extraPaths ?? []),
]
  .map((value) => value.trim())
  .filter(Boolean);
const extraPaths = Array.from(new Set(rawPaths));
```

From `src/memory/internal.ts:33-44`:

```typescript
export function normalizeExtraMemoryPaths(
  workspaceDir: string,
  extraPaths?: string[]
): string[] {
  // Relative paths resolved against workspaceDir
  const resolved = extraPaths
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) =>
      path.isAbsolute(value)
        ? path.resolve(value)
        : path.resolve(workspaceDir, value)
    );
  return Array.from(new Set(resolved));
}
```

**So `extraPaths: ["docs", "work"]` with `workspace: "/repo/current"` would resolve to `/repo/current/docs` and `/repo/current/work`.** All `*.md` files in those trees get indexed into the vector store.

### Option A: Minimal Config — extraPaths Only

**What:** Add `memorySearch.extraPaths` to the gateway config pointing at `docs/` and `work/`.

**Config change to `openclaw-gateway.json`:**

```json
{
  "agents": {
    "defaults": {
      "model": { "primary": "cogni/gemini-2.5-flash" },
      "sandbox": { "mode": "off" },
      "skipBootstrap": true,
      "timeoutSeconds": 540,
      "heartbeat": { "every": "0" },
      "memorySearch": {
        "enabled": true,
        "extraPaths": ["docs", "work"],
        "provider": "auto"
      }
    },
    "list": [{ "id": "main", "default": true, "workspace": "/repo/current" }]
  }
}
```

**Pros:**

- Zero code changes — config-only
- Our existing `AGENTS.md` at repo root already loads as the bootstrap context
- Agent gets semantic search over all `/docs/**/*.md` and `/work/**/*.md` files
- Works with OpenClaw's existing `memory_search`/`memory_get` tools
- File-watching keeps the index current as repo changes

**Cons:**

- Requires an embedding provider (OpenAI API key or local model) — adds cost/complexity
- The vector index (SQLite DB) needs to live somewhere writable — `/workspace` tmpfs works but rebuilds every container restart
- Index rebuild on cold start could be slow for ~97+ docs
- No curated `MEMORY.md` for long-term agent memory (we'd need to create one)
- No `SOUL.md` for agent personality/tone guidance
- 20,000 char bootstrap limit per file — our `AGENTS.md` is ~5KB so fits fine, but long specs won't be fully injected (they'd be searchable via memory_search though)

**Embedding provider options:**

- `"auto"` tries OpenAI → falls back to local (node-llama-cpp)
- For our sandboxed container with no outbound network except LLM proxy, we'd need either:
  - Route embedding requests through LiteLLM proxy (add embedding model to config)
  - Use local embeddings (heavier container, but no network dependency)

### Option B: Workspace Overlay — Custom Bootstrap Files + extraPaths

**What:** Create a thin overlay directory with cogni-specific bootstrap files, mount it alongside the repo, and use `extraPaths` for searchable docs.

**Layout (in repo at `services/sandbox-openclaw/workspace/`):**

```
workspace/
  AGENTS.md     → Cogni-specific agent instructions (compact, <20K chars)
  SOUL.md       → Agent personality/tone for cogni context
  MEMORY.md     → Curated long-term knowledge about the project
  TOOLS.md      → Notes on available tools, repo-specific commands
```

**Docker volume mount:**

```yaml
volumes:
  - ../../../../services/sandbox-openclaw/workspace:/workspace/overlay:ro
```

**Problem:** OpenClaw's workspace is a single directory. You can't easily have workspace = `/repo/current` for file operations but bootstrap files from a different path.

**Alternative:** Set workspace to the overlay dir, and use `extraPaths` with absolute paths:

```json
{
  "agents": {
    "list": [
      {
        "id": "main",
        "default": true,
        "workspace": "/workspace/cogni"
      }
    ],
    "defaults": {
      "memorySearch": {
        "extraPaths": ["/repo/current/docs", "/repo/current/work"]
      }
    }
  }
}
```

But then the agent's working directory wouldn't be the repo — it'd need to `cd /repo/current` for code operations. **This is worse.** The agent should have its working directory in the repo.

**Better alternative:** Keep `workspace: "/repo/current"` and place bootstrap files directly in the repo. We already have `AGENTS.md` there. We could add:

- A `MEMORY.md` at repo root (or accept the existing memory dir pattern)
- A `SOUL.md` at repo root (optional — for personality)

**Pros:**

- Full control over system prompt injection
- Agent gets tailored instructions + personality
- Memory search over docs/work via extraPaths
- All bootstrap files version-controlled in the repo

**Cons:**

- Adding `SOUL.md`/`MEMORY.md` to repo root may be unwanted clutter
- These OpenClaw-specific files would need to be in `.gitignore` or accepted as part of the repo
- Risk of our `AGENTS.md` being too large (>20K chars) — currently ~5KB, so fine

### Option C: Bootstrap Hook Injection (Advanced)

**What:** Use OpenClaw's `agent:bootstrap` internal hook to programmatically inject additional context files without cluttering the repo.

OpenClaw has an internal hook system (`src/hooks/internal-hooks.ts`) that fires before the system prompt is built. Hooks can mutate the `bootstrapFiles` array, adding/removing/replacing files.

**How:**

1. Write a custom hook (JavaScript) that reads key docs and injects them as synthetic bootstrap files
2. Register it in the OpenClaw config

**Pros:**

- Maximum flexibility — can dynamically select which docs to inject
- No repo clutter
- Can combine with extraPaths for search

**Cons:**

- Requires writing and maintaining a custom hook
- Over-engineered for our current needs
- Hook system is internal/undocumented API surface

**Verdict:** Not recommended for now. extraPaths + existing AGENTS.md is sufficient.

### Compatibility Analysis: Will This Conflict?

| Component                         | Existing Behavior                                 | With extraPaths Config                     | Conflict?         |
| --------------------------------- | ------------------------------------------------- | ------------------------------------------ | ----------------- |
| AGENTS.md bootstrap               | Loads from workspace (`/repo/current/AGENTS.md`)  | Same — our repo AGENTS.md loads            | **No**            |
| SOUL.md bootstrap                 | Not found (missing) → shows `[MISSING]` in prompt | Same unless we create one                  | **No**            |
| MEMORY.md bootstrap               | Not found → shows `[MISSING]`                     | Same unless we create one                  | **No**            |
| memory_search tool                | Indexes workspace memory files only               | Now also indexes docs/ and work/           | **No — additive** |
| memory_get tool                   | Retrieves file content by path                    | Works for both memory and extraPaths files | **No**            |
| File operations (read/write/edit) | Workspace = /repo/current                         | Same — unchanged                           | **No**            |
| Skills system                     | Loads from workspace/skills/                      | No skills dir in repo — no effect          | **No**            |

**No conflicts.** The `extraPaths` mechanism is purely additive — it adds files to the memory search index without affecting bootstrap file loading or file operations.

### Embedding Provider for Sandboxed Container

The OpenClaw container runs on `sandbox-internal` network with access only to the LiteLLM proxy. For memory search embeddings:

**Option 1: Route through LiteLLM** (Recommended)

- Add an embedding model to LiteLLM config (e.g., `text-embedding-3-small` via OpenRouter)
- Set `memorySearch.remote.baseUrl` to point at the proxy
- Cost: ~$0.02 per million tokens (our 97 docs ≈ ~200K tokens = $0.004 to index once)

**Option 2: Local embeddings** (node-llama-cpp)

- No network dependency, but requires GGUF model in container
- Heavier image size (~500MB+ for embedding model)
- Slower indexing

**Option 3: Disable memory search, rely on grep/find**

- Agent already has grep/find tools for the full repo
- No semantic search, but works for keyword-based lookups
- Zero infrastructure overhead

## Recommendation

**Start with Option A (extraPaths only) + Option 3 (no embeddings yet).**

The immediate win is minimal:

1. **Confirm our AGENTS.md is already being loaded** — it should be, since `workspace: "/repo/current"` points at the repo root. Verify by checking agent system prompt.

2. **Add `memorySearch.extraPaths`** to the gateway config for future use, but keep `memorySearch.enabled: false` until we set up an embedding route through LiteLLM.

3. **Optionally create a `MEMORY.md`** at repo root with curated project knowledge (key architectural decisions, conventions, frequently-needed context). Keep it under 20K chars.

4. **For now, the agent uses grep/find** for repo searches. This already works and costs nothing.

5. **When we add embedding support**, flip `memorySearch.enabled: true` and add an embedding model to LiteLLM config. The extraPaths will immediately start indexing.

### Concrete Config Change (Immediate)

```json
{
  "agents": {
    "defaults": {
      "model": { "primary": "cogni/gemini-2.5-flash" },
      "sandbox": { "mode": "off" },
      "skipBootstrap": true,
      "timeoutSeconds": 540,
      "heartbeat": { "every": "0" },
      "memorySearch": {
        "enabled": false,
        "extraPaths": [
          "docs/spec",
          "docs/guides",
          "docs/research",
          "work/projects",
          "work/items"
        ]
      }
    },
    "list": [{ "id": "main", "default": true, "workspace": "/repo/current" }]
  }
}
```

Note: targeting specific subdirs rather than top-level `docs/` avoids indexing archive/template/reference noise.

## Open Questions

- **Embedding route through LiteLLM proxy**: Does our LiteLLM config support embedding models today? If not, what's the config change?
- **Index persistence across restarts**: The `/workspace` tmpfs is wiped on restart. Should we add a named volume for the memory SQLite DB (`~/.openclaw/memory/`)?
- **Bootstrap file truncation**: Our root `AGENTS.md` is ~5KB — well under the 20K char limit. But if we grow it, we'd need to watch for truncation.
- **MEMORY.md authorship**: Who maintains a curated `MEMORY.md` — a human, the agent during heartbeats, or a CI script? For our use case (sandboxed, no heartbeats), it'd need to be human-curated or generated at build time.
- **Test config alignment**: The test config (`openclaw-gateway.test.json`) should mirror these changes for stack tests.

## Proposed Layout

### No new project warranted

This is a config change + optional file additions. It fits within the existing `proj.openclaw-capabilities` project.

### Specs to update

- **`docs/spec/openclaw-sandbox-spec.md`** — add a section on memory search configuration and bootstrap file alignment

### Tasks (if we proceed)

1. **task: Update gateway config with extraPaths** — add `memorySearch` config to `openclaw-gateway.json` and test config. Verify `AGENTS.md` is being loaded via system prompt inspection. (PR-sized, ~1 hour)

2. **task: Add embedding model to LiteLLM config** — configure `text-embedding-3-small` or equivalent through LiteLLM proxy. Verify OpenClaw can call it from sandbox network. (PR-sized, ~2 hours)

3. **task: Enable memory search E2E** — flip `enabled: true`, verify index builds on boot, test `memory_search` returns relevant docs. (PR-sized, ~2 hours)

4. **Optional: Create curated MEMORY.md** — summarize key architectural decisions, conventions, and context the agent needs frequently. Keep under 20K chars. (PR-sized, ~1 hour)
