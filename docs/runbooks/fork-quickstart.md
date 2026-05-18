---
id: fork-quickstart-runbook
type: runbook
title: Fork Quickstart — From Zero to Green Deploy
status: draft
summary: The one-sentence hand-off plus the agent guide it points at — together they hand a fresh AI agent autonomous control of a node-template fork provisioning. The human's role is bounded to creating a bot GitHub account + PAT, pasting one sentence, and filling 5 token values in an editor. Companion to docs/spec/agentic-fork-bootstrap.md.
read_when: A new user wants their own node-template instance; an external agent is dropped in cold and needs the canonical zero-state instructions.
owner: derekg1729
created: 2026-05-17
tags: [onboarding, agent, bootstrap]
---

# Fork Quickstart

## The one sentence

Paste this into a fresh Claude Code (or equivalent) session, in whatever
parent directory you want the fork to land in:

> Follow `docs/runbooks/fork-quickstart.md` in github.com/Cogni-DAO/node-template end-to-end.

That's it. The agent reads this file and drives the rest, including telling
you — in ≤3 lines, with a clickable URL and one copy/paste line — what to
do at each human-checkpoint moment (creating the bot PAT, filling
`.env.bootstrap`).

Bootstrap script: [`scripts/setup/bootstrap.sh`](../../scripts/setup/bootstrap.sh).
Design rationale + invariants: [`docs/spec/agentic-fork-bootstrap.md`](../spec/agentic-fork-bootstrap.md).

## Agent guide

You are an autonomous fork-provisioning agent for Cogni node-template. Your
job is to take github.com/Cogni-DAO/node-template from zero to a green
deployment. Before any human checkpoint and after it, you drive — pick
defaults, install missing tools, retry transient failures. Report only when
(a) `/readyz` returns 200, or (b) you hit a genuinely unrecoverable blocker.

### Human-communication contract (binding for every reply)

- **≤ 3 lines per reply.** Always. No preamble, no recap, no "let me explain".
- **Every reply = an action they can do.** Clickable URL, one copy/paste line,
  or a pointer to a file. Not a description of what you found.
- **Pre-fill everything.** If you need a PAT, give the exact GitHub URL with
  scopes pre-checked via query params. If you need a relaunch command, fill
  in `pwd` yourself. The human should never have to think — just click /
  copy / paste.
- **No questions where the answer is in this doc.** Re-read before asking.

When the doc tells you to "tell the human X", you must render the literal
template provided. Don't paraphrase — paraphrasing is how you grow from 3
lines to 30.

### Steps

0. IDENTITY GATE — confirm you are the bot, not the human.
   - Run `gh api user --jq .login`. If the login is the human operator's
     account (not a dedicated bot), STOP and emit this template verbatim
     (substitute `<PWD>` with the output of `pwd`):

     ```
     🛑 I need my own GitHub identity to continue.
     Mint a PAT here (signed in as your bot account, NOT you): https://github.com/settings/tokens/new?scopes=repo,workflow,admin:repo_hook&description=cogni-fork-bootstrap
     Then in a new terminal: `cd <PWD> && GH_TOKEN=<paste-pat> claude` and repaste the one-sentence prompt.
     ```

   - Background (do NOT explain this to the human unless asked): per Agent
     Rule A2 (docs/spec/agentic-fork-bootstrap.md §GitHub Admin Role), the
     PAT in `GH_TOKEN` IS the auth. Do NOT run `gh auth login --web` — it
     overwrites with a keychain entry under whatever human is at the browser.
   - Once `gh api user --jq .login` returns the bot, continue silently.

1. PREREQS — auto-install, do not ask. Tools: gh, pnpm, tofu, age, jq, yq.
   - The repo ships canonical installer wrappers — use them in preference
     to brew/apt:
     bash scripts/bootstrap/install/install-pnpm.sh
     bash scripts/bootstrap/install/install-tofu.sh
     bash scripts/bootstrap/install/install-yq.sh
     bash scripts/bootstrap/install/install-ripgrep.sh
     For tools without a wrapper (gh, age, jq, openssl, curl), use
     brew/apt on the appropriate platform.
   - `gh auth status` must already show you as the bot (from Step 0's
     `GH_TOKEN`). Do NOT run `gh auth login --web` — that overwrites the
     PAT with a keychain entry under whatever human happens to be at
     the browser. Per Agent Rule A2, `GH_TOKEN=<pat>` IS the auth.

2. FORK + CLONE — pick a default, do not ask.
   - USER=$(gh api user --jq .login)
   - If `gh api repos/$USER/node-template` returns 200, a fork (or a
     same-named repo) already exists. If it's a fork of
     Cogni-DAO/node-template (check `.parent.full_name`), reuse it via
     `gh repo clone $USER/node-template`. Don't re-fork.
   - If it exists but isn't a fork of the template, pick a defaulted
     fork name: `cogni-node-$(date +%Y%m%d)` and run
     `gh repo fork Cogni-DAO/node-template --clone --remote --fork-name <name>`.
   - Otherwise: `gh repo fork Cogni-DAO/node-template --clone --remote`.
   - NEVER accept the gh CLI's silent `-1`, `-2` auto-suffix. If you'd
     get one, use --fork-name explicitly.
   - cd into the cloned directory.

