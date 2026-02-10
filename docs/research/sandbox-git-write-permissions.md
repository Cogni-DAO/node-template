---
id: research.sandbox-git-write-permissions
type: research
title: "Research: Fastest Path to Sandbox Git Write Permissions"
status: active
trust: reviewed
summary: Evaluates 5 approaches for enabling sandboxed OpenClaw agents to create branches, commit, push, and create PRs — recommends host-side git relay with ephemeral containers.
read_when: Planning git relay implementation for sandbox agents
owner: derekg1729
created: 2026-02-11
verified: 2026-02-11
tags: [sandbox, openclaw, git, security]
---

# Research: Fastest Path to Sandbox Git Write Permissions

> spike: research | date: 2026-02-11

## Question

What is the fastest and cleanest path to enabling sandboxed OpenClaw agents to create/switch branches, make commits, push, and create PRs — without violating existing security invariants (SECRETS_HOST_ONLY, NETWORK_DEFAULT_DENY)?

## Context

**Current state**: OpenClaw runs in two modes, neither supports git writes today.

| Mode      | Network            | Workspace                     | Writable?          | Git Credentials? |
| --------- | ------------------ | ----------------------------- | ------------------ | ---------------- |
| Ephemeral | `network=none`     | Per-run temp dir + `/repo:ro` | Temp dir only      | None             |
| Gateway   | `sandbox-internal` | `/repo/current` (git-sync)    | No — mounted `:ro` | None             |

The gateway container also has tmpfs at `/workspace` (256m, writable) but the agent config points workspace to `/repo/current` (read-only). The agent has the `exec` tool (bash commands including `git`) but currently cannot write to the codebase mount.

**Existing specs** already call out host-side git relay as the planned approach (invariant 20: `HOST_SIDE_GIT_RELAY` in openclaw-sandbox-controls.md, Walk phase in proj.openclaw-capabilities.md). This research evaluates whether that plan is still the best path, and surveys alternatives.

**OpenClaw's git capabilities**: OpenClaw does NOT have built-in git tools (`git_commit`, `git_push`, etc.). Git operations happen via the general-purpose `exec` tool (bash). OpenClaw auto-initializes `.git/` on new workspaces (`ensureGitRepo()` in `workspace.ts`). No special credential handling — relies on system SSH/git config.

## Findings

### Option A: Host-Side Git Relay (Ephemeral Mode) — Already Spec'd

**What**: Agent runs in ephemeral `network=none` container with a writable workspace pre-cloned by the host. Agent reads/writes/commits locally (git requires no credentials for local operations). After container exits, host detects new commits, pushes the branch, and creates a PR. Credentials never enter the container.

**Flow**:

```
PRE-RUN (host, SandboxGraphProvider):
  1. git clone --depth=1 --branch=${baseBranch} ${repoUrl} ${workspace}/repo/
  2. git -C ${workspace}/repo checkout -b sandbox/${runId}
  3. Write .cogni/prompt.txt, .openclaw/openclaw.json

SANDBOX RUN (container, network=none):
  4. Agent reads repo, calls LLM, modifies files
  5. Agent runs: git add -A && git commit -m "..." (local only)
  6. No push — no credentials, no network

POST-RUN (host, SandboxGraphProvider):
  7. git -C ${workspace}/repo log ${baseBranch}..HEAD  →  changes?
  8. If changes: git push origin sandbox/${runId}  (using GITHUB_TOKEN)
  9. If createPr: octokit.pulls.create(...)
 10. Return PR URL in GraphFinal.content
 11. Cleanup workspace after push completes
```

**Pros**:

- Maximum security — credentials never enter the container, no network relaxation needed
- Well-validated by industry: SWE-agent, Codex CLI, Aider all use this pattern
- Already spec'd (invariants 20, 22, 23 in openclaw-sandbox-controls.md)
- Low implementation complexity: ~200 lines in SandboxGraphProvider (pre-run clone, post-run push)
- Works with existing ephemeral infrastructure — no new containers or services
- Agent doesn't need to know about git push at all

**Cons**:

- Agent can't push mid-task (batch-only, not real-time)
- Ephemeral mode is one-shot — no conversation continuity across runs
- Clone adds startup latency (~2-10s for shallow clone depending on repo size)
- Requires `GITHUB_TOKEN` env var on host (acceptable for P1 single-org)

