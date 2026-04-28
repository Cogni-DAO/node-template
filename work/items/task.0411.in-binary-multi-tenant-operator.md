---
id: task.0411
type: task
title: "In-binary multi-tenant operator — single pod handles N GitHub Apps (vFuture SaaS)"
status: needs_design
priority: 3
rank: 50
estimate: 5
branch:
summary: "When Cogni ships as a SaaS reviewing N customer forks, one operator pod will need to serve multiple GitHub Apps simultaneously — try-each-secret HMAC at the webhook, tenantId in workflow input, per-tenant Octokit factories. **Do not build until there is a real second use-case beyond the prod/test split.** task.0409's dual-deploy pattern is sufficient until then."
outcome: "(1) Operator boots with N tenant configurations from env (`GH_TENANTS=...`). (2) Webhook handler picks tenant via try-each-secret HMAC (`@octokit/webhooks-methods.verify` already installed). (3) `tenantId` flows through `dispatch → workflow → activity` via `PrReviewWorkflowInputSchema` (depends on task.0410 having landed). (4) Activity layer resolves App creds per-call by tenantId. (5) Per-tenant `GH_REPOS` allowlist enforced at both route and activity layers. (6) Single deploy can serve prod + test + N customer tenants safely."
spec_refs:
  - vcs-integration
  - github-app-webhook-setup
assignees: derekg1729
credit:
project: proj.vcs-integration
pr:
reviewer:
revision: 1
blocked_by:
  - task.0410
deploy_verified: false
created: 2026-04-28
updated: 2026-04-28
labels: [vcs, multi-tenant, github-app, vfuture, saas]
external_refs:
  - work/items/task.0409.multi-tenant-git-review-routing.md
  - work/items/task.0410.pr-review-workflow-input-zod.md
  - work/items/task.0412.tenant-config-audit.md
---

## When to build this

Trigger conditions for this task to leave `needs_design`:

- Cogni ships as a SaaS reviewing customer forks AND/OR
- Operator deploys exceed two (prod + test become prod + test + customer-N + ...) AND/OR
- A single deploy needs to serve multiple GitHub App identities simultaneously for any reason.

Until any of those is true, this is dead weight. task.0409's **dual-deploy** model (one App per deploy, one deploy per tenant) handles the prod/test case with zero code change beyond the allowlist guard. Adding in-binary multi-tenancy before there's a use-case violates `SIMPLICITY_WINS`.

## Captured design (from task.0409 v1, archived here)

The original task.0409 framing assumed in-binary multi-tenancy. It got pivoted to dual-deploy. The full original design is preserved here for the day the trigger fires — no need to re-derive.

### Approach (when triggered)

1. **Tenant identification** — try-each-secret HMAC at the webhook route using `@octokit/webhooks-methods.verify(secret, body, signature)`. Iterate configured tenants, first match wins, no match → 401.
2. **Tenant config shape** — `GH_TENANTS=prod,test,customer-1,...` lists IDs; per-tenant prefixed env vars (`GH_TENANT_<ID>_REVIEW_APP_ID`, `_PRIVATE_KEY_BASE64`, `_WEBHOOK_SECRET`, `_REPOS`). Backward-compat: existing `GH_REVIEW_APP_*` (no prefix) is the implicit `prod` tenant.
3. **Workflow input plumbing** — `tenantId: z.enum([...])` is a required field on `PrReviewWorkflowInputSchema` (depends on task.0410). Both dispatch and activities consume via `z.infer<>`.
4. **WorkflowId tenant prefix** — `pr-review:tenant=<id>:<owner>/<repo>/<pr>/<sha>` so prod + test can run on the same SHA without Temporal collision.
5. **Per-tenant allowlist enforced** — at both webhook route (pre-dispatch) and activity layer (defense in depth).
6. **No silent fallback** — if no tenant matches signature, return 401. No "default to prod."
7. **Prod backward compat** — `loadTenants(env)` produces a single-entry map with `tenantId="prod"` if only the un-prefixed vars are set. No env migration for existing deploys.

### Files (when triggered)

See task.0409's archived "Files" section in commit history (`git log -- work/items/task.0409.multi-tenant-git-review-routing.md` before the MVP-pivot commit).

### Why deferred

Per task.0409's review (REQUEST CHANGES verdict): the simplified MVP gets test:external running with ~10 LOC of code change vs ~1500 LOC for the in-binary approach. Operational tenancy (separate deploys per App) is the right architectural call until SaaS use-cases force the issue. Premature in-binary multi-tenancy adds five new failure modes (try-each-secret race, tenantId drift, workflowId migration, tenant config-shape evolution, defense-in-depth gap if any layer skips the check) for zero current user benefit.

## Pointers

- task.0409 — the MVP this defers from
- task.0410 — Zod input schema (this task's prerequisite when triggered)
- task.0412 — operational invariant audit (the alternative to in-binary enforcement until this task lands)

## Validation

- **exercise:** When triggered — open a PR on a customer-tenant fork; assert the customer-tenant App reviews it; assert prod App's Recent Deliveries shows nothing; verify the `tenantId` carried through dispatch → workflow → activity matches the matched secret.
- **observability:** When triggered — Loki query `{namespace="cogni-production"} | json | event="webhook.tenant_resolved" | tenantId="<id>"` returns one entry per delivery, with the matched `tenantId` distinct from the delivery's source App.
