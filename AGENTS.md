# AGENTS.md — Cogni-Template

> 🛑 **DEVELOPMENT FREEZE — this is a downstream ARTIFACT, not a dev repo.**
>
> `Cogni-DAO/node-template` is an **artifact** of the hub monorepo **`Cogni-DAO/cogni`**. Per the [repo-sync-contract](https://github.com/Cogni-DAO/cogni/blob/main/docs/spec/repo-sync-contract.md) (`HUB_IS_COGNI_MONOREPO`, `ONE_FIX_ONE_LINEAGE`), code has **exactly one lineage**: it originates in the hub and is **ported outward** to this repo. Fixing a bug here forks the lineage and is the drift source the sync detector exists to catch.
>
> **Do not open feature/fix PRs against this repo.** The only permitted changes are:
> 1. **Ports from the hub** — landing a change already merged in `Cogni-DAO/cogni`, cherry-picked verbatim (the [sync-drift detector](https://github.com/Cogni-DAO/cogni/issues/1366) lists what needs porting).
> 2. **This freeze notice** + the porting protocol below — the one document allowed to originate here.
>
> Have a change to make? Open it against **`Cogni-DAO/cogni`**, get it merged + flighted there, then port it down. New here? Read [`/contribute-to-cogni`](.claude/skills/contribute-to-cogni/SKILL.md) — but note the contribution target is the hub.
>
> **Porting protocol:** hub PR merged → sync-drift detector flags the path on issue [#1366](https://github.com/Cogni-DAO/cogni/issues/1366) → coordination owner ports the file(s) verbatim to this repo → drift item clears. No re-implementation, no local edits, no "while I'm here" changes.

> Repo-wide orientation. Subdir `AGENTS.md` extends; closest file wins ([agents.md spec](https://agents.md/)). Each `nodes/<node>/AGENTS.md` defines that node's rules — read it once you know your scope.

You are an agent inside a multi-agent system. The **operator** (`https://cognidao.org`) is your coordinator for code + docs updates, flighting, and validation reports. Whether you run hosted or as a Claude Code / Conductor session on a human's laptop, the contract is the same: every code change flows through the operator.

## Required Loop

1. Adopt one work item, **one node** (`single-node-scope` is a CI gate; cross-node ⇒ separate item). Read `nodes/<node>/AGENTS.md` for that node's rules.
2. Claim + heartbeat + link PR via `/api/v1/work/items/$ID/{claims,heartbeat,pr,coordination}`. **`coordination.nextAction` is authoritative** — it overrides your plan.
3. Implement on a worktree branch. Push — **CI is your verification.** Watch `gh pr checks`; iterate file-scoped fixes if red.
4. After CI green + reviewed implementation: `POST /api/v1/vcs/flight { prNumber }`. The build lands at `https://<node>-test.cognidao.org`.
5. Run [`/validate-candidate`](.claude/skills/validate-candidate/SKILL.md) against the deployed build. Adherence to its validation flow and scorecard format is strict — that's how the system confirms you followed the contract.
6. Hit a contract blocker (auth, broken endpoint, invariant you can't satisfy)? File a bug: `POST /api/v1/work/items {type:'bug', node:'operator'}`, link from your active item.

> Bearer token expected. New contributors register once via [`/contribute-to-cogni`](.claude/skills/contribute-to-cogni/SKILL.md); existing agents reuse the saved token.

## Definition of Done

`status: done` ⇔ code merged. **Code only merges after both**:

1. Full green: reviewed implementation + CI green on the PR.
2. `deploy_verified: true` — flighted to candidate-a, `/validate-candidate` scorecard posted, your own request observed in Loki at the deployed SHA.

Two named human stops: `needs_review` post-`/design`, `needs_human_qa` post-flight. Drive yourself between them.

## Principles

- **Reuse + reproducibility.** Find existing code (this repo or OSS) that meets your need before writing new. When you do code, code for reuse. For deployments, reproducibility is non-negotiable — no ad-hoc actions; solve each problem once and capture it in git.
- **Search before designing.** `docs/spec/`, `docs/guides/`, `.claude/skills/`, `.claude/commands/`, and the operator API (work items + projects + knowledge) hold prior thinking, designs, and priorities. Refine + simplify + clean what exists rather than add parallel artifacts.
- **Goal-driven execution.** Up front, with the user, identify the before/after I/O that will be clearly testable by a human or an agent. Before closing the work item, you must be able to prove the starting goal is met.
- **Clean architecture.** Hexagonal layering. Strongly-typed boundaries (Zod). Systemic observability (Pino → Loki). Idempotent operations. Strict typing — no `any`.
- **Purge legacy.** Backwards-compat shims are debt unless the user explicitly asks for them.
- **Clarity, conciseness, syntropy.** Code and prose alike — fewer words, sharper meaning, aligned with what already exists. Entropy creeps in through volume.

## Anti-patterns

- Adding backwards-compatibility unless specifically user-instructed. Purge legacy in place.
- Inline comments narrating _what_ code does, or verbose prose. More text, more entropy — names + types are the docs.
- Ending a turn before `deploy_verified` without an armed `Monitor`/`ScheduleWakeup` on the gating signal (CI, flight, `/version`). Silent end-of-turn = work lost.

## Pointers

- [Development Lifecycle](docs/spec/development-lifecycle.md) · [CI/CD](docs/spec/ci-cd.md) · [Agent-First API Validation](docs/guides/agent-api-validation.md) · [`/validate-candidate`](.claude/skills/validate-candidate/SKILL.md)
- [`/contribute-to-cogni`](.claude/skills/contribute-to-cogni/SKILL.md) — registration + executable contributor contract
- [Architecture](docs/spec/architecture.md) · [Style](docs/spec/style.md) · [Common Mistakes](docs/guides/common-mistakes.md) · [Work Management](work/README.md)
- **Stuck?** File a bug against the operator (above), or read [`/contribute-to-cogni`](.claude/skills/contribute-to-cogni/SKILL.md) end-to-end.