**OSS tools**: None needed — just `child_process.exec` or `simple-git` npm package for host-side git ops. `@octokit/rest` for PR creation (already a dependency pattern in the ecosystem).

**Fit with our system**: Perfect fit. Uses existing ephemeral execution path. The pre-run/post-run wrapping happens in `SandboxGraphProvider`, not in the port layer (`SandboxRunnerPort`), preserving the clean separation. `WORKSPACE_SURVIVES_FOR_PUSH` (invariant 23) requires modifying the `finally` block to defer `rmSync` until push completes.

**Industry validation**:

- **SWE-agent/SWE-ReX**: Agent works in ephemeral container, orchestrator handles git externally
- **Codex CLI**: Default `network=none`; git mutations require user approval
- **Aider**: Commits locally only; user pushes manually
- **Docker AI Sandboxes**: File sync (bidirectional copy, not volume mount) between microVM and host

---

### Option B: In-Container Git via Network Proxy (Gateway Mode)

**What**: Instead of `network=none`, the container gets access to a filtering HTTP proxy that only allows connections to `github.com`. Git credentials are injected as short-lived tokens. Agent pushes directly.

**Pros**:

- Agent has real-time push capability (can show incremental progress, draft PRs)
- More natural for the gateway's long-running architecture

**Cons**:

- **Violates SECRETS_HOST_ONLY** — credentials must enter the container for `git push` to work
- Even with domain allowlisting, a prompt-injected agent could exfiltrate the token to github.com itself (credential misuse via the allowlisted endpoint)
- Requires changing gateway from `sandbox-internal` to a proxied network with domain filtering
- Adds infrastructure complexity: HTTP filtering proxy, certificate handling for HTTPS git
- **Breaks session isolation**: Gateway is shared; concurrent sessions editing the same repo would conflict

**OSS tools**: Docker Sandboxes has built-in HTTP proxy with domain allowlisting. Claude Code uses a custom SOCKS5 proxy with domain policies.

**Fit with our system**: Poor for gateway mode due to session isolation problems. Contradicts `SECRETS_HOST_ONLY`. Would require changing the security model.

**Not recommended.**

---

### Option C: GitHub App Installation Tokens (Credential Upgrade)

**What**: Replace long-lived PAT with short-lived (1-hour), repo-scoped tokens generated from a GitHub App installation. The App private key stays on the host; tokens are generated per-run.

**This is orthogonal to the relay-vs-in-container question** — it's about which credential to use, not where git operations execute. Can be combined with Option A or B.

**Pros**:

- Tokens auto-expire in 1 hour — limited blast radius if leaked
- Fine-grained permissions (e.g., `contents:write` + `pull_requests:write` on specific repos only)
- Multi-tenant: each billing account can have its own GitHub App installation
- Well-supported: `@octokit/auth-app`, `actions/create-github-app-token`

**Cons**:

- Requires one-time GitHub App setup (create app, install on org/repos)
- More code than just reading `process.env.GITHUB_TOKEN` (~20 lines for JWT generation + token exchange)
- Not necessary for single-org P1 use case

**Fit with our system**: Already planned for P2 via `ConnectionBroker` (invariant 22: `ENV_CREDENTIALS_FIRST`). The upgrade path is clean: replace `process.env.GITHUB_TOKEN` with `broker.resolveForTool("github_app_installation")`.

**Recommended for P2**, exactly as already spec'd.

---

### Option D: Git Credential Helper via Unix Socket

**What**: A custom git credential helper runs inside the container. When git needs credentials for `push`, the helper forwards the request over a Unix socket (bind-mounted from host) to a host-side service that has the actual credentials. Claude Code uses this approach.

**Pros**:

- Credentials don't persist in the container — fetched on-demand from host
- Works with `network=none` via socket (but git transport itself still needs network for push)
- Natural policy enforcement point (host can validate which repos/branches)

**Cons**:

- High complexity: client + server + socket mount + git config
- **Doesn't solve the transport problem**: Even with credentials, `git push` requires network access to reach GitHub. So you'd still need either a git transport proxy or network relaxation.
- Over-engineered for one-shot sandbox runs where host-side relay is simpler
- Better suited for long-running dev environments (VS Code Remote Containers)

**Fit with our system**: Poor. Adds significant complexity without solving the fundamental transport problem in `network=none` containers. The host-side relay is simpler and achieves the same security properties.

**Not recommended.**

---

### Option E: MCP/Tool-Based Git Push (Socket Bridge)

