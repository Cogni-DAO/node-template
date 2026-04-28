---
id: task.0409
type: task
title: "Multi-tenant git-review routing — operator selects target repo (test vs prod) via per-tenant GitHub App"
status: needs_implement
priority: 0
rank: 1
estimate: 5
branch: feat/task-0409-multi-tenant-git-review-routing
summary: "Operator review pipeline currently has a single GitHub App identity and a single `GH_REPOS` allowlist. To run `pnpm test:external` safely, the operator must support a tenant model: at least two distinct GitHub Apps (one prod, one test) each scoped to its own repo set, routed deterministically per webhook delivery so a production App never reviews a test-repo PR and a test App never touches production. Unblocks the post-#1067 test:external flow + sets up the test-environment Cogni-DAO/test-repo as a permanent fixture rather than a default-drifted afterthought."
outcome: "(1) Operator boots with N tenant configurations (e.g. `prod`, `test`), each carrying its own `GH_REVIEW_APP_ID`, private key, webhook secret, and `GH_REPOS` allowlist. (2) Webhook handler picks the tenant by validating the webhook signature against each tenant's secret in turn — only the matching tenant's App responds. (3) `dispatch.server.ts` and downstream Temporal workflow inputs carry a `tenantId` field; activities resolve App creds + Octokit per-tenant. (4) `pnpm test:external` (operator + others) targets `Cogni-DAO/test-repo` via the `test` tenant — no env-default drift between code (`derekg1729/test-repo`) and AGENTS.md (`Cogni-DAO/test-repo`). (5) `test.cognidao.org` agent (test-environment operator deploy) accepts an authed agentic-API DM, picks a real PR on `Cogni-DAO/test-repo`, and selectively flights it via `vcs/flight`. That round-trip is the first deploy_verified for this work."
spec_refs:
  - vcs-integration
  - github-app-webhook-setup
assignees: derekg1729
credit:
project: proj.vcs-integration
pr:
reviewer:
revision: 2
blocked_by: []
deploy_verified: false
created: 2026-04-28
updated: 2026-04-28
labels: [vcs, multi-tenant, github-app, review, test-infra, operator]
external_refs:
  - work/items/task.0403.reviewer-per-node-routing.md
  - work/items/task.0407.review-modelref-from-repo-spec.md
  - work/items/task.0408.split-temporal-workflows-per-node.md
  - docs/guides/github-app-webhook-setup.md
  - docs/guides/agent-api-validation.md
---

## Problem

Today the operator's review pipeline knows one GitHub App. `.env.local` carries a single `GH_REVIEW_APP_ID` + `GH_WEBHOOK_SECRET` + `GH_REPOS`. The webhook handler trusts that secret, the activity reads that App ID, the dispatcher uses that installation. There is no notion of "this delivery belongs to the test tenant." Concrete consequences right now:

- `pnpm test:external` cannot be run safely against the production App, because the operator's prod webhook would receive PR events for any test-repo activity.
- The `single-node-scope-e2e.external.test.ts` test added by PR #1067 default-targets **`Cogni-DAO/node-template`** (production). User policy is "test-repo only." So that suite is currently un-runnable as-shipped.
- The reviewer e2e (`pr-review-e2e.external.test.ts`) has the same drift pattern: code default `derekg1729/test-repo`, AGENTS.md canonical `Cogni-DAO/test-repo` — neither is wired through a separate App identity, so the safety story is "trust the env override and don't share credentials."
- There is no path for a deployed `test.cognidao.org` operator instance to coexist with the production operator on the same source code without risk of cross-routing.

## Symptoms / blocking impact

- 🔴 `pnpm test:external` post-#1067 is blocked. Test default points at production repo; flipping it to test-repo without separate App identity is just hiding the routing problem.
- 🔴 `Cogni-DAO/test-repo` exists but has no fixture App installed — the bootstrap PR #920 currently exercises the dev App by way of `derekg1729/test-repo`. Test-repo cannot become canonical until there's a tenant-routed App for it.
- 🔴 No agentic-API validation flow exists for "DM the test agent → it flights a real test-repo PR." Required as the deploy_verified gate for this entire VCS-integration project.

