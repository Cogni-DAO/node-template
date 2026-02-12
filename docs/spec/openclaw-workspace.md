---
id: openclaw-workspace-spec
type: spec
title: OpenClaw Gateway Workspace
status: active
spec_state: draft
trust: draft
summary: Dual-workspace architecture for the OpenClaw gateway agent — dedicated system prompt context, skills integration, memory configuration, and development workflow
read_when: Configuring gateway agent workspace, writing skills, or debugging agent system prompt content
owner: derekg1729
created: 2026-02-13
verified: 2026-02-13
tags: [sandbox, openclaw, system-prompt]
---

# OpenClaw Gateway Workspace

> [!CRITICAL]
> The gateway agent uses a **dual-workspace** layout: `/workspace/gateway/` for system prompt context (AGENTS.md, SOUL.md, memory), `/repo/current/` for the codebase. Skills live at repo root in `.openclaw/skills/`, loaded via `extraDirs`. When the agent needs to write code, it creates a git worktree from `/repo/current/` into a writable working directory.

## Problem

Three compounding issues cause bad gateway agent behavior:

1. **Wrong AGENTS.md** — workspace is `/repo/current/` (the full Cogni repo). OpenClaw reads `AGENTS.md` from workspace root — this is a coding-agent meta-prompt (`pnpm check`, spec-first, API contracts), not appropriate for a chat agent.
2. **No persona** — no `SOUL.md` or `MEMORY.md` at repo root. Generic agent behavior.
3. **No skills** — OpenClaw has its own skill system (`workspace/skills/`). It does not read `.claude/commands/`. The agent has no structured workflows.
4. **Memory index bloat** — if workspace = repo root, OpenClaw indexes the entire codebase for memory search. Slow, irrelevant results.

## Goal

Define the workspace layout, skills integration, memory configuration, and development workflow for the OpenClaw gateway agent so it has purpose-built system prompt context instead of inheriting the repo-root coding-agent meta-prompt.

## Non-Goals

- OpenClaw core changes (heartbeat fix is a separate upstream PR)
- Ephemeral sandbox workspace (different lifecycle, different concerns)
- OpenClaw plugin development (skills are sufficient)
- Full memory system tuning (embedding provider selection, chunking params)

## Invariants

> Numbering continues from [openclaw-sandbox-spec](openclaw-sandbox-spec.md) invariants 1–28.

29. **GATEWAY_WORKSPACE_SEPARATION**: The gateway agent's workspace (`agents.list[0].workspace`) is `/workspace/gateway/`, never the repo root. The repo is available read-only at `/repo/current/`. This prevents system prompt contamination and keeps memory indexing scoped to docs, not source code.

30. **SKILLS_AT_REPO_ROOT**: OpenClaw skills live at `.openclaw/skills/` in the repo root, loaded via `skills.load.extraDirs`. Consistent with `.claude/commands/` and `.gemini/commands/`. Skills are versioned with the codebase.

## Design

### Workspace Layout

```
/workspace/gateway/                    ← OpenClaw workspace root
├── AGENTS.md                          # Operating instructions: chat + dev workflow
├── SOUL.md                            # Cogni agent personality
├── TOOLS.md                           # Environment-specific tool guidance
├── MEMORY.md                          # Curated project context
└── memory/                            # Auto-populated by OpenClaw (gitignored)
    └── YYYY-MM-DD.md
```

OpenClaw reads these files at session start, truncated to `bootstrapMaxChars` (default 20,000 chars each). Subagents receive only `AGENTS.md` + `TOOLS.md`.

**Files not used:**

| File           | Reason                              |
| -------------- | ----------------------------------- |
| `IDENTITY.md`  | Identity set via config             |
| `USER.md`      | Multi-user gateway — no single user |
| `HEARTBEAT.md` | Heartbeats disabled (invariant 25)  |
| `BOOTSTRAP.md` | `skipBootstrap: true`               |

### Container Mounts

```yaml
# additions to openclaw-gateway service
volumes:
  - ./openclaw/gateway-workspace:/workspace/gateway # behavior files + runtime memory
  # existing:
  - repo_data:/repo:ro # codebase mirror
  - cogni_workspace:/workspace # persistent workspace volume
```

