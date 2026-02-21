---
id: proj.vcs-integration
type: project
primary_charter:
title: VCS Integration — Auth Backend + Git Services
state: Active
priority: 1
estimate: 5
summary: Shared GitHub/GitLab auth package, unified git-daemon service, and absorption of cogni-git-review, cogni-git-admin, and cogni-proposal-launcher into the Node template.
outcome: A single `services/git-daemon/` handles PR review, DAO admin actions, and ingestion token provisioning — backed by `packages/github-core/` auth primitives. Proposal launcher absorbed into the Node's Next.js UI. Sister repos archived.
assignees: [derekg1729]
created: 2026-02-22
updated: 2026-02-22
labels: [infra, github, auth]
---

# VCS Integration — Auth Backend + Git Services

## Goal

Consolidate all VCS integration into this repo: a shared auth package (`packages/github-core/`), a single webhook service (`services/git-daemon/`) replacing `cogni-git-review` and `cogni-git-admin`, and the proposal launcher UI from `cogni-proposal-launcher` absorbed into the Node's Next.js app. Two GitHub Apps with separate permission tiers, one backend. PAT fallback for self-hosted Nodes. GitLab adapter stubbed for Run phase.

## Roadmap

### Crawl (P0) — Auth Package + Service Skeleton

**Goal:** `packages/github-core/` ships with GitHub App auth primitives. `services/git-daemon/` boots, verifies webhooks, and routes events by app ID. No business logic yet — just the plumbing.

| Deliverable                                                            | Status      | Est | Work Item |
| ---------------------------------------------------------------------- | ----------- | --- | --------- |
| `packages/github-core/` — JWT, tokens, webhook verify, client factory  | Not Started | 2   | —         |
| `services/git-daemon/` scaffold — main, config, health, Fastify server | Not Started | 1   | —         |
| Webhook router — signature verify + app ID dispatch                    | Not Started | 1   | —         |
| Token provider — internal endpoint for scheduler-worker                | Not Started | 1   | —         |
| GitHub App creation guide (review + admin app setup)                   | Not Started | 0.5 | —         |
| Wire `GitHubSourceAdapter` to accept App token as alternative to PAT   | Not Started | 0.5 | —         |
| Docker Compose entry for git-daemon                                    | Not Started | 0.5 | —         |

### Walk (P1) — Absorb Review + Admin Logic

**Goal:** Port business logic from `cogni-git-review` and `cogni-git-admin` into `services/git-daemon/` handlers. Review runs through graphExecutor. Admin verifies on-chain CogniAction events. Sister repos archived.

| Deliverable                                                                        | Status      | Est | Work Item            |
| ---------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Review handler — PR review via graphExecutor                                       | Not Started | 3   | (create at P1 start) |
| Review handler — check suite re-request                                            | Not Started | 0.5 | (create at P1 start) |
| Admin handler — merge PR (on-chain authorized)                                     | Not Started | 1   | (create at P1 start) |
| Admin handler — grant/revoke collaborator                                          | Not Started | 1   | (create at P1 start) |
| Onchain webhook — Alchemy HMAC verify + CogniAction parse                          | Not Started | 1   | (create at P1 start) |
| Authorization policy — DAO allowlist enforcement                                   | Not Started | 1   | (create at P1 start) |
| Proposal launcher — absorb cogni-proposal-launcher into Node UI                    | Not Started | 2   | (create at P1 start) |
| E2E test — webhook → handler → GitHub API roundtrip                                | Not Started | 2   | (create at P1 start) |
| Archive `cogni-git-review`, `cogni-git-admin`, and `cogni-proposal-launcher` repos | Not Started | 0.5 | (create at P1 start) |

### Run (P2+) — GitLab Adapter + Multi-Tenant

**Goal:** GitLab OAuth adapter in `packages/gitlab-core/`. git-daemon handles GitLab webhooks. Operator multi-tenant token management.

| Deliverable                                                        | Status      | Est | Work Item            |
| ------------------------------------------------------------------ | ----------- | --- | -------------------- |
| `packages/gitlab-core/` — OAuth 2.0, token refresh, webhook verify | Not Started | 2   | (create at P2 start) |
| GitLab webhook route + handler dispatch                            | Not Started | 1   | (create at P2 start) |
| GitLab review adapter (VcsProvider interface)                      | Not Started | 2   | (create at P2 start) |
| Multi-installation token rotation for rate limits                  | Not Started | 1   | (create at P2 start) |

## Constraints

- Review and admin must use separate GitHub App credentials — never a single combined app
- git-daemon must not depend on Probot — direct GitHub API via github-core
- git-daemon must satisfy all service contracts (health endpoints, graceful shutdown, Zod env, import isolation)
- Admin app env vars are optional — the service must boot with review app only
- PAT-based auth must remain a valid path for self-hosted Nodes that skip App installation
- No direct DB access from git-daemon to Node DB (per node-operator-contract DATA_SOVEREIGNTY)

## Dependencies

- [x] `packages/ingestion-core/` — SourceAdapter port (exists on current branch)
- [x] `services/scheduler-worker/` — GitHubSourceAdapter (exists on current branch)
- [ ] graphExecutor available for review handler invocation (see proj.graph-execution)
- [ ] GitHub App registrations created (review + admin) with correct permission sets

## As-Built Specs

- [VCS Integration Architecture](../../docs/spec/vcs-integration.md) — auth, routing, service design

## Design Notes

- **Why not Probot?** CJS-only (v7), bundles Express (we use Fastify), hides auth flow needed for token-provider pattern. The auth primitives are ~200 lines — no framework needed.
- **Why two apps?** Principle of least privilege, progressive adoption, separate blast radii. GitHub grants all requested permissions at install time — no partial install. See spec for full rationale.
- **Sister repo absorption strategy:** Extract handler functions only — strip Probot, Express, standalone server infra. The VcsProvider interface from cogni-git-review carries forward as handler-level abstraction.
- **Token provisioning decision:** Start with in-process package import (scheduler-worker imports github-core directly, reads its own REVIEW_APP env vars). Internal HTTP endpoint is a P1 optimization if services need separate processes.
- **Proposal launcher absorption:** `cogni-proposal-launcher` is a RainbowKit+wagmi Next.js app that converts deep link URLs into Aragon proposals. It's the UI counterpart to git-admin (admin executes DAO votes → GitHub actions; proposal launcher creates the votes). Absorb into `src/features/governance/` or `src/app/proposals/` — reuse existing wagmi/RainbowKit setup already in the Node template.
