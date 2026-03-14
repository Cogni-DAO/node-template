---
id: task.0159
type: task
title: "Broadcasting Crawl — use-case seam, optimizer, publish pipeline"
status: needs_implement
priority: 1
rank: 1
estimate: 3
summary: Add use-case orchestration layer to broadcast-core, wire LLM content optimizer and echo publisher, rewire routes through use-cases, add DB migration, fix review feedback (state transitions, ownership validation, idempotency).
outcome: Creating a broadcast draft triggers LLM optimization and generates platform posts for review. Approving a post publishes it (echo adapter for Crawl). The architecture has a clean seam for Temporal to wrap later without rewriting.
spec_refs:
  - broadcasting-spec
assignees:
  - derekg1729
credit:
project: proj.broadcasting
branch: claude/research-broadcasting-integration-8p2DB
pr:
reviewer:
revision: 3
blocked_by:
deploy_verified: false
created: 2026-03-13
updated: 2026-03-14
labels: [broadcasting, crawl]
external_refs:
---

# Broadcasting Crawl — use-case seam, optimizer, publish pipeline

## Context

The broadcasting foundation is built: `broadcast-core` package (types, ports, rules, errors), DB schema, Drizzle adapters, API contracts, routes, and UI (task.0165). But the pipeline doesn't DO anything — routes call raw adapters, no optimization runs, no publishing happens, state transitions aren't enforced.

This task adds the orchestration layer and wires the pipeline end-to-end. The critical architectural constraint: use-case functions live in `broadcast-core` (not in routes or feature services), so Temporal activities can wrap them later without a rewrite. Routes become thin HTTP shells that call use-cases.

**Governing spec:** [docs/spec/broadcasting.md](../../docs/spec/broadcasting.md)

## What Already Exists (delivered on this branch)

- `packages/broadcast-core/` — types, ports, rules, errors, GenerationPolicy ✓
- `packages/db-schema/src/broadcasting.ts` — 2 tables with RLS ✓
- `packages/db-client/src/adapters/drizzle-broadcast-*.adapter.ts` — user + worker adapters ✓
- `apps/web/src/contracts/broadcast.*.v1.contract.ts` — 3 contract files ✓
- `apps/web/src/app/api/v1/broadcasting/` — 3 route files ✓
- `apps/web/src/app/(app)/broadcasting/` — UI (task.0165) ✓
- `apps/web/src/bootstrap/container.ts` — broadcastLedger wired ✓

## What This Task Delivers

1. **Use-case functions in `broadcast-core`** — pure orchestration, ports as args
2. **LLM content optimizer adapter** — `ContentOptimizerPort` impl via GraphExecutorPort
3. **Echo publish adapter** — mock `PublishPort` for Crawl (logs + returns fake externalId)
4. **Route rewiring** — routes call use-cases, not raw adapters
5. **DB migration** — tables don't exist yet
6. **Behavioral hardening** — state transition enforcement, publish idempotency, messageId/postId ownership validation

## Requirements

### Use-Cases (`packages/broadcast-core/src/use-cases/`)

Three pure orchestration functions, each taking ports as arguments:

1. **`optimize-draft.ts`** — Given a `draft` ContentMessage, run `ContentOptimizerPort.optimize()` for each target platform, create PlatformPosts via `BroadcastLedgerWorkerPort`, assess risk via `assessRisk()`, set post status based on risk level (`pending_review` for high, `approved` for low/medium per `requiresReview()`). Transition message status `draft → optimizing → review`. Enforce state transitions via `canTransitionMessage()`.

2. **`apply-review-decision.ts`** — Given a PlatformPostId + ReviewDecision, validate the post belongs to the given ContentMessageId (ownership check), validate post is in `pending_review` status, apply the decision via `BroadcastLedgerUserPort.updatePlatformPostReview()`. Enforce `"edited"` requires `editedBody` (throw if missing).

3. **`publish-post.ts`** — Given an approved PlatformPost, call `PublishPort.publish()`, then `BroadcastLedgerWorkerPort.finalizePlatformPost()` with the result. **Idempotent**: if post already has `externalId`, return early (no double-publish). Transition post `approved → publishing → published` (or `failed` on error).

### Adapters (app-level, not in packages)

4. **LLM content optimizer** — `apps/web/src/adapters/server/broadcast/llm-content-optimizer.adapter.ts`. Implements `ContentOptimizerPort`. Depends on `GraphExecutorPort` (already exists). Platform-aware: X gets 280-char limit + hashtags, others get reasonable defaults. Does NOT import Temporal or graph-run internals.