The bind mount overlays `/workspace/gateway/` inside the existing `cogni_workspace` named volume.

### Skills Integration

#### How OpenClaw Skills Work

OpenClaw discovers skills from multiple sources (in precedence order):

1. `<workspace>/skills/` — workspace skills (highest priority)
2. `~/.openclaw/skills/` — managed/installed skills
3. Bundled skills (built-in to OpenClaw)
4. `skills.load.extraDirs` — extra skill directories (config)
5. Plugin skills (extensions)

Each skill is a **markdown file with YAML frontmatter**:

```markdown
---
description: "Implement a work item following repo workflows"
user-invocable: true
---

# Instructions here (natural language, portable from .claude/commands/)
```

Key frontmatter fields:

| Field                      | Purpose                                   |
| -------------------------- | ----------------------------------------- |
| `description`              | Shown in system prompt + /help            |
| `user-invocable`           | Registers as `/skillname` slash command   |
| `disable-model-invocation` | Hide from agent (user-only)               |
| `command-dispatch: tool`   | Forward directly to a tool (bypass agent) |

Skills auto-register as `/skillname` commands in connected channels (Telegram, Discord, Slack).

#### Repo Layout

```
.openclaw/skills/                      ← repo root, alongside .claude/ and .gemini/
├── implement/
│   └── SKILL.md                       # /implement — code a work item
├── commit/
│   └── SKILL.md                       # /commit — conventional commit
├── spec/
│   └── SKILL.md                       # /spec — write/update a spec
├── test/
│   └── SKILL.md                       # /test — write tests
├── document/
│   └── SKILL.md                       # /document — update docs + headers
├── review-implementation/
│   └── SKILL.md                       # /review_implementation
├── bug/
│   └── SKILL.md                       # /bug — file a bug report
├── task/
│   └── SKILL.md                       # /task — decompose into PR-sized task
├── handoff/
│   └── SKILL.md                       # /handoff — context handoff doc
├── pull-request/
│   └── SKILL.md                       # /pull_request — create PR
└── ...
```

#### Config

```json5
{
  skills: {
    load: {
      extraDirs: ["/repo/current/.openclaw/skills"],
    },
  },
}
```

#### Conversion from Claude Code Commands

Each `.claude/commands/<name>.md` becomes `.openclaw/skills/<name>/SKILL.md`. The prompt content is portable — both systems use natural language instructions. Differences:

| Aspect       | `.claude/commands/`        | `.openclaw/skills/`                      |
| ------------ | -------------------------- | ---------------------------------------- |
| Format       | Plain markdown             | Markdown + YAML frontmatter              |
| Invocation   | `/name` in Claude Code CLI | `/name` in any connected channel         |
| Args         | `$ARGUMENTS` placeholder   | User args passed via channel             |
| Agent access | Always visible             | Controlled by `disable-model-invocation` |
| Dispatch     | Always through agent       | Optional direct tool dispatch            |

### Memory

Two layers:

**1. `MEMORY.md` (static)** — curated project context injected into system prompt. Architecture decisions, file layout conventions, known gotchas. Manually maintained, version-controlled.

**2. Semantic search (dynamic)** — `memory_search` tool provides vector + BM25 hybrid search. The agent calls this tool before answering about prior work, decisions, or project context.

```json5
{
  agents: {
    defaults: {
      memorySearch: {
        enabled: true,
        extraPaths: [
          "/repo/current/docs", // specs, guides, architecture
          "/repo/current/work", // projects, tasks, issues
        ],
      },
    },
  },
}
```

This indexes docs and work items **without indexing source code**. The `memory/` directory in the gateway workspace stores OpenClaw's auto-generated daily logs (gitignored).

### Development Workflow

The gateway agent is both a **chat responder** and a **developer**. The workspace separation means it starts in a clean chat context, then transitions to dev work when needed.

**Chat mode** (default): Agent responds from `/workspace/gateway/`, has access to curated context via MEMORY.md and semantic search over docs/work items.

**Dev mode** (on demand): When the task requires code changes:

