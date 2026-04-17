---
id: task.0316
type: task
title: "Add per-node test:external lanes (poly, resy, node-template)"
status: needs_triage
priority: 3
rank: 99
estimate: 2
summary: "Only `nodes/operator/app` has a `vitest.external.config.mts` + `test:external` script. Other nodes put integration tests that touch local services (e.g. Ollama) into the default unit lane, relying on fragile runtime probes to skip. Give every node its own external lane so real-dep tests can live in a clearly-labeled `tests/external/` tree."
outcome: |
  Each node app (`nodes/poly/app`, `nodes/resy/app`, `nodes/node-template/app`) has:
    - `vitest.external.config.mts` mirroring the operator pattern (include `tests/external/**/*.external.test.ts`)
    - `test:external` script in its `package.json`
    - Ollama adapter specs moved to `tests/external/adapters/server/ai/openai-compatible/openai-compatible-llm.adapter.external.test.ts`
  Default unit lane has no runtime probes against local services.
  Root `pnpm test:external` either fans out to all node lanes or is documented as operator-only.
spec_refs:
  - docs/guides/testing.md
assignees: []
project: proj.system-test-architecture
created: 2026-04-16
updated: 2026-04-16
labels: [testing, infrastructure]
---

# task.0316 — Per-node test:external lanes

## Problem

Today only `nodes/operator/app` has an external-test lane:

- `nodes/operator/app/vitest.external.config.mts` globs `tests/external/**/*.external.test.ts`.
- Root `package.json` exposes `pnpm test:external` pointing at that config.
- `nodes/{poly,resy,node-template}/app` have no equivalent.

So integration tests in non-operator nodes end up in the default unit lane, where they have to self-gate at module load. The Ollama adapter spec is the concrete example: `describe.skipIf(!ollamaAvailable)` fails open on broken Ollama installs and reddens `pnpm check:fast` / the pre-push hook.

`fix/ollama-probe-gate` tightened the probe as an interim fix. The structural fix is a proper per-node lane.

## Outcome

- `vitest.external.config.mts` in each non-operator node app, matching the operator's include pattern + setup.
- `test:external` script per node + root fan-out (or explicit doc that per-node external runs are opt-in).
- Ollama adapter spec relocated from `tests/unit/adapters/server/ai/openai-compatible/openai-compatible-llm.adapter.spec.ts` to `tests/external/.../openai-compatible-llm.adapter.external.test.ts` in poly, resy, and node-template.
- Default unit lane no longer does HTTP probes at module load.

## Non-goals

- No change to the operator's existing external config.
- No new tests — just moving the ones we have.
- Not adding external coverage to CI.

## Validation

- `pnpm -F @cogni/poly-app test:external` (and resy, node-template) runs only the external lane and succeeds on a box with working Ollama.
- `pnpm check:fast` passes on a box with Ollama stopped or with a broken/missing model.
- `rg "skipIf(!ollamaAvailable)" tests/unit/` returns no results in any node.

## Notes

- Check `nodes/operator/app/tests/setup.ts` + `tests/component/setup/testcontainers-postgres.global.ts` for parts that are operator-specific (DB container) vs. reusable.
- Poly/resy/node-template probably don't need the testcontainers globalSetup — just the include + tsconfig-paths plugin + ipv4first. Keep the per-node config minimal.
- Consider whether the 4 Ollama spec copies should be deduplicated via a shared helper in a test-utils package. Out of scope here — note it and move on.