**What**: Instead of running `git push` directly, the agent invokes a "git_push" tool that sends a request over a Unix socket to a host-side service. The host performs the actual push. Similar to how the LLM proxy works (socket bridge), but for git operations.

**Pros**:

- Agent can push mid-task (real-time, not batch)
- Natural policy enforcement (host validates branch names, repo scope)
- Fits Unix socket bridge pattern already used for LLM proxy
- Clean integration with OpenClaw's tool system (custom tool)

**Cons**:

- Adds a new host-side service (git relay daemon) + socket mount
- Requires a custom OpenClaw tool definition (or MCP tool)
- More complex than host-side relay for one-shot tasks
- Agent workflow becomes synchronous on push (blocks while host pushes)

**Fit with our system**: Interesting for P2+ when tasks benefit from mid-run git operations (incremental PR updates, showing progress). Over-engineered for P1 one-shot tasks.

**Not recommended for P1. Consider for P2+ if use cases emerge.**

---

### Critical Gateway Mode Insight

**The gateway mode is architecturally unsuited for isolated code editing sessions today.** Here's why:

1. **Shared workspace**: Gateway config sets `"workspace": "/repo/current"` — shared across all concurrent sessions
2. **Read-only mount**: `/repo` is mounted `:ro` from the git-sync volume
3. **No per-session workspace**: OpenClaw's gateway protocol doesn't support per-session workspace paths. The workspace is set per-agent in config, not per-session at runtime.
4. **tmpfs is ephemeral**: `/workspace` (256m tmpfs) is writable but wiped when the container restarts, and is also shared across sessions

**Conclusion**: For code-editing tasks that need git write permissions, **use ephemeral mode** with a per-run writable workspace. Leave gateway mode for chat-only interactions where the agent reads the codebase but doesn't modify it.

If per-session workspace isolation in gateway mode becomes important (P2+), it would require either:

- OpenClaw protocol changes to support per-session workspace override
- Running multiple gateway instances (one per session) which defeats the shared-service benefit
- A "workspace broker" that creates per-session git worktrees from the shared clone

## Recommendation

**P1 (Now): Host-side git relay with ephemeral mode (Option A) + GITHUB_TOKEN (PAT).**

This is the fastest, cleanest, most secure path. It requires:

1. A new agent variant `sandbox:openclaw-coder` (ephemeral mode with git relay enabled)
2. Pre-run host clone into per-run workspace (~20 lines)
3. Post-run host diff/push/PR creation (~50 lines)
4. Deferred workspace cleanup (modify `finally` block, ~10 lines)
5. `GITHUB_TOKEN` env var on host

Total new code: ~100-200 lines in `SandboxGraphProvider` + tests.

**P2: Upgrade to GitHub App installation tokens (Option C).**

Replace `process.env.GITHUB_TOKEN` with short-lived, repo-scoped tokens from a GitHub App. Enables multi-tenant operation. Clean upgrade path via `ConnectionBroker`.

**P3 (If needed): Socket-bridged git tool (Option E).**

Add a host-side git relay daemon exposed via Unix socket. Agent invokes a `git_push` tool that bridges to the host. Only worthwhile if long-running tasks benefit from mid-run git operations.

## Comparison Matrix

| Criterion                  |      A: Host Relay      |        B: Proxy Net        | C: GH App Token  | D: Cred Socket | E: Tool Bridge |
| -------------------------- | :---------------------: | :------------------------: | :--------------: | :------------: | :------------: |
| Credential isolation       |        Excellent        |            Poor            |    Excellent     |      Good      |   Excellent    |
| New code required          |       ~200 lines        |           Medium           | +20 lines over A |      High      |     Medium     |
| Works with `network=none`  |           Yes           |             No             | Yes (host-side)  |    Partial     |  Yes (socket)  |
| Agent controls push timing |           No            |            Yes             |     Depends      |      Yes       |      Yes       |
| Session isolation          | Natural (per-container) |       Requires work        |       N/A        | Requires work  |    Natural     |
| Industry precedent         |         Strong          |           Strong           |      Strong      |     Niche      |    Growing     |
| Fits existing invariants   |         Perfect         | Violates SECRETS_HOST_ONLY |  Extends A or B  |    Complex     |      Good      |

## Open Questions

1. **Repo size latency**: How long does `git clone --depth=1` take for the target repo? For large repos, consider using `git worktree` from the existing git-sync clone instead of a fresh clone. This would require making the git-sync volume writable or maintaining a separate writable clone.

