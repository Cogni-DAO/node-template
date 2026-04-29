---
name: contribute-to-cogni
description: E2E contributor contract for external agents submitting code to Cogni. Load this first. Covers the full lifecycle from worktree setup through candidate-a validation and PR acceptance. Use whenever an agent is contributing code to this repo.
---

# Cogni Contributor Contract

You are an external agent contributing code. Work is only accepted after **all 4 phases** complete.

At each phase: search the resource roots below for the relevant guides, specs, and skills — they exist. Follow them. Return to this loop.

## Resource Roots

- `.claude/skills/` — executable skills
- `.claude/commands/` — slash commands
- `work/charters/` — project charters and scope
- `work/items/` — work items (find yours or create one)
- `docs/guides/` — how-to guides
- `docs/spec/` — architecture and design specs
- `docs/runbooks/` — operational procedures

---

## Phase 1 — Implement

1. Worktree off `main`. Read `CLAUDE.md` and the `AGENTS.md` files for every dir you'll touch.
2. **Tie your work to exactly one work item. 1 work item ≈ 1 PR.** Prefer adopting an existing item over creating a new one (anti-sprawl).
   - Already assigned? Use it.
   - Looking for work? Browse `work/items/` / `work/projects/` (or `/work` UI) for `needs_implement` / `needs_design`.
   - New request that fits nothing existing? Create via the operator API:
     ```bash
     curl -X POST https://test.cognidao.org/api/v1/work/items \
       -H "Authorization: Bearer $API_KEY" -H "content-type: application/json" \
       -d '{"type":"task","title":"<short>","node":"<node>","summary":"<why>"}'
     # → { "id": "task.NNNN" }   (≥5000, server-allocated)
     ```
     Keep the item lean: a one-line `outcome` describing successful E2E validation (a user-facing capability, or a specific response after repro condition X). Decompose only via `/design` if the task can't ship as one PR — don't fan out child tasks.
3. Find and follow the relevant lifecycle skills: `/triage → /design → /implement → /closeout`. PATCH the work item with `branch` + `pr` + `status` as you progress so `dolt_log` reflects state.
4. `pnpm check:fast` must pass. Push branch. `gh pr create` with a conventional commit title.

## Phase 2 — Flight Request

5. Wait until all required CI checks are green on your PR head SHA.
6. Discover the operator: `GET https://test.cognidao.org/.well-known/agent.json`
7. Register: `POST /api/v1/agent/register { "name": "<your-agent>" }` → `apiKey`
8. Request flight: `POST /api/v1/vcs/flight { "prNumber": N }` → 202 or 422 (CI not green).

## Phase 3 — Self-Validate

9. Wait for the `candidate-flight` check to appear on your PR head.
10. Execute your Phase 1 validation checklist against `https://test.cognidao.org`.
11. Query Loki for your request at the deployed SHA.
12. Post a PR comment with: endpoint hit, response received, Loki line. This is the real gate.
13. If validation fails: fix, push, repeat from Phase 1. Stale PRs with failed validation are closed.

## Phase 4 — Merge + Close

14. Mark PR "ready for review" only after the validation comment is posted and green.
15. Cogni operator reviews and merges.
16. **Only after merge to `main`:** PATCH `status: done` on the work item. Pre-merge → status stays `needs_merge`. Review-rejected → status flips back to `needs_implement` (address feedback, push, re-validate). _vNext: close gate moves to "promoted to production" once that lane is wired._

---

**PRs are never "ready for review" before Phase 3 is complete.**
