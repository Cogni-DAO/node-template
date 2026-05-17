---
id: upstream-sync.create-service-docs.handoff
type: handoff
status: open
created: 2026-05-17
updated: 2026-05-17
branch: (none yet — create off main)
last_commit: af131b919 (main)
---

# Handoff: Port cogni-poly #54 — create-service.md v0

## Context

This is the doc-sync companion to [PR #17](https://github.com/Cogni-DAO/node-template/pull/17)
which ported the CI/CD bug fixes (cogni-poly #81 + #82). PR #17 ports the
**wire-level** machinery (`classify-pr-build-state.sh` + flight-preview
classify path); this handoff ports the **conceptual companion** — the guide
that explains how to add a new deployable service through that machinery.

Both belong together. They were split only because PR #17 maintained "clean
ports only" scope and the create-service doc requires manual conflict
resolution.

## What to port

**cogni-poly PR #54**: https://github.com/Cogni-DAO/cogni-poly/pull/54
**Merge commit**: `16a541b8ef42bf11343ffe4f14e1f234326d11de`

Touches two files, both of which exist in node-template and have diverged:

- `docs/guides/create-service.md` — v0 standardization for adding any new
  deployable service. 5-shape decision tree (standalone k8s deployment /
  sibling container / MCP server / legacy Compose / cron one-shot) + the
  end-to-end pipeline spine (Author → PR Build → Candidate-A Flight →
  Preview Promote → Production Promote).
- `work/projects/proj.cicd-services-gitops.md` — adds blockers #23–28
  covering gaps the guide surfaces. Several are flagged upstream-relevant
  for node-template.

## Conflict shape (when I tried cherry-pick)

```
$ git cherry-pick 16a541b8
Auto-merging docs/guides/create-service.md
CONFLICT (content): Merge conflict in docs/guides/create-service.md
```

`git diff --check` reported **18 conflict markers across one file**
(docs/guides/create-service.md). The `proj.cicd-services-gitops.md` change
applied cleanly (`M` in `git status`, not `UU`), but stayed staged behind
the unresolved file.

The conflicts cluster around the sidecar shape sections (cogni-poly's
canonical pattern moved from `3ee5913f8` → `ce9e5fc66`; node-template's
guide may still reference earlier commits or have a different precedent).

## Suggested approach

1. **Branch**: `git checkout origin/main -b <yourname>/upstream-sync-create-service`
2. **Read both versions in full first** — `docs/guides/create-service.md` in
   node-template, and in cogni-poly main (`git show
cogni-poly/main:docs/guides/create-service.md`). Diverged for ~4 weeks;
   the resolution needs judgment, not mechanical merging.
3. **Cherry-pick** `16a541b8`, resolve conflicts manually:
   - For sections that exist in both: prefer cogni-poly's wording where it
     references current canonical commits (`ce9e5fc66`); preserve any
     node-template-specific examples or invariants that don't exist
     upstream.
   - For sections only in cogni-poly: include verbatim.
   - For sections only in node-template: keep.
4. **De-poly-ify examples**: cogni-poly references `poly-paper-sidecar`,
   `poly-test-worker`. node-template doesn't have those. Either:
   - Genericize the example (`<your-sidecar>`, `<your-service>`) — preferred
     for a template repo
   - Or keep poly references and note them as "from the upstream
     cogni-poly fork; analogous structure for any fork"
5. **`proj.cicd-services-gitops.md`**: review the new blockers #23–28
   added by #54. Some may already be resolved on node-template main (e.g.
   anything fixed by PR #14's bundle). Mark resolved-on-import; keep open
   items.
6. **Validation**: `pnpm check:fast` must pass; `pnpm check:docs` will
   catch any header/metadata regressions. There are no runtime tests for
   docs.
7. **PR title suggestion**: `docs(upstream-sync): port create-service.md v0
from cogni-poly #54`. Reference PR #17 in the body as the wire-level
   companion.

## Out of scope (do NOT bundle)

- catalog v2 cluster (cogni-poly #61, #70, #72, #75) — architectural
  change requiring its own design call. PR #17's description tracks this.
- #84 / #85 — depend on catalog v2 structures
- Genericizing other cogni-poly examples in unrelated docs — focus this PR
  on `create-service.md` + `proj.cicd-services-gitops.md` only.

## Reference

- Wire-level companion PR: https://github.com/Cogni-DAO/node-template/pull/17
- Source PR: https://github.com/Cogni-DAO/cogni-poly/pull/54
- Cross-reference of all `needs-upstream-sync` PRs lives in PR #17's body.
