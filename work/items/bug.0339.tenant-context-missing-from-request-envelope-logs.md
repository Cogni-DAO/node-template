---
id: bug.0339
type: bug
title: Tenant context missing from request-envelope logs — Loki can't slice by user/billing
status: needs_triage
priority: 2
rank: 30
estimate: 1
summary: "`wrapRouteHandlerWithLogging` emits `request received` / `request complete` / `request warning handled` / `request failed` per HTTP request with `routeId + reqId + method + status + durationMs`, but NOT `billing_account_id` or `user_id`. Domain events layered on top (e.g. `poly.copy_trade.targets.create_success`) carry `target_wallet + target_id` but also lack tenant. Result: Loki queries can't slice `/api/v1/poly/copy-trade/targets` by tenant without parsing POST bodies. Surfaced while validating bug.0338 on candidate-a — I had to correlate my own bearer-token timestamps against `create_success` events to attribute POSTs to tenants, because neither the envelope nor the domain event carries `user_id`."
outcome: "Every log line inside a request handler (envelope start/end/warn/error AND any feature/domain logs) carries `user_id` (and `billing_account_id` when resolved) without each route re-remembering to add them. Ops can filter Loki by tenant with a single `|~ <user_id>` without touching route code."
spec_refs:
  - observability
assignees: derekg1729
credit:
project:
branch:
pr:
reviewer:
revision: 0
blocked_by:
created: 2026-04-20
updated: 2026-04-20
labels: [observability, logging, multi-tenant, request-context]
external_refs:
  - nodes/poly/app/src/bootstrap/http/wrapRouteHandlerWithLogging.ts
  - packages/node-shared/src/observability/server/helpers.ts
  - work/items/bug.0338.poly-phase-a-drops-system-tenant-target-wallets.md
---

# Tenant context missing from request-envelope logs

> Surfaced during bug.0338 candidate-a validation on 2026-04-20. Two tenants POSTed to `/api/v1/poly/copy-trade/targets` in the same window; Loki couldn't distinguish their rows because `create_success` carried only `target_wallet + target_id`, not `user_id` or `billing_account_id`. The request envelope (`routeId + reqId + method`) didn't help either.

## Reproducer

1. Agent A + Agent B both register via `/api/v1/agent/register` (distinct tenants).
2. Both POST a target to `/api/v1/poly/copy-trade/targets` within seconds.
3. `{app="cogni-template", namespace="cogni-candidate-a"} |~ "poly.copy_trade.targets.create_success"` returns two lines — indistinguishable by tenant without cross-referencing bearer timestamps.

## Fix shape

`wrapRouteHandlerWithLogging` already binds `routeId + reqId + method` into the child logger at request start. Extend the same binding to include `user_id` (and `billing_account_id` when cheaply resolvable) after auth resolves — pino `child()` semantics mean every subsequent log line on that logger inherits the fields for free. No per-route boilerplate, no new domain events, zero new log volume.

- After `getSessionUser()` returns in the wrap handler, rebind `ctx.log = ctx.log.child({ user_id: sessionUser.id })`.
- `billing_account_id` is NOT always resolved per-request (some routes never look it up). Leave tenant resolution to route-level code; `user_id` alone is sufficient to slice by RLS key (the 1:1 billing ↔ user model in Phase A).
- Optional: feature helper `bindBillingContext(ctx, billingAccountId)` for routes that do resolve it (POST `/targets` already does).

## Not in scope

- Per-domain event inventory. The envelope already emits `request complete {status, durationMs}` with enough fields to be the terminal event per request. Domain `*_success` / `*_failed` events on top of that are usually duplicate instrumentation — a separate cleanup.
- Adding `user_id` as a Prometheus label. Cardinality forbids it; Loki slicing is the correct plane.

## Validation

- **exercise**: Two agents POST a target within 10s of each other on candidate-a.
- **observability**: `{...} |~ "request complete" |~ "<agent-A user_id>"` returns only agent A's request line; same query with agent B's `user_id` returns only agent B's. Same applies to `request warning handled` / `request failed`.
