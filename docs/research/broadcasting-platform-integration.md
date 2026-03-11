---
id: broadcasting-platform-integration
type: research
title: "Broadcasting Platform Integration — Research"
status: draft
trust: draft
summary: Research API-first integration paths for multi-platform social media broadcasting with AI content generation and Temporal HITL approval workflows.
read_when: Working on broadcasting, social media integration, or content publishing features.
owner: derekg1729
created: 2026-03-11
tags: [broadcasting, social-media, ai, temporal, research]
---

# Broadcasting Platform Integration — Research

> Spike: `spike.0158` | Date: 2026-03-11

## Executive Summary

**Goal:** Enable AI-generated content publishing across social platforms with human-in-the-loop approval, built on our existing Temporal + LangGraph infrastructure.

**Pareto finding:** 4 platforms (Discord, Bluesky, X, LinkedIn) cover ~80% of developer/startup audience reach with ~20% of total possible integration effort. Total engineering time: **1-2 days** for a thin TypeScript wrapper calling each API directly.

**Recommendation:** Build a thin `@cogni/broadcasting` package (~500-800 LOC) wrapping platform APIs directly — no external OSS dependency needed for Crawl phase. Use Postiz only if a full scheduling dashboard UI becomes a requirement later.

---

## 1. Platform API Analysis

### Tier 1: Must-Have (80% of developer reach)

#### X/Twitter API v2

| Tier  | Cost      | Write Limit                  | Notes                      |
| ----- | --------- | ---------------------------- | -------------------------- |
| Free  | $0        | 1,500 tweets/month (~50/day) | Write-only, no read access |
| Basic | $200/mo   | 50,000/month                 | Adds read access (15k/mo)  |
| Pro   | $5,000/mo | 1,000,000/month              | 25x price jump from Basic  |

- **Auth:** OAuth 2.0 with PKCE
- **Rate limits:** Free tier uses 24h windows; Basic/Pro use 15-min windows with HTTP 429 + `Retry-After`
- **Verdict:** Free tier is sufficient for startup posting cadence. Upgrade to Basic only if read access (analytics, mentions) is needed.

#### LinkedIn API

- **Auth:** OAuth 2.0, 3-legged flow. Tokens expire every 2 months.
- **Scopes:** `w_member_social` (personal), `w_organization_social` (company pages)
- **Access:** New apps start at restricted Development tier. Must apply for Standard tier (days to weeks).
- **Cost:** Free once approved.
- **Gotcha:** Requires LinkedIn Page verification before app creation. Marketing API is versioned; older versions sunset regularly.
- **Verdict:** Free, moderate OAuth complexity (4-8h integration). Essential for B2B reach. Approval process is the bottleneck.

#### Bluesky / AT Protocol

- **Auth:** App passwords (simple) or OAuth. No approval process.
- **SDK:** `@atproto/api` on npm — official TypeScript SDK.
- **Features:** Rich text (mentions, links), images, quote posts, reply threads.
- **Cost:** Free. No restrictive rate limits. Open, federated protocol.
- **Verdict:** **Best developer experience of any platform.** 30 minutes to integrate. Growing developer audience. Zero cost.

```typescript
import { BskyAgent } from "@atproto/api";
const agent = new BskyAgent({ service: "https://bsky.social" });
await agent.login({ identifier: handle, password: appPassword });
await agent.post({ text: "Hello world", createdAt: new Date().toISOString() });
```

### Tier 2: High Value, More Effort

#### Discord (Webhooks)

- **Auth:** None — just a URL.
- **Rate limit:** 30 req/sec per webhook.
- **Integration:** Single HTTP POST with JSON body. Supports rich embeds.
- **Verdict:** **Simplest integration in this report.** 15 minutes. Use webhooks for announcements; bot only if interactive features needed.

#### YouTube Data API v3

