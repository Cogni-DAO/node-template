---
id: fork-quickstart-runbook
type: runbook
title: Fork Quickstart — From Zero to Green Deploy
status: draft
summary: The copy/paste prompt a fresh human (or a fresh Claude Code session) needs to fork node-template and drive it to a green deploy. The minimum-floor companion to docs/spec/agentic-fork-bootstrap.md.
read_when: A new user wants their own node-template instance; an external agent is dropped in cold and needs the canonical zero-state instructions.
owner: derekg1729
created: 2026-05-17
tags: [onboarding, agent, bootstrap]
---

# Fork Quickstart

For a fresh human starting from zero, the path is:

1. Browser → click **Fork** on https://github.com/Cogni-DAO/node-template
2. Paste the prompt below into a fresh Claude Code session
3. When the editor opens, fill in the 5 sections of `.env.bootstrap` (each section has its mint URL inline)
4. Walk away

The bootstrap script (see [`scripts/setup/bootstrap.sh`](../../scripts/setup/bootstrap.sh))
provisions the Cherry VM, sets ~25 GitHub Actions secrets, configures Cloudflare
DNS, dispatches `promote-and-deploy.yml`, and reports the result.

Design rationale + invariants: [`docs/spec/agentic-fork-bootstrap.md`](../spec/agentic-fork-bootstrap.md).

## The Copy/Paste Prompt

Drop this into a fresh Claude Code session in whatever parent directory you want
the fork to land in:

```
Fork and provision github.com/Cogni-DAO/node-template end-to-end.

1. Verify these CLI tools are installed: gh, pnpm, tofu, age, ssh-keygen,
   openssl, curl, jq, git. Tell me how to install any that are missing
   and stop. Verify `gh auth status` succeeds.

2. Determine the target fork name:
     USER=$(gh api user --jq .login)
   If the user already has a fork of Cogni-DAO/node-template (check via
   `gh api repos/$USER/node-template` — exit 0 means it exists), reuse it.
   If the literal name `node-template` is taken under their account by an
   UNRELATED repo, prompt me for a fork name and use `gh repo fork
   Cogni-DAO/node-template --clone --remote --fork-name <chosen>`.
   Do NOT silently accept the gh CLI's auto-suffixed `-1`, `-2` names —
   downstream tooling derives identifiers from the repo name.

3. Otherwise fork + clone in one shot:
     gh repo fork Cogni-DAO/node-template --clone --remote
   Then `cd` into the cloned directory.

4. Install dependencies:
     pnpm install

5. First bootstrap pass — writes .env.bootstrap and opens it in my editor:
     pnpm bootstrap
   I will fill the 5 sections (Cherry, Cloudflare, GitHub Admin, OpenRouter,
   optional Grafana), save, and close the editor.

6. Second bootstrap pass — validates inputs, provisions the Cherry VM,
   sets ~25 GitHub Actions secrets, configures Cloudflare DNS, and
   dispatches promote-and-deploy.yml:
     pnpm bootstrap

7. Watch the CI run end-to-end. When `/readyz` returns 200, report a
   one-line scorecard: VM IP, domain, /readyz status, run URL.

Spec for context (in the cloned repo): docs/spec/agentic-fork-bootstrap.md
Bootstrap implementation:              scripts/setup/bootstrap.sh

Stop and ask if anything looks off. Don't proceed past the editor step until
.env.bootstrap has all 5 required sections filled.
```

## Why the fork-detection step is load-bearing

`gh repo fork <upstream> --clone --remote` silently appends `-1`, `-2`, …
when a same-named repo already exists under the caller's account. That repo
might be unrelated (a prior project the human named `node-template`) or it
might be a stale prior fork. Either way, the auto-suffixed name drifts from
any documented identifier — downstream tooling that derives the node slug
from the repo name will produce names like `node-template-1` that don't
match catalog entries, DNS records the human registered, or anything else
that was named ahead of time.

The prompt instructs the agent to:

- Check for an existing fork explicitly and reuse it if present
- Refuse the silent `-1` suffix and ask the human for a name instead

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
