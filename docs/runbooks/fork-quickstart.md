---
id: fork-quickstart-runbook
type: runbook
title: Fork Quickstart — From Zero to Green Deploy
status: draft
summary: The copy/paste prompt that hands a fresh AI agent autonomous control of a node-template fork provisioning. The human's role is bounded to clicking Fork, pasting the prompt, and filling 5 token values in an editor. Companion to docs/spec/agentic-fork-bootstrap.md.
read_when: A new user wants their own node-template instance; an external agent is dropped in cold and needs the canonical zero-state instructions.
owner: derekg1729
created: 2026-05-17
tags: [onboarding, agent, bootstrap]
---

# Fork Quickstart

## The asymmetry

| Who       | Does what                                                                                                                                                                                                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Human** | (1) Click Fork on github.com/Cogni-DAO/node-template. (2) Paste the prompt below into a fresh Claude Code session. (3) Fill 5 sections in `.env.bootstrap` when an editor pops up, save, close.                                                    |
| **Agent** | Everything else — install missing tools, clone, run bootstrap, set ~25 GitHub Actions secrets, provision the Cherry VM, configure Cloudflare DNS, dispatch the deploy, watch CI, verify `/readyz`. ~10 minutes wall-clock, no further human input. |

Bootstrap script: [`scripts/setup/bootstrap.sh`](../../scripts/setup/bootstrap.sh).
Design rationale + invariants: [`docs/spec/agentic-fork-bootstrap.md`](../spec/agentic-fork-bootstrap.md).

## The Copy/Paste Prompt

Drop this into a fresh Claude Code session in whatever parent directory you want
the fork to land in:

```
You are an autonomous fork-provisioning agent for Cogni node-template. Your
job is to take github.com/Cogni-DAO/node-template from zero to a green
deployment with one human checkpoint: filling 5 token values into an editor
when .env.bootstrap is opened for them. Before that moment and after it,
you drive — pick defaults, install missing tools, retry transient failures.
Report only when (a) /readyz returns 200, or (b) you hit a genuinely
unrecoverable blocker (auth rejected, quota exceeded, account suspended).

# Steps

1. PREREQS — auto-install, do not ask. Tools: gh, pnpm, tofu, age, jq, yq.
   - The repo ships canonical installer wrappers — use them in preference
     to brew/apt:
       bash scripts/bootstrap/install/install-pnpm.sh
       bash scripts/bootstrap/install/install-tofu.sh
       bash scripts/bootstrap/install/install-yq.sh
       bash scripts/bootstrap/install/install-ripgrep.sh
     For tools without a wrapper (gh, age, jq, openssl, curl), use
     brew/apt on the appropriate platform.
   - `gh auth status` must succeed; if not, attempt `gh auth login --web`
     and pause once for the human to complete browser auth — that's the
     only acceptable pre-bootstrap human checkpoint.

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

3. INSTALL: `pnpm install`

4. EDIT infra/fork.yaml — set domain.root to the Cloudflare zone the
   human owns (e.g. `opencompany.cc`). This is the SSOT for every URL
   downstream; no other file needs the zone name. Commit if you want,
   or leave uncommitted for the first canary.

5. BOOTSTRAP — the only secrets checkpoint.
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
     DNS, and dispatches promote-and-deploy.yml. Bootstrap fails BEFORE
     spending Cherry money if any pre-flight check fails.

6. DRIVE TO GREEN.
   - The script already watches CI via `gh run watch`. Let it run.
   - On transient failure (network, rate-limit, eventual-consistency),
     diagnose then retry the failing step yourself. Don't escalate.
   - On unrecoverable failure (auth rejected, quota exceeded, account
     suspended, Cherry billing block), STOP and report the specific
     failure + the one thing the human needs to do.

7. REPORT — when /readyz returns 200, post one line:
   `✓ <domain> /readyz=200 VM=<ip> run=<url>`

# Anti-patterns — do not do these

- Do NOT ask the human to install tools you can install. Use brew/apt.
- Do NOT ask the human to pick a fork name when a default works.
- Do NOT stop and ask if "something looks off" — investigate first.
- Do NOT proceed past .env.bootstrap with empty values; abort with a
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

# Reference (in the cloned repo)

Implementation: scripts/setup/bootstrap.sh
Spec:          docs/spec/agentic-fork-bootstrap.md
```

## Why the fork-detection step is load-bearing

`gh repo fork <upstream> --clone --remote` silently appends `-1`, `-2`, …
when a same-named repo already exists under the caller's account. That repo
might be a stale prior fork (reuse it) or an unrelated namesake (need a
different name). Either way the auto-suffixed name is wrong — downstream
tooling that derives identifiers from the repo name will produce slugs like
`node-template-1` that drift from anything the human registered ahead of
time. The prompt mandates explicit detection and a defaulted alternate name
before accepting any silent suffix.

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
