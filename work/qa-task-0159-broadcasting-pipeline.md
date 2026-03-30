---
id: qa.task-0159
type: task
title: "QA: Broadcasting Pipeline E2E"
status: needs_implement
priority: 1
rank: 1
estimate: 1
summary: Manual QA test plan for the broadcasting pipeline (task.0159). Click-through verification of draft creation, optimization, review, and publish flows.
outcome: All test cases pass. Broadcasting pipeline works end-to-end with echo adapters.
project: proj.broadcasting
created: 2026-03-30
updated: 2026-03-30
labels: [qa, broadcasting]
---

# QA: Broadcasting Pipeline E2E

## Prerequisites

1. Start the dev stack:
   ```bash
   pnpm dev:stack:test:setup   # first time only — creates test DB + runs migrations
   pnpm dev:stack:test         # starts dev server + infrastructure
   ```
2. Seed billing accounts (required for draft creation):
   ```bash
   pnpm dev:seed:money
   ```
3. Open the app at `http://localhost:3000`
4. Sign in with a test account (any GitHub OAuth user)

## Test 1: Navigation

- [ ] Click the sidebar. Verify **"Broadcast"** appears in the navigation with a radio icon.
- [ ] Click it. Verify you land on `/broadcasting`.
- [ ] The page shows a heading "Broadcasting", a "New Draft" button, a status filter dropdown, and an empty table with text "No broadcasts yet. Create your first draft above."

## Test 2: Create a Low-Risk Draft

This tests the happy path: short content with few platforms = low risk = auto-approved.

- [ ] Click **"New Draft"**. A dialog opens with fields: Body (textarea), Title (text input), Target Platforms (toggle buttons).
- [ ] Enter body: `Launch day!`
- [ ] Leave title empty.
- [ ] Select platforms: **x** and **discord** (click both toggle buttons so they highlight).
- [ ] Click **"Create Draft"**.
- [ ] The dialog closes. The table now shows one row with:
  - Body: `Launch day!`
  - Status: **review** (badge)
  - Platforms: `x, discord`
  - A date in the Created column

**Expand the row** (click the chevron or row):

- [ ] Two platform post cards appear: one for **x**, one for **discord**.
- [ ] Each card shows:
  - Platform badge (e.g., "x")
  - Status badge: **approved** (green) — because low risk auto-approves
  - The optimized body starts with `[x] Launch day!` and `[discord] Launch day!` respectively (the echo optimizer prepends the platform name)
  - No risk badge visible (low risk = no badge shown)

## Test 3: Create a High-Risk Draft

This tests the review gate: URLs in content trigger high risk.

- [ ] Click **"New Draft"** again.
- [ ] Enter body: `Check out https://example.com for our launch!`
- [ ] Select platform: **x** only.
- [ ] Click **"Create Draft"**.
- [ ] Table shows a new row with status **review**.

**Expand the row:**

- [ ] One platform post card for **x**.
- [ ] Status badge: **pending_review** (yellow/warning).
- [ ] Risk badge: **high risk** (red/danger).
- [ ] Three buttons visible at the bottom of the card: **Approve**, **Reject**, **Edit**.

## Test 4: Approve a High-Risk Post (Publish)

Continuing from Test 3:

- [ ] Click **Approve** on the pending_review post.
- [ ] The card updates:
  - Status changes to **published** (green).
  - A "View on x" link appears (points to `https://echo.local/x/echo-x-...`).
  - The `reviewed: approved` text appears.
- [ ] The buttons (Approve/Reject/Edit) disappear (post is no longer pending_review).

## Test 5: Reject a Post

- [ ] Create another high-risk draft (use body with a URL, target **discord**).
- [ ] Expand the row. Click **Reject** on the pending_review post.
- [ ] Status changes to **rejected** (red).
- [ ] No "View on" link appears.
- [ ] Buttons disappear.

## Test 6: Edit and Approve

- [ ] Create another high-risk draft (URL in body, target **bluesky**).
- [ ] Expand the row. Click **Edit** on the pending_review post.
- [ ] A textarea appears pre-filled with the optimized body.
- [ ] Change the text to: `Edited content for Bluesky`
- [ ] Click **Submit Edit**.
- [ ] The card updates:
  - Status: **published** (edit decision auto-approves and publishes).
  - The optimized body now shows `Edited content for Bluesky` (the edited version).
  - "View on bluesky" link appears.
  - `reviewed: edited` text appears.

## Test 7: Status Filter

- [ ] After creating several drafts (from tests above), use the **status filter dropdown** at the top.
- [ ] Select "review" — only drafts in review status appear.
- [ ] Select "All statuses" — all drafts appear.

## Test 8: Idempotency (API Level)

This verifies PUBLISH_IS_IDEMPOTENT. Use browser dev tools or curl.

- [ ] Find a published post's messageId and postId from a previous test (inspect network tab or expand a published row).
- [ ] Send the same review/approve request again:
  ```bash
  curl -X POST http://localhost:3000/api/v1/broadcasting/{messageId}/posts/{postId}/review \
    -H "Content-Type: application/json" \
    -H "Cookie: <your session cookie>" \
    -d '{"decision": "approved"}'
  ```
- [ ] Response should be 200 with the post still showing `status: "published"` — no error, no double-publish.

## Test 9: Ownership Validation (API Level)

- [ ] Use a fake messageId that doesn't match the post:
  ```bash
  curl -X POST http://localhost:3000/api/v1/broadcasting/00000000-0000-0000-0000-000000000000/posts/{realPostId}/review \
    -H "Content-Type: application/json" \
    -H "Cookie: <your session cookie>" \
    -d '{"decision": "approved"}'
  ```
- [ ] Response should be an error (500 or the error message contains "not found for message").

## Test 10: Invalid Input Validation

- [ ] Send a draft with empty body:

  ```bash
  curl -X POST http://localhost:3000/api/v1/broadcasting \
    -H "Content-Type: application/json" \
    -H "Cookie: <your session cookie>" \
    -d '{"body": "", "targetPlatforms": ["x"]}'
  ```

  Expected: 400 with "Invalid input format".

- [ ] Send a draft with no platforms:

  ```bash
  curl -X POST http://localhost:3000/api/v1/broadcasting \
    -H "Content-Type: application/json" \
    -H "Cookie: <your session cookie>" \
    -d '{"body": "Hello", "targetPlatforms": []}'
  ```

  Expected: 400 with "Invalid input format".

- [ ] Send a review with invalid decision:
  ```bash
  curl -X POST http://localhost:3000/api/v1/broadcasting/{messageId}/posts/{postId}/review \
    -H "Content-Type: application/json" \
    -H "Cookie: <your session cookie>" \
    -d '{"decision": "invalid"}'
  ```
  Expected: 400 with "Invalid input format".

## Pass Criteria

All checkboxes above must be checked. Any failure should be filed as a bug with:

- The test number that failed
- Expected vs actual behavior
- Screenshot if UI-related
- Network request/response if API-related