## Design questions to resolve

1. **Tenant identification.** Each GitHub App webhook delivery carries an `X-Hub-Signature-256` HMAC over the body. Validate against each tenant's secret in turn — first match wins. No header parsing tricks, no path-based routing. This is the standard multi-tenant pattern for GitHub Apps and matches what the `octokit/webhooks` library already supports natively.
2. **Tenant config shape.** Either `.env.local` lists `GH_TENANTS=prod,test` and per-tenant prefixed vars (`GH_REVIEW_APP_ID_PROD`, `GH_REVIEW_APP_ID_TEST`, …), OR a JSON blob `GH_TENANTS_CONFIG=[{...},{...}]`. Recommend the first — env files are the source of truth for secrets in this stack and a flat shape keeps scripts (`gh secret set`) ergonomic.
3. **Workflow input plumbing.** Add `tenantId: string` to `PrReviewWorkflowInput` (and downstream child workflow inputs). `dispatch.server.ts` reads tenant from the matched webhook context and passes it through. Activities resolve App creds via `getAppCredsForTenant(tenantId)` instead of reading global env. `workflowId` keying gains tenant prefix so test + prod can each have a `pr-review:tenant=test:owner/repo/123/sha` without collision.
4. **Allowlist enforcement per tenant.** Each tenant has its own `GH_REPOS` list. The webhook router rejects (logs + drops) any delivery whose payload `repository.full_name` is not in the matched tenant's list — defense in depth in case a webhook secret leaks.
5. **Test-environment deploy.** `test.cognidao.org` is its own operator pod (separate from prod `cognidao.org`) with the `test` tenant config baked in. Both pods can coexist on candidate-a/preview/prod surfaces. Per-tenant Loki labels for forensics.
6. **`Cogni-DAO/test-repo` migration.** Reconcile the AGENTS.md vs code-default drift: pick `Cogni-DAO/test-repo` as canonical, install the test-tenant App on it, port the existing PR #920 scaffolding bootstrap commit, retire `derekg1729/test-repo` defaults from external test code in the same PR.
7. **Agentic-API validation flow.** `test.cognidao.org` exposes `/api/v1/ai/chat` (existing). Authenticate via API key (existing flow per `docs/guides/agent-api-validation.md`), DM the agent: "flight PR #X on Cogni-DAO/test-repo." Agent uses `core__vcs_flight_candidate` against the test tenant's installation, returns the flight URL. This is the deploy_verified gate.

## Out of scope

- Per-node Temporal workflow split (task.0408) — adjacent architectural concern, can land independently.
- Per-rule modelRef in repo-spec (task.0407) — orthogonal.
- Reviewer per-node routing (task.0403) — already in flight; this task does not change the routing semantics, only the tenant identity used to authenticate the GitHub App calls.
- Per-user / BYO-AI tenants — different problem space (this task is system-actor multi-tenancy only).
- Migrating prod review traffic — prod stays single-tenant for now; test tenant is added alongside.

## Files likely to touch