2. **Workspace volume for large repos**: Ephemeral mode writes the workspace to tmpdir. For large repos, this could exhaust `/tmp` space. May need a dedicated workspace volume or configurable workspace root.

3. **PR description generation**: Should the agent generate the PR description, or should the host auto-generate it from commit messages? The agent has better context (it knows what it changed and why), so consider writing a `.cogni/pr-description.md` file that the host reads during PR creation.

4. **Concurrent code runs**: If multiple users trigger code tasks simultaneously, each gets its own ephemeral container + workspace. This is clean. But `git push` of `sandbox/${runId}` branches could conflict if targeting the same base branch. The branch naming scheme (`sandbox/${runId}`) prevents this.

5. **Gateway mode code editing (P2+)**: If we want the gateway agent to do code editing, we need per-session workspace isolation. This is a significant architectural change that requires either OpenClaw protocol extensions or a workspace broker service.

## Proposed Layout

### Project

This fits within the existing **proj.openclaw-capabilities** Walk (P1) phase, specifically the "Host-Side Git Relay" section. No new project needed.

### Specs to Update

1. **openclaw-sandbox-controls.md** — The git relay design (section 2) is already well-spec'd. No changes needed for P1.
2. **openclaw-sandbox-spec.md** — Add an agent variant for code tasks (`sandbox:openclaw-coder`) to the "Agent Variant Registry" concept. Update "Agent Provisioning Guide" with git-aware AGENTS.md template.

### Tasks (PR-sized, in sequence)

1. **task: Host-side git clone + workspace setup** (~1 day)
   - Add `gitRelay` config to `SandboxAgentEntry` (repo URL, base branch, createPr flag)
   - Pre-run: `git clone --depth=1`, `checkout -b sandbox/${runId}`
   - Wire into `createContainerExecution()` before `runner.runOnce()`

2. **task: Host-side git push + PR creation** (~1 day)
   - Post-run: detect commits (`git log baseBranch..HEAD`), push branch
   - PR creation via `@octokit/rest` (or `gh` CLI)
   - `GITHUB_TOKEN` env var (host only)
   - Deferred workspace cleanup (`WORKSPACE_SURVIVES_FOR_PUSH`)

3. **task: Agent variant `sandbox:openclaw-coder`** (~0.5 day)
   - New entry in `SANDBOX_AGENTS` registry (ephemeral mode, git relay enabled)
   - AGENTS.md + SOUL.md templates for code-writing agent persona
   - Wire into agent catalog (`SandboxAgentCatalogProvider`)

4. **task: Stack test for git relay pipeline** (~1 day)
   - Test: agent modifies file + commits → host detects commit → (mock) push
   - Test: no commits → host skips push
   - Test: workspace cleanup after push

5. **task: Upgrade to GitHub App installation tokens** (P2, ~2 days)
   - Create GitHub App, install on org
   - `@octokit/auth-app` for JWT → installation token exchange
   - Wire through `ConnectionBroker.resolveForTool()`

## Sources

- [SWE-agent/SWE-ReX](https://github.com/SWE-agent/SWE-ReX) — Sandboxed execution for AI agents
- [OpenHands](https://github.com/OpenHands/OpenHands) — Git credential handling in sandbox
- [Anthropic: Claude Code Sandboxing](https://www.anthropic.com/engineering/claude-code-sandboxing) — Proxy-based git credential isolation
- [Docker AI Sandboxes Architecture](https://docs.docker.com/ai/sandboxes/architecture/) — MicroVM isolation + file sync
- [Docker AI Sandboxes Network Policies](https://docs.docker.com/ai/sandboxes/network-policies/) — HTTP proxy allowlisting
- [git-credential-forwarder](https://github.com/sam-mfb/git-credential-forwarder) — Socket-based credential forwarding
- [GitHub App Token Generation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
- [GitHub Actions Automatic Token Auth](https://docs.github.com/en/actions/security-guides/automatic-token-authentication)
- [Codex CLI Security](https://developers.openai.com/codex/security/) — OS-level sandbox with SOCKS5 proxy
- [Aider Git Integration](https://aider.chat/docs/git.html) — Local-only commits, user pushes
- [LangChain Open SWE](https://blog.langchain.com/introducing-open-swe-an-open-source-asynchronous-coding-agent/) — Async coding agent with Daytona sandboxes
