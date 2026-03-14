---
id: task.0166
type: task
title: "X/Twitter PublishPort adapter"
status: needs_design
priority: 2
rank: 3
estimate: 2
summary: Implement real X/Twitter PublishPort adapter — OAuth 2.0, POST /2/tweets, rate limiting. Replaces the echo adapter for the X platform. Most future platform adapters (LinkedIn, Bluesky) will follow a similar OAuth connection pattern.
outcome: Approving a broadcast targeting X publishes a real tweet. The echo adapter remains as fallback for platforms without adapters.
spec_refs:
  - broadcasting-spec
assignees:
  - derekg1729
credit:
project: proj.broadcasting
branch:
pr:
reviewer:
revision: 0
blocked_by: task.0159
deploy_verified: false
created: 2026-03-14
updated: 2026-03-14
labels: [broadcasting, x-twitter, oauth, crawl]
external_refs:
---

# X/Twitter PublishPort adapter

## Context

task.0159 delivers the broadcasting pipeline with an echo (mock) publish adapter. This task replaces it with a real X/Twitter adapter. This is also the first OAuth-based platform adapter — the pattern established here (credential storage, token refresh, rate limiting) will be reused by LinkedIn, Bluesky, and other adapters.

**Governing spec:** [docs/spec/broadcasting.md](../../docs/spec/broadcasting.md) — see "X/Twitter" under Platform Adapter Specifications.

## Requirements

1. **`PublishPort` implementation for `platform: "x"`** — OAuth 2.0 bearer token, `POST https://api.twitter.com/2/tweets`, `DELETE https://api.twitter.com/2/tweets/:id`
2. **Health check** — validate token via Twitter API
3. **Rate limiting** — respect free tier limits (1,500 tweets/month, 24h windows)
4. **Credential management** — reuse `channel_registrations` AES-256-GCM pattern from `proj.messenger-channels`, or simpler env-var approach for Crawl
5. **Thread support** — chain tweets via `reply.in_reply_to_tweet_id` when optimizer produces thread splits (> 280 chars)
6. **Container wiring** — register X adapter alongside echo adapter, route by platform ID

### Notes for future adapters

- LinkedIn: OAuth 2.0 3-legged, 2-month token expiry, auto-refresh
- Bluesky: App password (simpler than OAuth), `@atproto/api` SDK
- Discord: Webhook URL (simplest — no OAuth at all)
- All follow the same `PublishPort` interface; only credential management differs

## Validation

```bash
pnpm check                   # lint + type + format
pnpm test                    # unit tests pass
```

**Manual verification:**

- Compose draft targeting X → approve → real tweet posted
- Rate limiting respected (no burst over 1500/month)

## Out of Scope

- Engagement collection (Walk)
- Thread preview UI
- Multi-account support

## PR / Links

-

## Attribution

-
