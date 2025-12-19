# Build Architecture

> Scope: How the monorepo builds locally and in Docker. Critical knowledge for debugging build failures.

## Structure

```
cogni-template/          # Workspace root (Next.js app)
├── packages/
│   ├── aragon-osx/      # @cogni/aragon-osx (tsup → dist/)
│   └── cogni-contracts/ # @cogni/cogni-contracts (tsup → dist/)
└── pnpm-workspace.yaml  # Declares packages/* as workspace members
```

## Build Order

Workspace packages must build **before** the app because their exports point to `dist/`:

```
1. packages/*  →  tsup  →  dist/index.js + dist/index.d.ts
2. root app    →  next build  →  .next/standalone
```

## Local Build

```bash
pnpm -r --filter "./packages/**" build   # Build workspace packages
pnpm -w build                             # Build Next.js app (workspace root)
```

## Docker Build

The Dockerfile uses a single `builder` stage:

```dockerfile
COPY . .
pnpm install --frozen-lockfile

# 1. Build all packages (brute-force, not graph-scoped)
pnpm -r --filter "./packages/**" build

# 2. Build workspace root
pnpm -w build
```

**Why two commands:** Package builds run first to ensure `dist/` exists, then the root app build runs explicitly via `pnpm -w build` (workspace root flag).

## Critical Details

### Package Exports Require dist/

```json
// packages/*/package.json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js"
  }
}
```

If `dist/` doesn't exist, Next.js build fails with module resolution errors.

### tsup + composite: false

Package tsconfigs use `composite: true` for project references, but tsup's DTS generation conflicts with this. Fix:

```typescript
// packages/*/tsup.config.ts
dts: {
  compilerOptions: {
    composite: false,  // Workaround for TS6307
  },
}
```

### Fast vs Full Typecheck

Two tsconfigs exist for different scenarios:

| Config              | Command               | Includes                | Use Case                         |
| ------------------- | --------------------- | ----------------------- | -------------------------------- |
| `tsconfig.app.json` | `pnpm typecheck`      | `src/`, `scripts/` only | Fast checks (no packages needed) |
| `tsconfig.json`     | `pnpm typecheck:full` | Everything via `tsc -b` | Full build (packages must exist) |

**Why**: Root tsconfig uses project references to packages. Running `tsc --noEmit` on it requires `dist/` to exist (TS6305). The app-only config sidesteps this for fast iteration.

## Known Issues

| Issue                         | Impact                                                 | Workaround                                                                 |
| ----------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------- |
| Build not graph-scoped        | Builds all packages even if app doesn't depend on them | Acceptable for 2 packages; revisit with turbo prune if package count grows |
| AUTH_SECRET required at build | Next.js page collection triggers env validation        | Dockerfile sets placeholder; runtime must provide real value               |
| tsup + composite conflict     | Requires `composite: false` override in tsup config    | Empirical fix; future: evaluate tsc-only builds for packages               |

## Future Improvements

1. **Graph-scoped builds**: Adopt `turbo prune --docker` or `pnpm deploy` for minimal build context
2. **Runtime-only env validation**: Remove build-time env coupling by checking `NEXT_PHASE` or deferring validation
3. **App as workspace package**: Move app to `apps/web` for proper filter targeting (`pnpm --filter web... build`)
