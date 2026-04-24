---
name: validate-candidate
description: Close the deploy_verified loop for a PR flighted to candidate-a. Review the PR, confirm the candidate-a build matches the PR head SHA, enumerate impacted surfaces (API routes, UI pages, graphs), exercise each against the real deployed URL using captured authed Playwright state + agent-api-validation patterns, query Loki for observability signals from the agent's own requests, then post an approve/fail scorecard + matrix as a PR comment. Use this skill whenever the user asks to "validate the candidate-a deploy", "prove this PR on candidate-a", "close the deploy_verified loop", runs "/validate-candidate" (with or without a PR number), or asks to manually E2E-test a flighted PR. Explicitly *don't* use for pre-merge CI checks or local dev testing — this skill runs after candidate-flight has already succeeded.
---

# /validate-candidate — Manual E2E Validation Skill

## What this skill is for

A PR gets merged and `candidate-flight` turns green. That proves it builds and deploys. It does **not** prove the feature works for a real user hitting the real URL. The only gate that proves that is someone actually driving the feature on the deployed build and reading their own request back out of Loki — the project's `deploy_verified` bar (see `CLAUDE.md` "Definition of Done").

This skill is the agent-run version of that loop. Manual predecessor to the qa-agent graph in `task.0309`.

## When you're invoked

Typical user prompts:

