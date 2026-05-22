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

### Auth principle (binding for every git/gh action)

Your only authority is `$GH_TOKEN` (the bot PAT). Every command you run
must succeed using **just that token**. You operate **only** on resources
the bot owns.

- Before any git/gh action, verify the resource belongs to the bot.
  If `cwd` is already a git repo, `git remote get-url origin` must point
  to the bot's account. Wrong owner = **STOP**, not "reuse".
- On 403 / permission errors, the human has a setup gap. Surface it
  (one URL + one copy/paste line, per the comms contract). **Never**
  borrow other auth — keychain, browser, the human's shell, the human's
  `gh` session, nothing.
- A step the doc assigns to "the human" is the human's to do. Even if
  you could technically execute it via local creds, doing so collapses
  the contract this runbook exists to test.

### Steps

0. IDENTITY GATE — confirm you are the bot, not the human.
   - Run `gh api user --jq .login`. If the login is the human operator's
     account (not a dedicated bot), STOP and emit this template verbatim
     (substitute `<PWD>` with the output of `pwd`):

     ```
     🛑 I need my own GitHub identity to continue.
     Mint a PAT here (signed in as your bot account, NOT you): https://github.com/settings/tokens/new?scopes=repo,workflow,admin:org,admin:public_key,write:packages&description=cogni-fork-bootstrap
     Then in a new terminal: `cd <PWD> && GH_TOKEN=<paste-pat> claude` and repaste the one-sentence prompt.
     ```

   - Once `gh api user --jq .login` returns the bot, continue silently.

1. PREREQS — auto-install, do not ask. Tools: bash (4+), gh, pnpm, tofu, age, jq, yq.
   - **Bash 4+ is a hard prereq** — `bootstrap.sh` + `provision-env-vm.sh`
     use associative arrays and `mapfile` which macOS /bin/bash 3.2 does
     not support. Run this BEFORE anything else, and ensure the resulting
     bash takes precedence on PATH:
     bash scripts/bootstrap/install/install-bash.sh
   - The repo ships canonical installer wrappers — use them in preference
     to brew/apt:
     bash scripts/bootstrap/install/install-pnpm.sh
     bash scripts/bootstrap/install/install-tofu.sh
     bash scripts/bootstrap/install/install-yq.sh
     bash scripts/bootstrap/install/install-ripgrep.sh
     For tools without a wrapper (gh, age, jq, openssl, curl), use
     brew/apt on the appropriate platform.
   - `gh auth status` must show the bot from Step 0's `GH_TOKEN`. (Auth
     details are in the Auth principle above — don't deviate from them.)

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

