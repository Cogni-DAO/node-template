---
title: PostHog Self-Hosted Setup
status: active
owner: platform
created: 2025-02-28
---

# PostHog Self-Hosted Setup

PostHog is the product analytics event store for Cogni, backed by ClickHouse for SQL-queryable analytics.

## Architecture

```
App (Next.js)  ──HTTP POST──▶  PostHog Web (API)  ──▶  Kafka  ──▶  ClickHouse
                                     │
Scheduler-Worker ──HTTP POST──▶      │
                                     ▼
                              PostHog Worker (background processing)
```

**Key principle:** Server-side first. The app emits events via `capture()` helper to PostHog's HTTP API. ClickHouse is the queryable analytics store.

## Deployment Options

### Option A: Self-Hosted (Docker Compose)

Self-hosted PostHog runs as a separate compose stack alongside the main Cogni runtime.

**Resource requirements:** ~4GB RAM minimum (ClickHouse + Kafka + PostgreSQL + Redis + PostHog services).

#### Start PostHog

```bash
# Start PostHog stack (creates internal network automatically)
pnpm posthog:up

# Wait for health (PostHog web takes ~60s to start)
docker compose -f infra/compose/posthog/docker-compose.posthog.yml ps
```

#### Services & Ports

| Service              | Port (host)      | Purpose                       |
| -------------------- | ---------------- | ----------------------------- |
| `posthog-web`        | `127.0.0.1:8000` | PostHog UI + API              |
| `posthog-clickhouse` | `127.0.0.1:8123` | ClickHouse HTTP (SQL queries) |
| `posthog-clickhouse` | `127.0.0.1:9000` | ClickHouse native protocol    |
| `posthog-postgres`   | (internal only)  | PostHog metadata DB           |
| `posthog-redis`      | (internal only)  | Cache + queue                 |
| `posthog-kafka`      | (internal only)  | Event ingestion pipeline      |
| `posthog-zookeeper`  | (internal only)  | Kafka coordination            |

#### First-Time Setup

1. Open `http://localhost:8000` in browser
2. Create an admin account
3. Copy the **Project API Key** from Settings > Project > API Key
4. Set environment variables in `.env.local`:

```bash
POSTHOG_API_KEY=phc_your_project_api_key_here
POSTHOG_HOST=http://localhost:8000       # For pnpm dev (host mode)
# POSTHOG_HOST=http://posthog-web:8000  # For Docker mode (app in container on internal network)
```

### Option B: PostHog Cloud (Recommended for Production)

PostHog Cloud free tier supports up to 1M events/month.

1. Sign up at posthog.com
2. Copy your Project API Key
3. Set environment variables:

```bash
POSTHOG_API_KEY=phc_your_project_api_key_here
POSTHOG_HOST=https://us.i.posthog.com   # or https://eu.i.posthog.com
```

## App Configuration

### Environment Variables

| Variable          | Required | Default | Description               |
| ----------------- | -------- | ------- | ------------------------- |
| `POSTHOG_API_KEY` | **Yes**  | —       | PostHog project API key.  |
| `POSTHOG_HOST`    | **Yes**  | —       | PostHog API endpoint URL. |

Both variables are **required**. The app will fail to start if either is missing. For local dev, use self-hosted PostHog (`pnpm posthog:up`) or PostHog Cloud free tier.

### How Events Are Sent

The app uses `capture()` from `apps/web/src/shared/analytics/capture.ts`:

```typescript
import { capture, AnalyticsEvents } from "@/shared/analytics";

capture({
  event: AnalyticsEvents.AUTH_SIGNED_IN,
  identity: {
    userId: user.id, // canonical users.id UUID
    sessionId: session.id, // session identifier
    tenantId: billingAccountId,
    traceId: ctx.traceId, // OTel trace ID
  },
  properties: {
    provider: "github",
    is_new_user: true,
  },
});
```

Events are batched (50 events or 5s interval) and sent via HTTP POST to PostHog's `/batch/` endpoint.

## Running ClickHouse Queries

### From Host (Self-Hosted)

```bash
# Interactive ClickHouse client
docker exec -it posthog-clickhouse clickhouse-client

# One-off query
docker exec posthog-clickhouse clickhouse-client \
  --query "SELECT count() FROM posthog.events"

# HTTP API (useful for scripts)
curl 'http://localhost:8123/?query=SELECT+count()+FROM+posthog.events'
```

### From Inside the Docker Network

Other services on the `internal` network can reach ClickHouse at:

- HTTP: `http://posthog-clickhouse:8123`
- Native: `posthog-clickhouse:9000`

### Schema Discovery

PostHog stores events in ClickHouse. To explore the schema:

```sql
-- List all databases
SHOW DATABASES;

-- List tables in posthog database
SHOW TABLES FROM posthog;

-- Key tables:
--   posthog.events          — raw events (main query target)
--   posthog.person          — user/person records
--   posthog.person_distinct_id2 — distinct_id → person mapping

-- Describe the events table
DESCRIBE posthog.events;

-- Sample recent events
SELECT event, distinct_id, timestamp, properties
FROM posthog.events
ORDER BY timestamp DESC
LIMIT 10;
```

## Stopping PostHog

```bash
# Stop (preserve data)
docker compose -f infra/compose/posthog/docker-compose.posthog.yml down

# Stop and delete all data
docker compose -f infra/compose/posthog/docker-compose.posthog.yml down -v
```

## Risks & Trade-offs

### Resource Footprint

PostHog self-hosted requires ~4GB RAM (ClickHouse alone needs ~2GB). This is significant for local dev. **Recommendation:** Use PostHog Cloud for individual dev; self-host for staging/production.

### Identity

Canonical identity is `users.id` (UUID). For unauthenticated events (pre-sign-in), use a deterministic anonymous ID from the session cookie. PostHog will merge identities when `$identify` is called after sign-in.

### Event Volume

The MVP event set (12 events) is intentionally small. `page_viewed` is excluded to avoid volume spam. Monitor ClickHouse disk usage if self-hosting.

### Trace ID Correlation

`trace_id` is included when events fire inside an OTel span context (route handlers, graph execution). Events outside span context (e.g., auth callbacks) will have `trace_id: null`.

### No Kafka/Redis Sharing

PostHog uses its own Kafka and Redis instances, separate from the app stack. This avoids cross-contamination but increases resource usage.