- `/validate-candidate` (use current branch's PR)
- `/validate-candidate 1038`
- "validate the candidate-a deploy for PR #1038"
- "close the deploy_verified loop on PR 1038"

If no PR number, resolve it with `gh pr view --json number,headRefName -q .number`. If that fails (not on a branch with a PR), stop and ask.

**Dry-run mode:** if the env var `VALIDATE_CANDIDATE_DRY_RUN=1` is set, OR the user explicitly says "dry run" / "don't post a comment", do everything through scorecard assembly but **print the markdown to stdout instead of calling `gh pr comment`**. Useful for eval runs and for the user sanity-checking the skill before letting it post. Always state clearly in the final output whether the PR was commented on.

## Prerequisites — check these up front, halt on failure

1. **Captured auth state exists for the impacted env.** Check `.cogni/auth/<slug>.storageState.json`. The filename slug convention is `candidate-a-<node>` (e.g., `candidate-a-poly`, `candidate-a-operator`). If the file for the impacted node is missing, halt and tell the user to run the candidate-auth bootstrap (`docs/guides/candidate-auth-bootstrap.md`) for that node first. Never try to re-auth — interactive signin is out of scope for this skill.

2. **`gh` CLI authed.** `gh auth status` should be green. Stop if not.

3. **Grafana MCP available.** This skill needs Loki query access to close the observability loop. If `mcp__grafana__*` tools aren't present, note it as a known gap in the final report rather than halting — you can still do the exercise step.

## The flow

### Step 1 — Load PR context

```bash
gh pr view <N> --json number,title,headRefOid,headRefName,body,files,state,statusCheckRollup
```

Capture: head SHA, changed file list, branch name, check rollup.

### Step 2 — Confirm flight state

From the check rollup, find `candidate-flight`. It must be `SUCCESS` for the PR head SHA. If it's `IN_PROGRESS` / `PENDING` / missing / `FAILURE`, **halt and report** — don't wait/poll, don't retry. The user's signal: "flight isn't green yet, re-invoke me when it is."

### Step 3 — Impact analysis: classify changed files

Group the changed files into (node, surface type). Heuristics:

| Path glob                                                | Node      | Surface type |
| -------------------------------------------------------- | --------- | ------------ |
| `nodes/<node>/app/src/app/api/**/route.ts`               | `<node>`  | `api-route`  |
| `nodes/<node>/app/src/app/**/page.tsx`, `view.tsx`, etc. | `<node>`  | `ui-page`    |
| `packages/langgraph-graphs/src/graphs/**`                | operator  | `graph`      |
| `apps/operator/src/app/api/**/route.ts`                  | operator  | `api-route`  |
| `apps/operator/src/app/**/page.tsx`                      | operator  | `ui-page`    |
| `infra/**`, `.github/workflows/**`                       | —         | `infra`      |
| `docs/**`, `work/**`, `*.md`                             | —         | `docs`       |
| `scripts/**`, `.claude/**`, root configs                 | —         | `tooling`    |
| everything else                                          | —         | `other`      |

Build an **impact matrix** — one row per distinct (surface type × concrete target). For a UI page, the row target is the route (`/credits`, `/profile`). For an API route, the target is the method + path. For a graph, it's the graph name.

### The two axes: Human and Agent

Every *behavioral* feature (not a purely internal refactor) lives on two axes at once, and the skill must try both:

- **Human axis** — a person drives the feature through the UI with Playwright + captured storageState. "Does clicking through the product actually do the thing?"
- **Agent axis** — an agent or API client calls the underlying route/tool/graph directly. "Does the capability exist at all on the deployed build?"

The two can disagree, and the disagreement is often the most useful finding:

| Agent axis | Human axis | What it means                                                                                                             |
| ---------- | ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| 🟢 pass    | 🟢 pass    | Feature actually works end-to-end. Rarest, most valuable signal.                                                          |
| 🟢 pass    | 🔴 fail    | **Drift surfaced.** Backend shipped, UI didn't. Graph exists but no chat entry point, tool registered but no settings toggle, etc. This is a real bug — flag prominently. |
| 🔴 fail    | 🟢 pass    | UI is lying — fake success states, stale cache, or the click routes somewhere else. Higher severity than agent-only fail. |
| 🔴 fail    | 🔴 fail    | Deploy is broken. Halt-worthy.                                                                                            |
| 🟢 pass    | n/a        | Backend-only change with no UI surface. Expected for many PRs.                                                            |
| n/a        | 🟢 pass    | UI-only change (copy, styling). Expected for frontend PRs.                                                                |

Every row in the matrix therefore carries **two verdict cells** (Human · Agent) — not one — plus a separate observability cell per axis. The final `## Impact matrix` table always shows both columns.

Node → candidate-a URL map:

- `operator` → `https://test.cognidao.org`
- `poly` → `https://poly-test.cognidao.org`
- `resy` → `https://resy-test.cognidao.org`

### Step 4 — Confirm buildSha matches PR head

For each *unique* node in the impact matrix, curl `<node-url>/version`:

```bash
curl -sf https://poly-test.cognidao.org/version | jq .buildSha
```

Compare to the PR head SHA from step 1 (prefix match — `/version.buildSha` is usually full SHA, PR head is too; accept either equal or one being a prefix of the other). If mismatch, halt and report — candidate-a is serving a different build than the PR you're validating. The user needs to re-flight or wait.

### Step 5 — Exercise each matrix row on both axes

For each row, try **both** the agent axis and the human axis. Skip an axis only when it genuinely doesn't apply (record as `n/a` with reason).

#### Agent axis strategies

- **`api-route`** — prefer the agent-api-validation flow from `docs/guides/agent-api-validation.md` (API key / service token). If the endpoint requires a user session, fall through to using the captured storageState cookies with `fetch` / `curl` (extract the session cookie from `.cogni/auth/<slug>.storageState.json` and pass as `Cookie:` header).
- **`graph`** — POST to the node's chat endpoint (e.g. `POST https://poly-test.cognidao.org/api/v1/ai/chat`) with a prompt that selects the graph, specifying `graph: "<graph-name>"` in the request body if the schema supports it. Capture the response: did the graph execute, did it return the expected shape, did any tool calls fire?
- **tool registration** — hit the graphs/tools discovery endpoint (`GET /api/v1/ai/graphs` or equivalent) and assert the new graph/tool name is present.

#### Human axis strategies

- **`ui-page`** — use Playwright with captured storageState. Pattern lives in `scripts/dev/smoke-authed-state.mjs` — copy it, adapt the target URL + click sequence. Inline Playwright is fine; no committed test file needed for a one-off.
- **`graph` or `tool` behind the UI** — this is the subtle part. Even if the PR only touched backend code, a graph is typically invoked by a user picking it in the chat UI. Launch Playwright, open the chat page, and look for a graph selector / dropdown / command that exposes the new graph. If it's not there, the human-axis row is 🔴 fail with note "graph `<name>` exists backend-side but is not exposed in the chat UI" — that's exactly the drift the matrix exists to surface.

Playwright skeleton:

```js
import { chromium } from "@playwright/test";
import { join } from "node:path";
const storageState = join(process.cwd(), ".cogni/auth/candidate-a-<node>.storageState.json");
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState });
const page = await ctx.newPage();
const apiCalls = [];
page.on("response", async r => {
  if (r.url().includes("/api/v1/")) apiCalls.push({ method: r.request().method(), url: r.url(), status: r.status() });
});
await page.goto("<candidate-a-url>/<route>");
// exercise: click the element that would invoke the changed feature
// assert on visible outcome AND on apiCalls[] containing the expected downstream call
```

#### When to skip an axis

- **agent-axis n/a:** frontend-only change (CSS, copy, layout) with no backend contract change. Human-axis is the only meaningful check.
- **human-axis n/a:** backend-only change with no intended UI surface (internal scheduler, cron-like tool, infra). Mark it, don't invent a fake click path.
- **both n/a:** `docs`, `tooling`, `infra`-only. Entire row is n/a with short reason.

**Record for each exercised axis:** timestamp the exercise started (UTC ISO), observed HTTP responses or visible assertion, pass/fail verdict.

**For any axis you truly can't figure out how to exercise** — mark `skipped` with the reason rather than halting, and ding the final verdict toward 🟡.

### Step 6 — Observability: read your own request back

For each `pass`/`fail` exercise row, query Loki at the deployed SHA for evidence of your own call. Time window: `start = exercise_start - 10s`, `end = now + 10s`.

Query patterns (use `mcp__grafana__query_loki_logs` or the equivalent):

```
{namespace="cogni-candidate-a"} | json | buildSha="<pr-head-sha-prefix>"
```

Then narrow with feature-specific filters:

- API route touched: `| path="<route>"` or `| msg=~".*<route-slug>.*"`
- UI interaction: find the downstream API log the click triggered
- Graph run: `| graph="<graph-name>"` or `| msg=~".*graph.*"`

Record for each row:

- 🟢 `saw_own_request=true` — found ≥1 log line in window at deployed SHA matching the feature filter
- 🟡 `saw_own_request=partial` — found SHA-tagged traffic in window but couldn't prove it's specifically yours
- 🔴 `saw_own_request=false` — no matching log lines

If Grafana MCP isn't available, mark all observability cells `no_mcp` and note the gap in the final report.

### Step 7 — Post the scorecard

Build the markdown below and post it as a PR comment via `gh pr comment <N> --body-file <tempfile>`.

```markdown
## /validate-candidate — PR #<N>

**Head SHA:** `<sha-short>` · **Flight:** 🟢 success · **Build verified on candidate-a:** 🟢 matches (`<node>.cognidao.org/version.buildSha = <sha-short>`)

**Verdict:** <🟢 approve | 🟡 approve-with-notes | 🔴 fail>

<one-paragraph summary of what was proven and what wasn't>

### Impact matrix

Every non-n/a row has two axes (Human and Agent). Both verdicts shown; disagreement is a finding, not an error.

| # | Node | Surface | Target | Human (Playwright) | Agent (API) | Observability |
|---|------|---------|--------|--------------------|-------------|---------------|
| 1 | poly | ui-page | `/credits` | 🟢 clicked "Create trading wallet" → consent → confirmed; UI showed new `0xa6c3…0B58` | 🟢 POST `/api/v1/poly/wallet/connect` → 200 `{connection_id, funder_address}` | 🟢 own request at SHA `<sha>` (`msg="poly.wallet.connect"`) |
| 2 | poly | graph    | `poly-research` | 🔴 graph exists backend-side but not exposed in chat UI — no selector/command found | 🟢 POST `/api/v1/ai/chat` with `graph:"poly-research"` → 200, tool-calls fired | 🟡 agent call visible, UI-side traffic absent (expected given 🔴 human axis) |
| 3 | … | … | … | … | … | … |

### Notes / known gaps

- <e.g., Reown origin allowlist 403 observed — pre-existing, unrelated to this PR, tracked in bug.0368>
- <e.g., Grafana MCP not available in this session; observability column estimated from HTTP responses>

### Out of scope

- <files this skill couldn't exercise and why: docs, infra, internal refactors with no behavior change, etc.>

---
_Generated by /validate-candidate. Not a replacement for human review; this proves the deployed build answers requests — not that the behavior is correct._
```

## Verdict rules

Aggregate across matrix rows. A row's axes combine like this:

- Both axes 🟢 → row is 🟢
- One axis 🟢, other 🔴 → row is 🔴 (the disagreement *is* the finding)
- One axis 🟢, other n/a → row is 🟢
- Any axis 🔴 with a `drift` note → row is 🔴 but labeled drift (backend-vs-UI mismatch, not a build break)
- Skipped axis (couldn't figure out how to exercise) → row is 🟡

Overall verdict:

- 🟢 **approve** — every non-n/a row is 🟢 *and* every exercised axis has 🟢 observability. Rarest outcome. Means every axis of every impacted surface was driven end-to-end and its request was found in Loki at the deployed SHA.
- 🟡 **approve-with-notes** — all exercises pass but something's soft: observability partial/missing, an axis skipped, captured auth missing for a secondary surface, etc. Document what's unproven.
- 🔴 **fail** — any row 🔴 from actual exercise failure (non-2xx, broken click path, visible error), OR deployed buildSha mismatch, OR flight not green. **Drift-class 🔴** (backend ships without UI) is still 🔴 — call it out prominently in the summary paragraph so reviewers can decide whether to merge anyway or wait for the UI surface.

Err on the side of 🟡 when in doubt. Don't give 🟢 to something you couldn't actually observe.

## What this skill deliberately does *not* do

- **No work-item frontmatter edits.** `deploy_verified: true` on the work item is noise — the PR comment is the signal. (Explicit user feedback.)
- **No screenshot upload** (vNext — tracked as a follow-up).
- **No retrying** a failed flight or stale build. Report and stop; the user decides whether to re-flight.
- **No interactive auth.** Captured storageState only. If it's missing, halt with a pointer to the bootstrap guide.
- **No synthesizing data** for observability. If you didn't see it in Loki, say so — don't guess.

## Cost discipline

UI page exercise runs are cheap (headless Chromium, single pageview). API route exercises are single HTTP calls. Loki queries should be scoped by `namespace` and SHA to avoid full-volume scans. If a row's exercise needs more than ~30s of automation, you're probably over-engineering — simplify to the minimum click sequence that would fail if the PR were broken.

## If you get stuck

- Can't figure out what surface a file belongs to → mark it `other` / skipped with reason, move on.
- Playwright doesn't find the expected element → capture the page's visible text + button list, include in notes, mark the row 🟡.
- API returns 5xx → that's a 🔴 fail for the row; include the response body (truncated) in the exercise cell.
- Captured storageState rejected (redirects to signin) → cookie expired. Halt the UI exercises for that node, note the refresh need, continue with API-only rows if feasible.

## Key repo pointers

- `docs/guides/candidate-auth-bootstrap.md` — how the storageState files get created (prereq)
- `docs/guides/agent-api-validation.md` — API-flow reference
- `scripts/dev/smoke-authed-state.mjs` — template for authed Playwright runs
- `.cogni/auth/*.storageState.json` — the captured sessions (gitignored)
- `work/items/task.0309.qa-agent-e2e-validation.md` — the graph-agent successor
- `work/projects/proj.cicd-services-gitops.md` (E2E Success Milestone section) — the bar this skill works toward
