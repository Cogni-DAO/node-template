# credits · AGENTS.md

> Scope: `src/app/(app)/credits` only. Keep ≤150 lines. Do not restate root policies.

## Purpose

Protected credits page composition and payment widget wiring. Server component loads repo-spec-driven widget config; client component renders DePay widget and payment flows.

## Boundaries

```json
{
  "layer": "app",
  "may_import": [
    "app",
    "features",
    "ports",
    "shared",
    "contracts",
    "styles",
    "components"
  ],
  "must_not_import": ["adapters/server", "adapters/worker", "core"]
}
```

## Responsibilities

- **Does:** Fetch widget config server-side via `@/shared/config` (repo-spec), render credits UI, pass config to client DePay widget, trigger confirm calls.
- **Does not:** Read env vars or repo-spec on the client; hardcode wallets or chain IDs; bypass confirm endpoint/business logic.

## Pointers

- [Root AGENTS.md](../../../AGENTS.md)
- [App AGENTS.md](../../AGENTS.md)
- [Repo-spec helper](../../../shared/config/repoSpec.server.ts)
- [Credits page client](./CreditsPage.client.tsx)

## Notes

- Changing wallet/chain/provider requires editing `.cogni/repo-spec.yaml` and redeploying; no env overrides.
- Client code must treat widget configuration as props only.