- **Auth:** OAuth 2.0.
- **Quota:** 10,000 units/day default. Video uploads cost 1,600 units each (~6 uploads/day).
- **Community Posts:** Not supported by API.
- **Verdict:** Free but quota-constrained. Only useful for automated video uploads. Not viable for text-style posting.

#### Reddit API

- **Rate limits:** 100 QPM authenticated, averaged over 10-min windows.
- **Cost:** Free for non-commercial. Commercial requires prior approval + possible licensing fees.
- **Reality check:** Reddit culture is deeply hostile to automated/promotional posting. Subreddits enforce karma requirements, account age gates, and self-promotion rules. Accounts get banned for automation.
- **Verdict:** Technically easy, culturally the hardest platform. Best used for monitoring, not automated posting.

### Tier 3: Manual Only (No Posting API)

| Platform         | API Status                                                 | Approach                                                   |
| ---------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| **Hacker News**  | Read-only Firebase API. Zero write endpoints.              | Manual posting only. Browser automation violates ToS.      |
| **Product Hunt** | GraphQL API is read-only for products. No launch endpoint. | Manual curation process. Plan as one-time marketing event. |

---

## 2. OSS Tool Comparison

### Self-Hosted Solutions

#### Postiz (TypeScript — Top OSS Pick)

- **Repo:** `gitroomhq/postiz-app` — ~14k+ stars, Apache 2.0
- **Stack:** TypeScript, Next.js, NestJS, Redis, Bull queues, Prisma
- **Platforms:** 17+ (X, LinkedIn, Reddit, Discord, Bluesky, Mastodon, Instagram, YouTube, TikTok, Threads, Pinterest, etc.)
- **Key features:** Public REST API, webhook integrations, AI content generation, multi-tenant, CLI agent with MCP support
- **Trade-off:** Young project (Sep 2024). Adds operational burden (Redis, NestJS worker processes, Prisma ORM). Different ORM than our Drizzle stack.

#### Mixpost (PHP/Laravel)

- **Repo:** `inovector/mixpost` — Laravel + Vue 3
- **Platforms:** Free: Facebook, X, Mastodon. Paid: +Instagram, LinkedIn, YouTube, TikTok, Bluesky, etc.
- **Trade-off:** PHP stack — technology mismatch with our Node/TS monorepo. Not recommended.

### Unified API Services (SaaS)

| Service            | Free Tier   | Platforms | Trade-off                     |
| ------------------ | ----------- | --------- | ----------------------------- |
| Late (getlate.dev) | 20 posts/mo | 13        | Best docs, but vendor lock-in |
| Ayrshare           | Limited     | 10+       | Most mature npm package       |
| Post for Me        | From $10/mo | 9+        | Simple, affordable            |

### Build vs. Buy Recommendation

| Approach                              | Effort               | Cost      | Control | Verdict                          |
| ------------------------------------- | -------------------- | --------- | ------- | -------------------------------- |
| **Thin wrapper** (call APIs directly) | 1-2 days             | $0        | Full    | **Recommended for Crawl**        |
| **Self-host Postiz**                  | 2-3 days setup + ops | $0        | High    | Consider for Walk (if UI needed) |
| **Unified SaaS API**                  | 0.5 days             | $10-50/mo | Low     | Only if speed-to-market critical |

**Recommendation:** Build a thin `@cogni/broadcasting` package. For 4 platforms (Discord + Bluesky + X + LinkedIn), this is ~500-800 lines of integration code with zero vendor dependency. Our existing Temporal scheduling handles the timing. Our existing LangGraph handles the content generation. No need for Postiz's Redis/Bull/Prisma stack.

---

## 3. Human-in-the-Loop Architecture

### Temporal Workflow Design

Leverages our existing `@cogni/scheduler-core` + Temporal infrastructure.

