# AGENTS.md — Cogni-Template

> Repo-wide orientation, ≤60 lines (terser = better adherence). Subdir `AGENTS.md` extends; closest file wins ([agents.md spec](https://agents.md/)).

You are an agent inside a multi-agent system. The **operator** (`https://test.cognidao.org`) is your peer coordinator — not a deploy button. Every code change flows through it: claim a work-item session, drive the [development lifecycle](docs/spec/development-lifecycle.md), close to `deploy_verified: true`. Conductor / Claude Code sessions on a human's machine are **not** exempt — claim a session before you push.

## Required Loop

1. `GET /.well-known/agent.json`, `POST /api/v1/agent/register` for a Bearer token.
2. Adopt one work item, **one node** (`single-node-scope` is a CI gate). Cross-node ⇒ separate item.
3. Claim + heartbeat + link PR via `/api/v1/work/items/$ID/{claims,heartbeat,pr,coordination}`. **`coordination.nextAction` is authoritative** — it overrides your plan.
4. Implement on a worktree branch. **Do not run `pnpm dev:stack` or `pnpm check*` locally** — this machine is resource-constrained. Push, then **watch `gh pr checks` to green**; if red, iterate file-scoped fixes.
5. After CI green: `POST /api/v1/vcs/flight { prNumber }`. **Never `gh workflow run candidate-flight.yml` yourself** — it bypasses the operator and breaks session attribution.
6. Run [`/validate-candidate`](.claude/skills/validate-candidate/SKILL.md) against the deployed build, post the scorecard on the PR.

Hit a contract blocker (auth, broken endpoint, invariant you can't satisfy)? File a bug: `POST /api/v1/work/items {type:'bug', node:'operator'}`, link from your active item, continue or stop. Don't paper over.

## Definition of Done

`status: done` = code merged. `deploy_verified: true` = the **real** gate: candidate-a healthy, you exercised the feature on the deployed URL, and you saw your own request in Loki at the deployed SHA. Never conflate.

Two named human stops: `needs_review` post-`/design`, `needs_human_qa` post-flight. Drive yourself between them.

## Principles

- **Think before coding.** State assumptions, surface ambiguity, push back on over-scope.
- **Simplicity first.** Minimum code that solves the problem. No speculative abstractions, no error handling for impossible cases.
- **Surgical changes.** Touch only what the task demands. Mention drive-by issues; don't fix them.
- **Goal-driven execution.** Convert each task into a verifiable `## Validation` block; ship the smallest prototype to candidate-a; iterate against real behavior.
- **Find the existing artifact before writing new code.** Search `docs/spec/`, `docs/guides/`, `.claude/skills/`, `.claude/commands/`, the operator API. Duplicating an existing port / adapter / guide / skill poisons the codebase.

## Anti-patterns

- Running `gh workflow run candidate-flight.yml` from your own gh creds.
- Running `pnpm dev:stack` / `pnpm check*` locally instead of pushing + watching CI.
- Recreating a legacy `work/items/*.md` item — they're in prod Doltgres at original IDs (`bug.0002` stays `bug.0002`).
- Re-declaring HTTP types instead of importing from `src/contracts/*.contract.ts` (Zod is the SSoT).
- Inline comments narrating _what_ code does — names + types are the docs (see [style.md](docs/spec/style.md)).
- Stopping outside the two named review gates.
- `checkout`/`stash` on the user's main worktree — use git worktrees.
- Treating CI red on your PR as "pre-existing on main" — it's your code or your worktree.
- Hitting a mistake another agent will repeat without editing the guide that should have warned you.

## Pointers

- [Development Lifecycle](docs/spec/development-lifecycle.md) · [CI/CD](docs/spec/ci-cd.md) · [Agent-First API Validation](docs/guides/agent-api-validation.md)
- [`/contribute-to-cogni`](.claude/skills/contribute-to-cogni/SKILL.md) — executable contributor contract
- [Architecture](docs/spec/architecture.md) · [Style](docs/spec/style.md) · [Common Mistakes](docs/guides/common-mistakes.md) · [Work Management](work/README.md)
- **Stuck?** File a bug against the operator (above), or read [`/contribute-to-cogni`](.claude/skills/contribute-to-cogni/SKILL.md) end-to-end.