5. infra/fork.yaml — one operator edit. The workflow path (Step 6 below)
   does not auto-populate `domain.root` from a runner — a runner-side
   `git commit + push` would either require ambient git identity (we
   don't grant) or attribute to a bot. Set it locally, commit, push.
   See Step 6.1 for the exact command. Usually leave `fork.slug` empty —
   the bootstrap derives it from the GitHub repo name.

   Public node URLs come from `domain.root` plus the catalog. VM aliases
   are repo/env-scoped: `<slug>-candidate-a.vm.<root>`, `<slug>-preview.vm.<root>`,
   `<slug>.vm.<root>`.

   The workflow's pre-flight refuses to run if `domain.root` is empty —
   no half-provisioned VMs on a typo'd config.

6. BOOTSTRAP — runs in a workflow, not on your laptop. The substrate +
   VM provisioning lives at [`.github/workflows/provision-env.yml`](../../.github/workflows/provision-env.yml).
   You ship 6 GH env secrets + a Cloudflare-zone line in `infra/fork.yaml`;
   the GHA runner handles the 30-min `tofu apply` + `bao init` + `kubectl`
   session that used to sit on your laptop. Init artifacts come back
   passphrase-encrypted.

   6.1 — populate `infra/fork.yaml::domain.root` once, commit + push:

   ```
   yq -i '.domain.root = "<your-cloudflare-zone-name>"' infra/fork.yaml
   git add infra/fork.yaml
   git commit -m "chore(bootstrap): set fork.yaml::domain.root"
   git push
   ```

   6.2 — create the target GH environment + set the 6 minting tokens:

   ```
   REPO=$(git remote get-url origin | sed -E 's#.*github.com[:/]([^/]+/[^/.]+).*#\1#')
   ENV=candidate-a
   gh api -X PUT repos/$REPO/environments/$ENV
   for k in CHERRY_AUTH_TOKEN CHERRY_PROJECT_ID CLOUDFLARE_API_TOKEN \
            CLOUDFLARE_ZONE_ID GITHUB_ADMIN_PAT GITHUB_ADMIN_USERNAME; do
     gh secret set "$k" --repo "$REPO" --env "$ENV"  # prompts; never echoes
   done
   ```

   Tokens are the same set the laptop `.env.bootstrap` used (see [`docs/spec/agentic-fork-bootstrap.md`](../spec/agentic-fork-bootstrap.md)
   §V1 Credential Floor). The GH-env-secrets path replaces `.env.bootstrap`
   entirely — your laptop never holds them.

   6.3 — generate an init-artifact passphrase (operator-owned, never
   stored in GH or in this repo):

   ```
   PP=$(openssl rand -hex 24)  # 48-char hex, ~192 bits
   echo "$PP"  # save to your password manager BEFORE running the workflow
   ```

   6.4 — dispatch the workflow:

   ```
   gh workflow run provision-env.yml --repo "$REPO" \
     -f env="$ENV" \
     -f encryption_passphrase="$PP"
   gh run watch --repo "$REPO" \
     $(gh run list --repo "$REPO" --workflow provision-env.yml --limit 1 --json databaseId --jq '.[0].databaseId') \
     --exit-status
   ```

   The workflow validates inputs (admin role, push permission, Cloudflare
   zone, Cherry token), generates agent secrets, provisions the Cherry VM,
   configures Cloudflare DNS, **installs the secrets substrate (OpenBao +
   External Secrets Operator), auto-unseals OpenBao (Shamir 1-of-1
   default), binds the writer-role**, seeds the per-service OpenBao
   paths, then dispatches `promote-and-deploy.yml`. The job FAILS BEFORE
   spending Cherry money if any pre-flight check fails. See
   [`docs/spec/secrets-management.md`](../spec/secrets-management.md).

   6.5 — download + decrypt the init artifacts. The workflow's summary
   prints the exact commands; the short version:

   ```
   gh run download --repo "$REPO" --name "$ENV-init-artifacts" --dir .local
   for f in .local/*.enc; do
     out="${f%.enc}"
     openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$f" -out "$out" \
       -pass pass:"$PP"
   done
   # Move .local/<env>-openbao-init.json + <env>-vm-key + <env>-kubeconfig.yaml
   # to your password manager. THEN delete the artifact from the run page
   # (retention is 1 day — safety net, not the contract).
   ```

   6.6 — substrate Invariant 13 NEVER-REMINDER. The bootstrap window is
   the bounded exception where the root token exists at all; day-2 writes
   use the writer-role JWT (Step 6.7), not the root token. The
   `<env>-openbao-init.json` you just downloaded is for unseal-key recovery
   on pod restart only.

   Multi-operator forks (Shamir 3-of-5) override `OPENBAO_KEY_SHARES=5`
   and `OPENBAO_KEY_THRESHOLD=3` at workflow trigger time (separate input
   to add when needed). v1 default is 1-of-1; v2 lands multi-operator
   key distribution as its own slice.

6.3-legacy LAPTOP BOOTSTRAP (deprecated, kept for emergencies).
`pnpm bootstrap` still works as a laptop fallback when the workflow
path is unavailable (GHA outage, debugging a runner-specific bug).
**Do not use for production paths** — the workflow is the contract.

6.7 APP SECRETS — enter values for the operator-pass-through keys that
the substrate doesn't auto-generate. **Prereq: kubeconfig from the
workflow artifact (Step 6.5), short-lived bao token via the writer
role (NEVER re-export the root token):**

```
# One-time per shell session — substitute <env>.
export KUBECONFIG=$PWD/.local/<env>-kubeconfig.yaml
kubectl port-forward -n openbao svc/openbao 8200:8200 &
export BAO_ADDR=http://127.0.0.1:8200
# OpenBao CLI 2.5.x does not implement `bao login -method=kubernetes`; use the
# raw API path which works across CLI versions.
export BAO_TOKEN=$(bao write -field=token auth/kubernetes/login \
  role=<env>-writer \
  jwt=$(kubectl create token openbao-operator -n default))

# Now write the keys:
pnpm secrets:set <env> node-template OPENROUTER_API_KEY     # mandatory
pnpm secrets:set <env> node-template GRAFANA_CLOUD_LOKI_API_KEY   # optional
pnpm secrets:set <env> node-template PROMETHEUS_REMOTE_WRITE_URL # optional
```

The workflow scorecard prints the full list. Without
`OPENROUTER_API_KEY` the node-template pod CrashLoops on the LLM
router call. The exact list of accepted services is
`ls infra/catalog/*.yaml`.

The CLI uses an interactive secure stdin (`read -s`); pipe input
also works (`echo -n "v" | pnpm secrets:set ...`). See
[`docs/guides/secrets-add-new.md`](../guides/secrets-add-new.md)
for the full add-new playbook.

7. DRIVE TO GREEN.
   - The script already watches CI via `gh run watch`. Let it run.
   - On transient failure (network, rate-limit, eventual-consistency),
     diagnose then retry the failing step yourself. Don't escalate.
   - On unrecoverable failure (auth rejected, quota exceeded, account
     suspended, Cherry billing block), STOP and report the specific
     failure + the one thing the human needs to do. Log it in
     `hardships.md` first.
   - If `/readyz` stays red, suspect a missing app secret first:
     `kubectl describe externalsecret -n cogni-<env> node-template-env-secrets`
     surfaces missing keys; re-run the relevant `pnpm secrets:set` and
     `kubectl rollout restart deployment/node-app`.

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
