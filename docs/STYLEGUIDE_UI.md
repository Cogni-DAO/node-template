# UI Style Guide

Purpose: consistent, testable UI with clean boundaries. Read this before adding or moving components.

## Directory model

- `src/components/ui/` — shadcn base. Treat as vendor. Do not edit.
- `src/components/primitives/` — stateless building blocks and wrappers around `ui/`.
- `src/components/widgets/` — composite, reusable UI (tables, terminal, markdown viewer).
- `src/components/layout/` — shells, headers, nav, footers.
- `src/components/overlays/` — modal, drawer, toast presenters.
- `src/components/forms/` — composed field groups and resolvers.
- `src/features/<slice>/components/` — slice-specific UI. Promote only after second consumer.

**Decision rule**: colocate first, promote on reuse.

## Boundaries

- UI may import: `shared`, `styles`, `types`, and feature-facing hooks/actions.
- UI must not import: `core`, `ports`, `adapters`, `contracts`, or DB/IO.
- Widgets can own local UI state only.

## Server vs client

- Mark client components: `"use client"`.
- Keep server-only logic in routes or loaders. Pass data as props.

## Styling rules

- Design tokens from `src/styles/` only.
- No arbitrary Tailwind values. No inline styles, except approved CSS vars.
- Use CVA for variants. Type variant props.

### Example

```tsx
// src/components/primitives/button.tsx
"use client";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/src/shared/util/strings";

const button = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium focus:outline-none focus:ring-1",
  {
    variants: {
      intent: { primary: "", secondary: "", ghost: "" },
      size: { sm: "h-8 px-3", md: "h-9 px-4", lg: "h-10 px-6" },
    },
    defaultVariants: { intent: "primary", size: "md" },
  }
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof button>;

export function Button({ className, intent, size, ...props }: ButtonProps) {
  return (
    <button className={cn(button({ intent, size }), className)} {...props} />
  );
}
```

## Naming conventions

- Folder name = component name in kebab-case. File `index.tsx` exports default.
- Variant prop names: `intent`, `tone`, `size`, `state`, `shape`, `elevation`.
- Keep public exports curated in `src/components/index.ts`.

## File headers

Top-of-file doc block:

```typescript
/**
 * Purpose: one sentence on the role.
 * Scope: what it owns; what it avoids.
 * Invariants: 1–3 guarantees (render shape, a11y, variant behavior).
 */
```

## Styling rules

- Design tokens from `src/styles/` only.
- No arbitrary Tailwind values. No inline styles, except approved CSS vars.
- Use CVA for variants. Type variant props.

Example:

```ts
// src/components/primitives/button.tsx
"use client";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/src/shared/util/strings";

const button = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium focus:outline-none focus:ring-1",
  {
    variants: {
      intent: { primary: "", secondary: "", ghost: "" },
      size: { sm: "h-8 px-3", md: "h-9 px-4", lg: "h-10 px-6" }
    },
    defaultVariants: { intent: "primary", size: "md" }
  }
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof button>;

export function Button({ className, intent, size, ...props }: ButtonProps) {
  return <button className={cn(button({ intent, size }), className)} {...props} />;
}
```

## Naming conventions

- Folder name = component name in kebab-case. File `index.tsx` exports default.
- Variant prop names: `intent`, `tone`, `size`, `state`, `shape`, `elevation`.
- Keep public exports curated in `src/components/index.ts`.

## File headers

Top-of-file doc block:

```typescript
/**
 * Purpose: one sentence on the role.
 * Scope: what it owns; what it avoids.
 * Invariants: 1–3 guarantees (render shape, a11y, variant behavior).
 */
```

## Accessibility

- Keyboard support on all interactive elements.
- Label every control. Use `aria-*` when needed.
- Color contrast meets WCAG AA.
- Focus outlines: never removed without a replacement.

## Testing

- **Primitives**: render smoke + variants snapshot.
- **Widgets**: interaction tests, no network.
- Avoid mocking CSS classes. Assert visible behavior.

## Performance

- Avoid re-renders: memoize stable children, event handlers.
- Defer heavy code with dynamic import at the route or widget boundary.
- No layout shift: set fixed dimensions or aspect ratios.

## Promotion policy

- **One route** → colocate under that route or its feature.
- **Second consumer** → move to `components/widgets`.
- **If it becomes stateless and generic** → `components/primitives`.

## Deprecated components

- Add `@deprecated` tag in header. Keep for one minor release.
- Replace in-call sites before removal.

## Review checklist (copy into PR)

- [ ] Directory placement correct?
- [ ] Imports within boundary?
- [ ] CVA variants typed and documented?
- [ ] A11y checks passed?
- [ ] Tests added and green?
- [ ] `components/index.ts` updated if public?