5. **Echo publish adapter** — `apps/web/src/adapters/server/broadcast/echo-publish.adapter.ts`. Implements `PublishPort`. Logs "would publish to {platform}" and returns a deterministic fake `externalId`/`externalUrl`. Sufficient for Crawl MVP.

### Infrastructure

6. **DB migration** — Create migration file for `content_messages` and `platform_posts` tables with RLS policies.

### Rewiring + Hardening

7. **Route rewiring** — POST /broadcasting calls `optimizeDraft()` after creating the message. POST .../review calls `applyReviewDecision()`, then `publishPost()` if decision is `approved`.

8. **Fix review feedback** (from revision 1-2 non-blocking suggestions):
   - Extract duplicated `toContentMessage`/`toPlatformPost` mappers to shared file in `packages/db-client`
   - Extract duplicated `toResponse`/`handleRouteError` in route files to shared module
   - `assessRisk` — remove unused `_platformPosts` param
   - Enforce state transitions in adapters (call `canTransitionMessage()` / `canTransitionPlatformPost()`)

### Invariants

- **MESSAGE_IS_PLATFORM_AGNOSTIC** — optimizer transforms body; message body unchanged
- **ONE_POST_PER_PLATFORM** — unique index + use-case checks before creating posts
- **REVIEW_BEFORE_HIGH_RISK** — `requiresReview()` gates post status in `optimizeDraft()`
- **ADAPTERS_ARE_SWAPPABLE** — use-cases depend on ports, not adapters
- **PUBLISH_IS_IDEMPOTENT** — `publishPost()` no-ops if `externalId` already set
- **USE_CASES_ARE_TEMPORAL_READY** — pure functions with ports as args; no HTTP, no framework deps

### Out of Scope

- Real X/Twitter adapter (separate task: task.0166)
- Temporal workflow (unified graph-via-Temporal effort on separate branch)
- Discord, Bluesky, LinkedIn adapters
- Engagement, campaigns, broadcast_runs (Walk)

## Design

### Outcome

Broadcasting pipeline is functional end-to-end: compose draft → LLM optimizes per platform → human reviews → publish (echo). Architecture has clean seam for Temporal migration.

### Approach

**Solution**: Add `src/use-cases/` to `broadcast-core` with 3 pure orchestration functions (ports as args). Thin adapters for optimizer (LLM) and publisher (echo) in app code. Routes become HTTP shells calling use-cases.

**Reuses**:

- `scheduler-core/src/services/` pattern for package-level orchestration (ports as args)
- `GraphExecutorPort` for LLM optimization (already exists, already wired)
- `assessRisk()` and `requiresReview()` from `broadcast-core/rules.ts` (defined but currently unused)
- `canTransitionMessage()` / `canTransitionPlatformPost()` from `broadcast-core/rules.ts` (defined but currently unused)

**Rejected**:

- **2 packages** (`broadcast-core` + `broadcast-application`) — premature split for 3 thin use-case files. One package with `src/use-cases/` mirrors `scheduler-core/src/services/`.
- **Temporal workflow now** — overkill for Crawl with one user. Use-case seam is sufficient; Temporal wraps these functions later in the unified graph-via-Temporal effort.
- **Feature services layer** (`apps/web/src/features/broadcasting/services/`) — would duplicate what belongs in the package. The use-cases will be called from both `apps/web` routes and `services/scheduler-worker` activities.

### Architecture

```
packages/broadcast-core/src/
  types.ts                  ← exists
  errors.ts                 ← exists
  rules.ts                  ← exists (fix: remove unused _platformPosts param)
  ports/                    ← exists
  use-cases/                ← NEW
    optimize-draft.ts       ← (ledger, optimizer) → creates platform posts
    apply-review-decision.ts ← (ledger) → validates + applies decision
    publish-post.ts         ← (ledger, publisher) → publishes, idempotent
    index.ts
  index.ts                  ← add use-case exports

apps/web/src/adapters/server/broadcast/   ← NEW
  llm-content-optimizer.adapter.ts        ← ContentOptimizerPort via GraphExecutorPort
  echo-publish.adapter.ts                 ← PublishPort mock for Crawl
```

### Invariants