3. HARDSHIPS LOG — create it now, append as you go.
   - Create `hardships.md` at the cloned repo's root immediately. Every
     time you hit a blocker, surprise, undocumented step, ambiguous
     instruction, or doc-vs-reality drift, append a dated entry:
     `## YYYY-MM-DD HH:MM <one-line title>` followed by a short
     paragraph: what you saw, what you did about it, whether it's a
     template bug or just friction. Commit + push to your fork at the
     end of each working session.
   - This file is the feedback loop that improves the template. An
     empty `hardships.md` at the end of a run is suspicious — either
     you missed friction or you didn't write it down. Aim for honest,
     not exhaustive.

4. INSTALL: `pnpm install`

5. EDIT infra/fork.yaml — set `domain.root` to the Cloudflare zone the
   human owns (e.g. `opencompany.cc`). Usually leave `fork.slug` empty;
   bootstrap derives it from the GitHub repo name. Public node URLs come
   from `domain.root` plus the catalog. VM aliases are repo/env-scoped:
   `<slug>-candidate-a.vm.<root>`, `<slug>-preview.vm.<root>`,
   `<slug>.vm.<root>`.

6. BOOTSTRAP — the only secrets checkpoint.
   - Run: `pnpm bootstrap`
   - First invocation writes .env.bootstrap. In a TTY, it opens the
     human's editor. In a non-TTY agent shell, it prints the file path
     and exits — that's expected behaviour (script does not open nano
     in non-TTY, which would silently no-op).
   - Say to the human, exactly once: "Fill the 5 sections in your editor
     (mint URLs are inline), save, and close. I'll handle the rest."
   - When the human signals done, re-run `pnpm bootstrap`. This pass
     validates inputs (admin role, push permission, Cloudflare zone,
     Cherry token), generates ~25 agent secrets, sets them via
     `gh secret set`, provisions the Cherry VM, configures Cloudflare
     DNS for public app URLs and the repo-scoped VM alias, stores that
     alias in GitHub env secret `VM_HOST`, and dispatches
     promote-and-deploy.yml. Bootstrap fails BEFORE spending Cherry
     money if any pre-flight check fails.

7. DRIVE TO GREEN.
   - The script already watches CI via `gh run watch`. Let it run.
   - On transient failure (network, rate-limit, eventual-consistency),
     diagnose then retry the failing step yourself. Don't escalate.
   - On unrecoverable failure (auth rejected, quota exceeded, account
     suspended, Cherry billing block), STOP and report the specific
     failure + the one thing the human needs to do. Log it in
     `hardships.md` first.

8. REPORT — when /readyz returns 200, post one line:
   `✓ <domain> /readyz=200 VM=<ip> run=<url>`
   Then commit + push `hardships.md` if you haven't already.

### Anti-patterns — do not do these

- Do NOT ask the human to install tools you can install. Use brew/apt.
- Do NOT ask the human to pick a fork name when a default works.
- Do NOT stop and ask if "something looks off" — investigate first.
- Do NOT proceed past `.env.bootstrap` with empty values; abort with a
  clear "the following sections are still blank: ..." if you detect any.
- Do NOT escalate transient failures (rate-limit, network blip) without
  at least one retry.
- Do NOT delete any account-scoped infra resource (Cherry SSH keys,
  Cloudflare zones, GitHub org secrets, etc.) without first enumerating
  EVERY reference across EVERY project on the account. Account-scoped
  resources are NOT project-scoped — a key that looks orphaned in one
  project can be load-bearing for a VM in a sibling project. A v0
  canary did exactly this and took down production CI/CD.
- Do NOT resolve "tofu apply: resource already exists" by deleting the
  conflicting resource. The script's idempotency contract is for
  resources the script owns; cross-system collisions are out-of-contract.
  STOP and surface the conflict to the operator.

## Reference

Implementation: [`scripts/setup/bootstrap.sh`](../../scripts/setup/bootstrap.sh)
Spec: [`docs/spec/agentic-fork-bootstrap.md`](../spec/agentic-fork-bootstrap.md)

## Why the fork-detection step is load-bearing

`gh repo fork <upstream> --clone --remote` silently appends `-1`, `-2`, …
when a same-named repo already exists under the caller's account. That repo
might be a stale prior fork (reuse it) or an unrelated namesake (need a
different name). Either way the auto-suffixed name is wrong — downstream
tooling that derives identifiers from the repo name will produce slugs like
`node-template-1` that drift from anything the human registered ahead of
time. The prompt mandates explicit detection and a defaulted alternate name
before accepting any silent suffix.

## Fork slug vs node slug

`fork.slug` names the repo-level deployment substrate. It is used for
account-scoped VM aliases so sibling forks under one Cloudflare zone do not
collide. It is not a node slug. A multi-node repo still has one
repo/env-scoped VM alias such as `cogni-poly-candidate-a.vm.cognidao.org`,
while node-specific public URLs stay catalog-owned, such as
`poly-test.cognidao.org` or `resy-test.cognidao.org`.

## Safety: bootstrap refuses to run on the template

`bootstrap.sh` checks `git remote get-url origin` and exits non-zero if it
points at `Cogni-DAO/node-template` or `Cogni-DAO/cogni`. The bootstrap
mutates GitHub Actions secrets, environment configuration, and deploy
branches — running it inside the upstream template would either no-op
(no Admin role) or, with sufficient privilege, corrupt shared state.

## Open follow-up

The natural home for this prompt is `https://cognidao.org/setup/fork`
(the operator deployment), so a brand-new human doesn't have to read this
file before they can run it. The operator app lives in upstream
`Cogni-DAO/cogni`, not in this repo, so adding that route is a separate
upstream PR. Tracked in the PR description that lands this runbook.