1. Agent creates a git worktree: `git -C /repo/current worktree add /workspace/dev-<branch> -b <branch>`
2. Agent cds into `/workspace/dev-<branch>/`, reads its `AGENTS.md`
3. Agent follows repo workflows — `/implement`, `/commit`, `/test` skills guide the process
4. `GITHUB_TOKEN` and `COGNI_REPO_URL` are in env for git remote setup and GitHub API access

The gateway `AGENTS.md` documents this workflow explicitly.

### OpenClaw System Prompt Anatomy

For reference, `buildAgentSystemPrompt()` in OpenClaw injects these sections (full mode):

| Section         | Source                          | Our concern                           |
| --------------- | ------------------------------- | ------------------------------------- |
| Identity        | Hardcoded                       | Fine                                  |
| Safety          | Hardcoded                       | Fine                                  |
| Tooling         | `tools` config + deny list      | Controlled by our config              |
| Skills          | `skills/` directories           | **Need to populate**                  |
| Memory Recall   | `memorySearch` config           | **Need to configure**                 |
| Workspace Files | `AGENTS.md`, `SOUL.md`, etc.    | **Primary deliverable**               |
| Heartbeat       | `heartbeat` config              | **Bug — injected even when disabled** |
| Runtime         | Auto-populated                  | Fine                                  |
| Documentation   | Hardcoded (OpenClaw docs links) | Noise but harmless                    |
| Silent Replies  | `NO_REPLY` token                | `message` tool denied — inert         |

**Heartbeat bug**: OpenClaw `src/agents/system-prompt.ts:590-600` injects heartbeat instructions when `promptMode != "minimal"`, regardless of `heartbeat.every`. With `heartbeat.every: "0"`, the runner is disabled but the instruction stays in the prompt. The LLM hallucinates `HEARTBEAT_OK` as a chat response. Fix: upstream PR to make the section conditional on heartbeat being enabled.

## Anti-Patterns

| Pattern                                         | Problem                                                                          |
| ----------------------------------------------- | -------------------------------------------------------------------------------- |
| Workspace = repo root                           | Wrong AGENTS.md, memory indexes all source code                                  |
| Skills in `gateway-workspace/skills/`           | Not versioned with codebase, diverges from `.claude/` and `.gemini/` conventions |
| Copy `.claude/commands/` verbatim               | Missing YAML frontmatter, `$ARGUMENTS` won't resolve                             |
| `memorySearch.extraPaths` = `["/repo/current"]` | Indexes entire codebase including node_modules artifacts                         |
| Omit `MEMORY.md`                                | Agent has no curated project context, relies entirely on search                  |

## Acceptance Checks

- `docker exec openclaw-gateway cat /workspace/gateway/AGENTS.md` returns gateway-specific instructions (not repo-root meta-prompt)
- `docker exec openclaw-gateway cat /workspace/gateway/SOUL.md` returns agent personality
- `docker exec openclaw-gateway ls /repo/current/.openclaw/skills/` lists skill directories
- Send 5 messages via UI — zero `HEARTBEAT_OK` responses, coherent answers
- Agent can describe its own skills when asked ("what can you do?")

## Open Questions

### OQ-1: Gateway Workspace Markdown Validation

The `gateway-workspace/` AGENTS.md is excluded from the repo's `validate-agents-md.mjs` because it serves a different purpose (OpenClaw system prompt, not repo directory structure). The other workspace files (SOUL.md, TOOLS.md, MEMORY.md) have no validation at all. Consider adding a lightweight validator that checks these files for basic structure (non-empty, reasonable length, no stale info).

## Related

- [openclaw-sandbox-spec](openclaw-sandbox-spec.md) — Core integration invariants 13–28, container images, billing
- [openclaw-sandbox-controls](openclaw-sandbox-controls.md) — Git relay, agent catalog, credential strategy
- [task.0023](../../work/items/task.0023.gateway-agent-system-prompt.md) — Implementation task
- OpenClaw system prompt: `src/agents/system-prompt.ts` (in openclaw repo)
- OpenClaw skills: `src/agents/skills/workspace.ts` (in openclaw repo)
- OpenClaw memory: `src/memory/` (in openclaw repo)