- [ ] MESSAGE_IS_PLATFORM_AGNOSTIC: optimizer transforms; message body untouched (spec: broadcasting-spec)
- [ ] REVIEW_BEFORE_HIGH_RISK: `optimizeDraft()` uses `requiresReview()` to gate post status (spec: broadcasting-spec)
- [ ] PUBLISH_IS_IDEMPOTENT: `publishPost()` returns early if externalId set (spec: broadcasting-spec)
- [ ] USE_CASES_ARE_TEMPORAL_READY: pure functions, ports as args, no HTTP/framework deps (spec: architecture)
- [ ] ADAPTERS_ARE_SWAPPABLE: use-cases depend on port interfaces only (spec: broadcasting-spec)
- [ ] STATE_TRANSITIONS_ENFORCED: all status changes validated via canTransition\* (spec: broadcasting-spec)

### Files

- Create: `packages/broadcast-core/src/use-cases/optimize-draft.ts`
- Create: `packages/broadcast-core/src/use-cases/apply-review-decision.ts`
- Create: `packages/broadcast-core/src/use-cases/publish-post.ts`
- Create: `packages/broadcast-core/src/use-cases/index.ts`
- Create: `apps/web/src/adapters/server/broadcast/llm-content-optimizer.adapter.ts`
- Create: `apps/web/src/adapters/server/broadcast/echo-publish.adapter.ts`
- Create: DB migration file for content_messages + platform_posts
- Modify: `packages/broadcast-core/src/index.ts` — export use-cases
- Modify: `packages/broadcast-core/src/rules.ts` — fix assessRisk signature
- Modify: `apps/web/src/app/api/v1/broadcasting/route.ts` — call optimizeDraft after create
- Modify: `apps/web/src/app/api/v1/broadcasting/[messageId]/posts/[postId]/review/route.ts` — call applyReviewDecision + publishPost
- Modify: `apps/web/src/bootstrap/container.ts` — wire optimizer + publisher
- Modify: `packages/db-client/src/adapters/drizzle-broadcast-*.adapter.ts` — extract shared mappers, enforce transitions
- Test: `packages/broadcast-core/tests/use-cases/*.test.ts` — unit tests with mock ports

## Plan

### 1. Use-case seam in broadcast-core

- [ ] Create `src/use-cases/optimize-draft.ts`
- [ ] Create `src/use-cases/apply-review-decision.ts`
- [ ] Create `src/use-cases/publish-post.ts`
- [ ] Create `src/use-cases/index.ts` barrel
- [ ] Export from `src/index.ts`
- [ ] Fix `assessRisk` — remove unused `_platformPosts` param
- [ ] Unit tests for all 3 use-cases with mock ports

### 2. Adapters + migration

- [ ] Create `llm-content-optimizer.adapter.ts` — ContentOptimizerPort via GraphExecutorPort
- [ ] Create `echo-publish.adapter.ts` — mock PublishPort
- [ ] Create DB migration for content_messages + platform_posts + RLS

### 3. Rewire routes + harden

- [ ] Rewire POST /broadcasting route → call `optimizeDraft()` after create
- [ ] Rewire POST .../review route → call `applyReviewDecision()` + conditionally `publishPost()`
- [ ] Add messageId/postId ownership validation in review route
- [ ] Enforce state transitions in Drizzle adapters
- [ ] Enforce `"edited"` requires `editedBody`
- [ ] Extract duplicated mappers (toContentMessage, toResponse, handleRouteError)
- [ ] Wire optimizer + publisher in container.ts

### 4. Validate

- [ ] `pnpm check` passes
- [ ] `pnpm test` — all unit tests pass (including new use-case tests)
- [ ] Manual: compose draft → posts appear at pending_review → approve → status moves to published

## Validation

```bash
pnpm packages:build          # broadcast-core builds with use-cases
pnpm check                   # lint + type + format
pnpm test                    # unit tests pass
```

**Manual verification:**

- POST /api/v1/broadcasting → creates draft AND generates platform posts (status: pending_review)
- GET /api/v1/broadcasting/{id} → shows posts with risk levels
- POST .../review with approved → post transitions to published (echo adapter logs)
- POST .../review with approved again → idempotent (no double publish)
- POST .../review with wrong messageId → 400 (ownership validation)

## Review Checklist

- [ ] **Spec:** all invariants upheld
- [ ] **Architecture:** use-cases in package, adapters in app — clean boundary
- [ ] **Tests:** use-case unit tests with mock ports
- [ ] **Temporal-ready:** use-cases are pure functions with ports as args
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
