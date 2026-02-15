# Bootstrap

Run once on first session to initialize governance runtime state.

## Filesystem Layout

- `/workspace/gateway/` — your workspace root (CWD)
- `/workspace/gateway/memory/` — ephemeral governance state (heartbeats, EDOs, budget gate)
- `/repo/current/` — codebase (read-only): `docs/`, `work/`, `src/`, `.openclaw/skills/`

When skills reference `memory/`, that's `/workspace/gateway/memory/`.
When skills reference `work/` or `docs/`, that's `/repo/current/work/` and `/repo/current/docs/`.

## Initialize Governance Memory

```bash
mkdir -p memory/COMMUNITY memory/ENGINEERING memory/SUSTAINABILITY memory/GOVERN memory/EDO
cp memory-templates/_budget_header.md memory/_budget_header.md
cp memory-templates/edo_index.md memory/edo_index.md
cp memory-templates/EDO.template.md memory/EDO/_template.md
cp memory-templates/COMMUNITY.heartbeat.md memory/COMMUNITY/heartbeat.md
cp memory-templates/ENGINEERING.heartbeat.md memory/ENGINEERING/heartbeat.md
cp memory-templates/SUSTAINABILITY.heartbeat.md memory/SUSTAINABILITY/heartbeat.md
cp memory-templates/GOVERN.heartbeat.md memory/GOVERN/heartbeat.md
```

After running, `memory/` is ready for governance skills.
