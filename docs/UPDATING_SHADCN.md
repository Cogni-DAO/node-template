# Updating shadcn/ui

Goal: keep `components/ui/` close to upstream and isolate customizations outside it.

## Ground rules

- Do not edit files under `src/components/ui/`.
- Custom behavior belongs in wrappers under `primitives/` or compositions under `widgets/`.
- Public API is your wrapper, not the shadcn base.

## Initial setup

1. Initialize once at repo root:

   ```bash
   npx shadcn@latest init
   ```

2. Generate base components:

   ```bash
   npx shadcn@latest add button card input modal ...
   ```

3. Commit.

## Customization pattern

Wrap base components:

```typescript
// src/components/primitives/button.tsx
export { Button } from "@/src/components/ui/button"; // re-export or wrap with CVA
```

Or compose into widgets:

```typescript
// src/components/widgets/search-bar/index.tsx
import { Input } from "@/src/components/ui/input";
import { Button } from "@/src/components/primitives/button";
```

**Never fork the base file.** If you must, treat it as a temporary patch and migrate back to wrapper.

## Updating to new upstream

1. Create a branch `chore/shadcn-sync-YYYYMMDD`.

2. At repo root, run adds for the components you own:

   ```bash
   npx shadcn@latest add button card input modal ...
   ```

3. The CLI will overwrite base files. Accept overwrites for `components/ui/**`.

4. Run:

   ```bash
   pnpm typecheck && pnpm lint && pnpm test
   ```

5. Validate wrappers still compile and variants behave as before.

## Local diffs

To understand changes:

```bash
git diff -- components/ui
```

If an upstream rename happens, update your wrappers to re-export the new paths.

## Breaking changes policy

- If upstream breaks prop names or DOM, adapt in wrappers, keep your public API stable.
- Mark breaking changes in `CHANGELOG.md` under `### UI`.
- Add a codemod script only if required by many call sites.

## Adding a new base component

1. Run `npx shadcn@latest add <component>`.
2. Create a wrapper only if you need a Variant API or typed props.
3. Expose the wrapper from `src/components/index.ts`.

## Removing a base component

1. Remove all wrappers and call sites first.
2. Delete from `components/ui/` last to keep sync simple.
3. Update `components/index.ts`.

## Verifications in CI

- Block edits to `components/ui/**` except when the commit message includes `chore(shadcn): sync`.
- Optional: add a lint rule that treats imports from `components/ui/**` as internal-only. Public consumers must import from `src/components`.

## Common pitfalls

- Editing `components/ui/**` for quick fixes → later syncs are painful.
- Variant sprawl in wrappers → keep intent, size, and one optional dimension. Avoid boolean explosion.
- Exporting every base component publicly → curate. Export only what you support.

## Rollback

- If an update breaks layout or a11y, revert the branch.
- Open an issue summarizing the upstream change and the needed wrapper adaptation.
