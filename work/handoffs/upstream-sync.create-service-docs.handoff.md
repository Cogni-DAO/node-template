---
id: upstream-sync.create-service-docs.handoff
type: handoff
status: blocked
created: 2026-05-17
updated: 2026-05-17
branch: (none — do not start until unblocked)
last_commit: af131b919 (main)
blocked_on: catalog-v2 port (cogni-poly #61 / #70 / #72 / #75)
---

# Handoff: Port cogni-poly #54 — create-service.md v0

## Status: BLOCKED on catalog-v2

The handoff's original premise — "port PR #54 as a standalone docs change" —
does not hold. PR #54 is the documentation **for** catalog v2. Importing it
into a catalog-v1 repo documents features that don't exist.

## Evidence

cogni-poly main's `docs/guides/create-service.md` (post-#54) opens with:

> "Catalog v2 playbook for adding a new image to the deployed stack (new
> deploy unit OR new image on an existing unit)"

Every Shape A example uses catalog v2 schema:

```yaml
schema_version: 2
name: <name>
deploy:
  candidate_a_branch: deploy/candidate-a-<name>
  preview_branch: deploy/preview-<name>
  production_branch: deploy/production-<name>
  path_prefix: services/<name>/
  port: 9000
images:
  - name: <name>
    role: app
    dockerfile: services/<name>/Dockerfile
    image_name: ghcr.io/cogni-dao/cogni-poly
    image_tag_suffix: "-<name>"
```

Node-template's `infra/catalog/scheduler-worker.yaml` is catalog v1 (flat
top-level keys: `image_tag_suffix`, `migrator_tag_suffix`, `path_prefix`,
deploy branches, no `images[]` array, no `schema_version`). Same for
`infra/catalog/node-template.yaml`.

PR #17's body already classifies catalog v2 (cogni-poly #61 / #70 / #72 /
#75) as deferred — "architectural refactor; out of scope for 'clearly
porting only'. Needs its own design call." PR #54 inherits that block —
it's the docs surface of the same refactor.

The companion `proj.cicd-services-gitops.md` additions (#54's blockers
#23–28) also lean on v2 mechanics: #25 references catalog-v2 sidecar
roles, #26 talks about overlay-only flight for sidecar-only PRs, #28
references node-domain catalog paths. Only #23 (`promote-k8s-image.sh`
image-name-blind), #24 (AppSet wildcard generators), and #27 (CronJob
template) are v2-independent enough to port standalone — but porting
half-a-set of blockers into a tracker is a worse outcome than leaving the
tracker in lock-step with cogni-poly post-v2-port.

## Unblock criteria

Land a catalog v2 port PR first:

1. Pick up cogni-poly #61 → #70 → #72 → #75 as a single port (the original
   commits, not a rewrite). Adapt poly-specific paths/names; preserve the
   v2 schema, the new `lib/image-tags.sh` API surface
   (`image_tag_for_image` etc.), and the multi-image snapshot/restore TSV
   format documented in the devops-expert skill's Known Gaps.
2. After catalog v2 is in node-template, port #54 — the conflicts should
   collapse since both files will reference v2 idioms.
3. Then port #84 (retag word-prefix collision) and #85 (placeholder-fill
   self-heal) which depend on v2's multi-image overlay shape.

## Reference

- Wire-level companion PR (already shipped scope-wise): https://github.com/Cogni-DAO/node-template/pull/17
- Source PR: https://github.com/Cogni-DAO/cogni-poly/pull/54
- Catalog v2 cluster: cogni-poly #61, #70, #72, #75
- Dependent ports awaiting v2: #84, #85
- Devops-expert Known Gaps section (added in PR #17) documents the v2
  rename surface to watch for when porting.
