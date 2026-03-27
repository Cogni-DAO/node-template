---
id: task.0223
type: task
title: "Serve key documentation at public URLs for AI agent consumption"
status: needs_design
priority: 2
rank: 20
estimate: 2
summary: "Expose architecture, x402, and attribution specs at public web URLs so llms.txt and agent.json can link to served pages instead of GitHub blob URLs."
outcome: "llms.txt Optional section links resolve to actual served pages on the node's domain. AI agents can read our docs without leaving the site. Specs are rendered as clean HTML or served as raw markdown."
spec_refs: []
assignees: []
credit:
project: proj.x402-e2e-migration
branch:
pr:
reviewer:
created: 2026-03-27
updated: 2026-03-27
labels: [docs, discovery, ai-agents]
external_refs: []
revision: 0
blocked_by: []
deploy_verified: false
---

## Context

The discovery files (llms.txt, agent.json) reference documentation specs that currently only exist as markdown files in the GitHub repo (`docs/spec/*.md`). These are not served by the web app — an AI agent following the links would get a 404.

Current workaround: links point to `https://github.com/Cogni-DAO/node-template/blob/main/docs/spec/...` which works but sends agents to GitHub instead of keeping them on our domain.

## Design Notes

Options (simplest first):
1. **Static copy to `public/docs/`** — copy key specs to `apps/web/public/docs/` at build time. Simplest, but stale if specs change.
2. **API route that reads and serves markdown** — `GET /api/v1/public/docs/[...slug]` reads from `docs/` and returns raw markdown. Dynamic, but needs path traversal protection.
3. **MkDocs / Docusaurus static site** — full docs site. Best UX, highest effort. Probably overkill for now.
4. **Build-time generation** — script copies select specs to `public/` during `pnpm build`.

Recommendation: Option 4 (build-time copy) for P0. A small script in `scripts/` copies the key specs to `apps/web/public/docs/` during build. llms.txt links update to `/docs/spec/architecture.md` etc. Stale risk is zero if it runs in CI.

## Key docs to serve

- `docs/spec/architecture.md` — system design
- `docs/spec/x402-e2e.md` — payment architecture
- `docs/spec/attribution-ledger.md` — how agents earn ownership
- `docs/spec/identity-model.md` — identity primitives
- `CONTRIBUTING.md` — how to contribute

## Validation

- [ ] llms.txt Optional links resolve to served pages (not GitHub)
- [ ] agent.json attribution_ledger link resolves
- [ ] Docs render correctly (raw markdown or HTML)
- [ ] No path traversal vulnerability if using dynamic route
- [ ] Build-time script runs in CI
