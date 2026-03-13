---
id: posthog-setup-guide
type: guide
title: PostHog Setup
status: active
trust: draft
summary: Set up PostHog Cloud for production analytics and optional self-hosted PostHog for local dev.
read_when: First-time setup, or when PostHog secrets are missing in CI/deploy.
owner: derekg1729
created: 2026-03-13
verified: 2026-03-13
tags: [analytics, onboarding]
---

# PostHog Setup

## When to Use This

You need to configure PostHog product analytics. This is required — the app will not start without `POSTHOG_API_KEY` and `POSTHOG_HOST`.

## Production Setup (PostHog Cloud)

### Preconditions

- [ ] GitHub repo admin access (to set environment secrets)

### Steps

1. **Sign up** at [posthog.com](https://posthog.com) — use GitHub SSO. No credit card required.

2. **Create a project.** PostHog will prompt you to create an organization and project on first login.

3. **Skip the "install snippet" step.** The app already has server-side event capture wired.

4. **Copy your Project API Key:**
   - Click the gear icon (Project Settings) in the left sidebar
   - Find **Project API Key** — it looks like `phc_xxxxxxxxxxxxxxxxxxxxxxxxxxxx`

5. **Set GitHub secrets** in **both** `preview` and `production` environments:

   | Secret            | Value                                            |
   | ----------------- | ------------------------------------------------ |
   | `POSTHOG_API_KEY` | `phc_xxxxxxxxxxxxxxxxxxxxxxxxxxxx` (from step 4) |
   | `POSTHOG_HOST`    | `https://us.i.posthog.com`                       |

   Go to: **Repo → Settings → Environments → preview** (then repeat for **production**)

### Verify

Push a commit or re-run CI. The stack-test job should pass without PostHog-related env errors.

---

## Local Dev Setup (Optional)

Self-hosted PostHog for local development. Requires ~4GB RAM.

### Preconditions

- [ ] Docker running with at least 4GB RAM allocated

### Steps

1. **Start the PostHog stack:**

   ```bash
   pnpm posthog:up
   ```

   Wait ~60 seconds for all services to become healthy.

2. **Create an account:** Open `http://localhost:8000` → create admin user → create project.

3. **Copy API key:** Project Settings → Project API Key.

4. **Add to `.env.local`:**

   ```bash
   POSTHOG_API_KEY=phc_your_key_from_step_3
   POSTHOG_HOST=http://localhost:8000
   ```

### Verify

```bash
pnpm dev:stack
```

Check the app logs for `PostHog initialized` (no startup errors about missing env vars).

### Stop / Reset

```bash
pnpm posthog:down     # stop, keep data
pnpm posthog:nuke     # stop and delete all data
```

---

## Troubleshooting

### Problem: App fails to start with "POSTHOG_API_KEY" validation error

**Solution:** Add the env vars. For local dev, copy from `.env.local.example`. For CI, check that GitHub environment secrets are set (see Production Setup above).

### Problem: Events not appearing in PostHog dashboard

**Solution:** Events are batched (50 events or 5 seconds). Wait a few seconds, then check PostHog → Activity → Live Events. If using PostHog Cloud, verify the host is `https://us.i.posthog.com` (not `http://`).

## Related

- [PostHog Spec](../spec/posthog.md) — architecture decision, capture contract, event envelope
- [Event Taxonomy v0](../analytics/events.v0.md) — event names and payload schemas
- [Developer Setup](./developer-setup.md) — full repo onboarding
