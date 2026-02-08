# Handoff: Docs Reference Sweep

## Goal

Replace ~560 stale references to old `docs/UPPER_CASE_NAME.md` paths with the new typed paths (`docs/spec/`, `docs/guides/`, `work/initiatives/`). The doc content was migrated in prior PRs — this branch cleans up the references throughout the codebase.

## Status: Ready to execute

- **Branch:** `refactor/docs-ref-updates` (off `staging`)
- **Staged:** `work/issues/wi.refs-sweep.md` — the full work item with instructions
- **No commits yet on this branch**

## What to do

**Read `work/issues/wi.refs-sweep.md` first** — it contains everything:

1. A **mapping table** of old → new paths (top 30 by ref count)
2. **73 ready-to-run sed commands** sorted by ref count (highest first)
3. A **per-doc workflow**: dry-run grep → sed replace → verify grep
4. An **exclusion list** of 10 docs needing manual review (obsolete/roadmap-only)
5. **Safety rules** (preserve `> Source:` attribution lines, skip build artifacts, one phase per commit)
6. A **verification command** that should return zero when done

### Recommended commit strategy

The issue suggests phasing by file type (AGENTS.md → .ts → .md → config). But since the sed commands are mechanical and per-doc, you could also:

- Run ALL 73 sed commands in one pass across all file types
- Verify with the grep command
- Handle the 10 manual exclusions separately
- Commit per logical batch (your call on granularity)

## Key Files

| File                                       | Role                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------- |
| `work/issues/wi.refs-sweep.md`             | **The work item** — full instructions, sed commands, exclusion list        |
| `work/issues/wi.docs-migration-tracker.md` | Source of truth for all old → new mappings (Refs column tracks completion) |
| `docs/spec/SPEC_INDEX.md`                  | Index of all migrated specs                                                |

## Context

- 97 legacy docs were migrated from `docs/*.md` to `docs/spec/`, `docs/guides/`, `docs/research/`, and `work/initiatives/` across PRs #329-#341
- The migration tracker (`wi.docs-migration-tracker.md`) has a "Refs" column — currently `[ ]` for ~93 docs
- The sed commands in `wi.refs-sweep.md` handle the straightforward replacements (~490 refs)
- The remaining ~70 refs are in the "exclusion list" (obsolete docs, roadmap-only redirects) and need manual judgment
- `pnpm check:docs` must pass after every commit
- `> Source:` lines in initiatives are provenance records — do NOT update these