```
┌─────────────────────────────────────────────────────────┐
│                  broadcastWorkflow                       │
│                                                         │
│  1. AI generates draft  ──→  LangGraph "broadcast" graph│
│     (per-platform formatting, char limits, hashtags)     │
│                                                         │
│  2. Risk assessment     ──→  classify content risk tier  │
│     ┌──────────────────────────────────────────┐        │
│     │ LOW:  reshare/template → auto-approve    │        │
│     │ MED:  AI draft, safe topic → post + notify│       │
│     │ HIGH: novel/sensitive → block for review  │        │
│     └──────────────────────────────────────────┘        │
│                                                         │
│  3. [If HIGH] Signal wait ──→ durable pause             │
│     • Notify reviewer (Discord/Slack/UI)                │
│     • Wait for approve/edit/reject Signal               │
│     • Auto-escalate after configurable timeout          │
│                                                         │
│  4. Publish              ──→  post to selected platforms│
│     • Per-platform activity with retry policy            │
│     • Record results in broadcast_runs table             │
│                                                         │
│  5. Observe              ──→  log engagement metrics     │
│     • Track link clicks, impressions (where API allows)  │
└─────────────────────────────────────────────────────────┘
```

### Why Temporal (vs. simple queue)

- **Durability:** Workflows survive restarts/crashes. Approval state persists indefinitely.
- **Signals:** Native pattern for "pause until human responds" — no polling, no external state store.
- **Retry policies:** Built-in per-activity retries with exponential backoff for flaky platform APIs.
- **Visibility:** Full audit trail of every draft → review → publish decision.
- **Timers:** Auto-escalation (e.g., "if no review in 24h, notify backup reviewer").
- **Existing infra:** We already run Temporal for scheduling. Zero new infrastructure.

### Risk-Based Review Tiers

| Risk Level | Examples                                                          | Action                                    |
| ---------- | ----------------------------------------------------------------- | ----------------------------------------- |
| **Low**    | Reshares, approved templates, recurring announcements             | Auto-post, no review                      |
| **Medium** | AI drafts matching established voice/topics                       | Post immediately, notify for async review |
| **High**   | Novel content, mentions competitors/pricing, controversial topics | Block until explicitly approved           |

---

## 4. Proposed Integration Roadmap

### Crawl (P0) — Core Broadcasting Pipeline

**Goal:** AI can draft posts, human approves, posts publish to 3 platforms.

| Deliverable                                            | Est     | Notes                                                     |
| ------------------------------------------------------ | ------- | --------------------------------------------------------- |
| `@cogni/broadcasting` package — platform adapter ports | 1       | TypeScript interfaces for post/delete/status per platform |
| Discord webhook adapter                                | 0.5     | Single HTTP POST, rich embeds                             |
| Bluesky adapter (`@atproto/api`)                       | 0.5     | Official SDK, app-password auth                           |
| X/Twitter adapter (OAuth 2.0, free tier)               | 1       | 1,500 posts/mo, sufficient for launch                     |
| `broadcastWorkflow` Temporal workflow                  | 2       | Draft → review Signal → publish activities                |
| `broadcast_posts` + `broadcast_runs` DB tables         | 1       | Drizzle schema, track drafts + publish results            |
| LangGraph "broadcast" graph (content generation)       | 2       | Platform-aware formatting, character limits               |
| Review UI (approve/edit/reject in Cogni dashboard)     | 2       | Sends Temporal Signal on action                           |
| **Total**                                              | **~10** |                                                           |

### Walk (P1) — LinkedIn + Analytics + Scheduling

| Deliverable                                                | Est | Notes                               |
| ---------------------------------------------------------- | --- | ----------------------------------- |
| LinkedIn adapter (OAuth 2.0 + token refresh)               | 2   | Requires Standard tier API approval |
| Scheduled broadcasting (cron-based via existing scheduler) | 1   | Reuse `@cogni/scheduler-core`       |
| Post analytics collection (where APIs allow)               | 2   | Engagement metrics per post         |
| Risk-based auto-approval tiers                             | 1   | Configurable per-tenant             |
| Campaign management (group posts into campaigns)           | 2   | Track launch campaigns end-to-end   |