- `nodes/operator/app/src/app/api/internal/webhooks/github/route.ts` — multi-secret HMAC validation
- `nodes/operator/app/src/bootstrap/github-app/` — per-tenant App-creds resolver
- `nodes/operator/app/src/app/_facades/review/dispatch.server.ts` — tenant in workflow input
- `packages/temporal-workflows/src/workflows/pr-review.workflow.ts` — `tenantId` in input + workflowId key (lands on whatever shape PR #1098 leaves)
- `packages/temporal-workflows/src/activity-types.ts` — activity input gains `tenantId`
- `services/scheduler-worker/src/activities/review.ts` — Octokit per-tenant
- `services/scheduler-worker/src/bootstrap/env.ts` — tenant config schema
- `nodes/operator/app/tests/external/**/*.external.test.ts` — switch to `Cogni-DAO/test-repo` via test tenant; retire `derekg1729/test-repo` default
- `docs/guides/github-app-webhook-setup.md` — add multi-tenant section
- `docs/guides/agent-api-validation.md` — add the test-tenant flight DM recipe
- New: a Cogni-DAO/test-repo bootstrap doc (port from PR #920 history)

## Validation

- **exercise:** (1) Configure two tenants in `.env.local` — `prod` against `derekg1729/test-repo` (legacy, kept as parity), `test` against `Cogni-DAO/test-repo` (new). (2) Push a PR to `Cogni-DAO/test-repo` — the test-tenant App posts a review, prod-tenant stays silent. Push a PR to `derekg1729/test-repo` — prod-tenant App posts, test stays silent. (3) Deploy `test.cognidao.org` carrying only the `test` tenant; from a separate authed shell, DM `/api/v1/ai/chat` on `test.cognidao.org` with "flight PR #X on Cogni-DAO/test-repo" — the agent calls `core__vcs_flight_candidate` and returns the flight workflow URL. (4) `pnpm test:external:operator` from a clean checkout points at `Cogni-DAO/test-repo` with no env override.
- **observability:** `scripts/loki-query.sh '{namespace="cogni-test"} | json | component="webhook-route"' 10 50 | jq '.data.result[].values[][1] | fromjson | {tenantId, eventType, repository}'` — every entry must have `tenantId="test"` and a repository in the test tenant's allowlist. Cross-tenant leak = any line on `cogni-test` namespace with `tenantId="prod"` or a non-allowlisted repository → fail.

## Pointers

- [`docs/guides/github-app-webhook-setup.md`](../../docs/guides/github-app-webhook-setup.md) — single-tenant setup; this task generalizes it
- [`docs/guides/agent-api-validation.md`](../../docs/guides/agent-api-validation.md) — discover → register → auth → execute flow this task validates against
- [PR #920 (derekg1729/test-repo)](https://github.com/derekg1729/test-repo/pull/920) — bootstrap scaffolding to port to Cogni-DAO/test-repo
- [task.0403](task.0403.reviewer-per-node-routing.md) — concurrent reviewer-side routing work; this task is the auth/tenancy layer beneath it
- [task.0408](task.0408.split-temporal-workflows-per-node.md) — adjacent packaging concern; orthogonal

## Design — MVP

### Outcome

`pnpm test:external` runs safely against `Cogni-DAO/test-repo`, exercising a real review pipeline through a **separate** `cogni-review-test` GitHub App. The production GitHub App (`cogni-review-production`) is **not installed** on the test repo, so production operator never sees the delivery in the first place. No code-level multi-tenant routing — just two App identities and two operator deployments running the same single-tenant binary.

### Key insight (correction from the original framing)

The work item title says "multi-tenant routing." The original 6-PR design built that as **in-binary multi-tenancy** (one operator pod handling both prod + test webhooks, picking tenant via try-each-secret). That is over-built for our actual blocker.

The actual blocker: **prevent the production App from reviewing test-repo PRs.** GitHub Apps already give us this for free — an App only receives webhooks for repos it's installed on. If the production App is never installed on `Cogni-DAO/test-repo`, production never sees its events. The test App is installed only on test-repo. Each operator deployment loads exactly one App's creds. The "tenancy boundary" is **operational** (separate deploys + separate App installations), not in code.

This is the same pattern `docs/guides/github-app-webhook-setup.md:19-23` already documents (one App per environment, distinct webhook URL per App). The work item was reaching for a code-side abstraction that the existing GitHub-App-per-environment pattern already covers.

### Approach

**Solution.** Three concrete moves, all small:

1. **Defense-in-depth allowlist check at the webhook route.** Today the operator dispatches review on any `pull_request` event whose signature verifies against `GH_WEBHOOK_SECRET`. If the App somehow ends up installed on a repo not in `GH_REPOS` (misconfig, intentional addition by repo admin, secret leak, etc.), we silently review the wrong repo. Add a 5-line check: `if (!GH_REPOS.includes(payload.repository.full_name)) { log+drop }`. ~10 lines + 1 test.
2. **Bootstrap `Cogni-DAO/test-repo`.** Port the multi-node directory scaffolding from PR #920 (`derekg1729/test-repo`) to `Cogni-DAO/test-repo`. Install the new `cogni-review-test` GitHub App on it. Update `nodes/operator/app/tests/external/AGENTS.md` to declare `Cogni-DAO/test-repo` canonical (it already does — code defaults are the drift). Flip `E2E_GITHUB_REPO` default in the four `.external.test.ts` files. Retire `derekg1729/test-repo` from code defaults.
3. **Document the dual-deploy pattern.** Update `docs/guides/github-app-webhook-setup.md` to make it explicit: prod operator (`cognidao.org`) runs with `cogni-review-production` App + `GH_REPOS=Cogni-DAO/node-template`. Test operator (`test.cognidao.org`) runs with `cogni-review-test` App + `GH_REPOS=Cogni-DAO/test-repo`. Local `pnpm dev:stack:test` reads `.env.test` which carries the test App creds. **The same single-tenant operator binary serves both deploys** — only env differs.

That's the MVP. No tenant-id workflow plumbing. No `loadTenants` helper. No try-each-secret webhook handler. No new packages.

**Reuses.**

- Existing single-App env shape (`GH_REVIEW_APP_ID`, `GH_REVIEW_APP_PRIVATE_KEY_BASE64`, `GH_WEBHOOK_SECRET`, `GH_REPOS`) — unchanged.
- Existing `pnpm dev:stack:test` infrastructure that already loads `.env.test`.
- Existing GitHub-App-per-environment guide (`docs/guides/github-app-webhook-setup.md`) — extend, don't replace.
- Existing operator deploy charts (preview, production) — copy to spawn `test.cognidao.org` (ops work, no code change).

**Rejected.**

- **In-binary multi-tenant routing** (original 6-PR plan: try-each-secret HMAC, `tenantId` in workflow input, `loadTenants` helper, worker-side tenant map). Premature. We don't have a use-case for one operator pod handling two GitHub Apps simultaneously. **The day we ship Cogni as a SaaS that reviews 100 customer forks from one pod, that's when we build it.** Until then, separate deploys are simpler, more secure (no shared creds in one pod), and require zero new code. Filed as task.0411 (out-of-scope here, future).
- **Try-each-secret on a single deployment.** Same problem at smaller scale. If both prod and test creds are loaded in one pod's env, a misconfig that crosses them silently is exactly the failure mode we want to make impossible. Two pods with non-overlapping env eliminates the failure mode entirely.
- **Path-based routing** (`/webhooks/github/test`). Same answer — the per-deploy approach removes the need.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] **WEBHOOK_REPO_ALLOWLIST_ENFORCED**: `dispatchPrReview` (NOT the generic `[source]` webhook route) checks `payload.repository.full_name` against `env.GH_REPOS.split(",")` before queueing the workflow. Mismatch → log warn + return without dispatching. Domain-specific check stays in the domain-specific facade, not the generic transport.
- [ ] **ACTIVITY_LAYER_ALLOWLIST_ENFORCED**: `fetchPrContextActivity` re-checks `${owner}/${repo}` against the activity-deps allowlist before the first GitHub call. `ApplicationFailure.nonRetryable` on mismatch. Defense-in-depth: closes any residual gap in case of cross-pickup or input tampering.
- [ ] **TEMPORAL_QUEUE_ISOLATION**: Test deploy and prod deploy connect to **distinct Temporal namespaces** via env (`TEMPORAL_NAMESPACE=cogni-test` vs `cogni-production`). Already env-driven (`services/scheduler-worker/src/bootstrap/env.ts:32` + `nodes/operator/app/src/bootstrap/container.ts:322`). Eliminates queue/state cross-pickup risk between deploys. **THIS IS THE ANSWER TO REVIEW BLOCKING ISSUE B1.**
- [ ] **NO_TENANT_PLUMBING_IN_CODE_PATH**: PR-review pipeline has no `tenantId` field, no try-each-secret loop, no in-binary tenant map. Tenancy is achieved via separate deployments + separate GH Apps + separate `GH_REPOS` allowlists + separate Temporal namespaces. (spec: SIMPLE_SOLUTION)
- [ ] **TEST_REPO_CANONICAL**: `Cogni-DAO/test-repo` is the canonical default in all `.external.test.ts` `E2E_GITHUB_REPO` references and in `nodes/operator/app/tests/external/AGENTS.md`. `derekg1729/test-repo` is fully retired from code defaults in this PR. The repo itself is **archived** (read-only, kept for git history) in this PR's ops checklist; not deleted.
- [ ] **PROD_APP_NOT_INSTALLED_ON_TEST_REPO**: The production `cogni-review-production` GitHub App is never installed on `Cogni-DAO/test-repo`. Documented + tracked as a manual checklist on the deploy runbook + audited at boot via task.0412.
- [ ] **TEST_APP_NOT_INSTALLED_ON_PROD_REPO**: Symmetric — `cogni-review-test` App is never installed on `Cogni-DAO/node-template`.
- [ ] **SIMPLE_SOLUTION**: No new dependencies; ~25 lines of code change in MVP (10 in dispatch, 3 in activity, the rest in tests + the new allowlist check). (spec: SIMPLICITY_WINS)
- [ ] **ARCHITECTURE_ALIGNMENT**: Tenancy boundary is operational, not in code. Single-tenant binary, parameterized by env. (spec: architecture)

### Files

**Modify** (this PR):

- `nodes/operator/app/src/app/_facades/review/dispatch.server.ts` — before `startPrReviewWorkflow(...)`, check `${repoOwner}/${repoName}` is in `env.GH_REPOS.split(",")`. Mismatch → `log.warn` + return. ~5 lines. (Per review C1: domain-specific check in domain facade, NOT the generic `[source]` route.)
- `services/scheduler-worker/src/activities/review.ts` — at the top of `fetchPrContextActivity`, re-check `${input.owner}/${input.repo}` against `deps.allowlist`. `ApplicationFailure.nonRetryable` on miss. ~3 lines + 1 new dep field on `ReviewActivityDeps`. (Per review C2: defense-in-depth.)
- `services/scheduler-worker/src/worker.ts` — pass `allowlist: env.GH_REPOS?.split(",") ?? []` into `createReviewActivities(...)`.
- `nodes/operator/app/tests/external/review/pr-review-e2e.external.test.ts` (and the 3 sibling per-node copies) — flip `E2E_GITHUB_REPO` default to `Cogni-DAO/test-repo`. Suite skips unless test-tenant App creds available.
- `nodes/operator/app/tests/external/AGENTS.md` — reconcile any remaining drift toward `Cogni-DAO/test-repo`.
- `docs/guides/github-app-webhook-setup.md` — add a worked-example "Test environment (dual-deploy)" section showing the `test.cognidao.org` deploy + `cogni-review-test` App + `.env.test` triad + distinct `TEMPORAL_NAMESPACE`. Make explicit: **never install both Apps on the same repo**.
- `tests/unit/nodes/operator/app/_facades/review-dispatch-allowlist.test.ts` (NEW) — payload with un-allowlisted repo → no `workflowClient.start` call.
- `tests/unit/services/scheduler-worker/activities/review-allowlist.test.ts` (NEW) — `fetchPrContextActivity` with un-allowlisted repo → throws `nonRetryable`.

**New (separate bootstrap PR on `Cogni-DAO/test-repo`)**:

- Multi-node directory scaffolding ported from PR #920.
- `.github/workflows/ci.yaml` matching `Cogni-DAO/node-template`'s gate set (per review C7: explicit parity with parent so the test fixture exercises the real CI surface; deviations require a documented rationale).

**Operational (no code, document in this PR's body + the deploy runbook)**:

- Create `cogni-review-test` GitHub App in the Cogni-DAO org.
- Install on `Cogni-DAO/test-repo` only.
- Set `TEMPORAL_NAMESPACE=cogni-test` in test deploy env.
- Capture creds + provision into `test.cognidao.org`'s deploy secrets and into the local `.env.test`.
- **Archive `derekg1729/test-repo`** (read-only, kept for git history of PR #920) once external test code defaults flip and one green `pnpm test:external:operator` run is recorded against `Cogni-DAO/test-repo`. (Per review C6.)

### Top-priority follow-ups (same project: proj.vcs-integration)

Filed as separate work items so this MVP stays small. **In priority order, with ordering constraints**:

1. **task.0410 — `PrReviewWorkflowInputSchema` Zod contract.** Filed at `needs_implement`. **Lands BEFORE this MVP** (per review feedback: every PR touching `PrReviewWorkflowInput` between now and 0410 risks repeating the modelRef-shape regression). Coordinates with task.0408 (split temporal-workflows per-node) — whichever lands first, the other rebases the schema location. ~150 LOC standalone.
2. **task.0412 — Tenant config audit + Loki signal + cross-leak alert.** Filed at `needs_design`. Boot-time preflight that hits each App's `/installations` endpoint and asserts the App is installed only on its expected `GH_REPOS` set; logs `tenant.config_audit` to Loki; fails boot on drift. ~30 LOC + 1 alert rule. **Direct precursor to the vNext design where the operator owns a node-id database, registers internal/external nodes, and pings their installation endpoints on a cadence** (per Derek 2026-04-28). Files for task.0413+ once this MVP audit proves the signal is useful.
3. **task.0411 — In-binary multi-tenant operator.** Filed at `needs_design`. The original 6-PR design archived for the day Cogni ships as a SaaS reviewing N customer forks. **Do not build until there's a real second use-case beyond prod/test.** Blocked by task.0410.

### C4 — Agentic-API DM flow (verified, no code changes)

`GitHubVcsAdapter` is constructed once at boot from `env.GH_REVIEW_APP_ID` + `env.GH_REVIEW_APP_PRIVATE_KEY_BASE64` (`nodes/operator/app/src/bootstrap/capabilities/vcs.ts:62-71`). InstallationId is resolved per-call. In a single-tenant pod, the adapter naturally uses that pod's App. The `core__vcs_*` tools (`packages/ai-tools/src/tools/vcs-flight-candidate.ts`, etc.) consume the adapter via DI — no tenant-context plumbing needed. **The agentic-API DM flow against `test.cognidao.org` works with zero code changes given dual-deploy.** Verified per task.0409 review C4.

### Validation (refines work item's existing block)

- **exercise:** (1) From `Cogni-DAO/test-repo` PR opened by `pnpm test:external:operator`, the `cogni-review-test` App posts a "Cogni Git PR Review" Check Run. (2) Production `cogni-review-production` App's Recent Deliveries page (App settings → Advanced) shows zero events for `Cogni-DAO/test-repo`. (3) From a separate authed shell, DM `https://test.cognidao.org/api/v1/ai/chat` with "flight PR #N on Cogni-DAO/test-repo" — agent calls `core__vcs_flight_candidate`, returns the flight workflow URL.
- **observability:** Loki query against the test deploy: `{namespace="cogni-test", pod=~"operator-.*"} | json | component="webhook-route"` — every entry has `repository.full_name` in `Cogni-DAO/test-repo` (only). Cross-leak detection: any entry with a non-test-repo full_name → fail.