### Run (P2) — Full Broadcasting Suite

| Deliverable                     | Est | Notes                                              |
| ------------------------------- | --- | -------------------------------------------------- |
| YouTube video upload adapter    | 2   | OAuth + quota management                           |
| Content calendar UI             | 3   | Visual scheduling interface                        |
| A/B testing (post variants)     | 2   | Test different copy/timing                         |
| Cross-platform threading        | 2   | Thread on X → LinkedIn carousel → Bluesky thread   |
| Evaluate Postiz integration     | 2   | If full dashboard UI needed, consider self-hosting |
| Reddit monitoring (not posting) | 1   | Track mentions, manual engagement                  |

---

## 5. Architecture Fit

### How Broadcasting Maps to Existing Infrastructure

| Broadcasting Need  | Existing Infrastructure                                 | Gap                                              |
| ------------------ | ------------------------------------------------------- | ------------------------------------------------ |
| Content generation | LangGraph graphs + `@cogni/ai-tools`                    | Need "broadcast" graph + platform-specific tools |
| Scheduling         | `@cogni/scheduler-core` + Temporal Schedules            | Need broadcast-specific schedule types           |
| Approval workflow  | Temporal Signals (documented in `temporal-patterns.md`) | Need `broadcastWorkflow` implementation          |
| Credential storage | `channel_registrations` table (AES-256-GCM encrypted)   | Extend for social platform OAuth tokens          |
| Billing/metering   | `credit_ledger` + `ai_invocation_summaries`             | Add broadcast-post billing events                |
| Observability      | Pino + Langfuse + Loki                                  | Add broadcast-specific metrics                   |

### Package Structure

```
packages/broadcasting/
├── src/
│   ├── ports/           # BroadcastPort, PlatformAdapter interfaces
│   ├── domain/          # Post, Campaign, BroadcastRun types
│   └── index.ts
├── package.json         # @cogni/broadcasting
└── tsconfig.json

apps/web/src/features/broadcasting/
├── services/            # broadcastService, platformAdapterFactory
├── adapters/
│   ├── discord.ts       # Webhook adapter
│   ├── bluesky.ts       # @atproto/api adapter
│   ├── twitter.ts       # X API v2 adapter
│   └── linkedin.ts      # LinkedIn API adapter
├── workflows/
│   └── broadcastWorkflow.ts  # Temporal workflow
└── components/          # Review UI, content calendar
```

---

## 6. Key Risks & Mitigations

| Risk                         | Impact | Mitigation                                                |
| ---------------------------- | ------ | --------------------------------------------------------- |
| X API pricing changes        | Medium | Free tier is sufficient; keep adapter swappable           |
| LinkedIn API approval delay  | Low    | Start application early; LinkedIn is Walk phase           |
| AI-generated content quality | High   | Always require human review for High-risk content         |
| Platform ToS violations      | High   | Rate limit all adapters; never automate HN/Reddit posting |
| Postiz project instability   | Low    | Don't depend on it for Crawl; evaluate for Run phase      |

## Sources

- [X API Pricing](https://getlate.dev/blog/twitter-api-pricing) | [X Rate Limits](https://devcommunity.x.com/t/api-v2-post-rate-limit/200851)
- [Bluesky Docs](https://docs.bsky.app/docs/get-started) | [@atproto/api](https://www.npmjs.com/package/@atproto/api)
- [Discord Webhooks Guide](https://inventivehq.com/blog/discord-webhooks-guide)
- [Reddit Data API](https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki)
- [YouTube API Quota](https://developers.google.com/youtube/v3/determine_quota_cost)
- [Postiz](https://github.com/gitroomhq/postiz-app) | [Mixpost](https://mixpost.app/)
- [Late API](https://getlate.dev/) | [Ayrshare](https://www.npmjs.com/package/social-post-api)
- [Temporal HITL Cookbook](https://docs.temporal.io/ai-cookbook/human-in-the-loop-python)
