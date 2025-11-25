# src/components/kit/auth · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derek
- **Last reviewed:** 2025-11-26
- **Status:** stable

## Purpose

Authentication UI components and hooks. Provides the wallet connection button and session consistency logic.

## Pointers

- [Root AGENTS.md](../../../../AGENTS.md)
- [Authentication](../../../../docs/AUTHENTICATION.md)

## Boundaries

```json
{
  "layer": "components",
  "may_import": ["shared"],
  "must_not_import": ["features", "core", "ports", "adapters"]
}
```

## Public Surface

- **Exports:**
  - `WalletConnectButton` - SafeWalletConnectButton (exported as WalletConnectButton) - SSR-safe wrapper with placeholder
  - `useWalletSessionConsistency` - Hook to enforce wallet-session synchronization
- **Routes (if any):** none
- **CLI (if any):** none
- **Env/Config keys:** none
- **Files considered API:** `WalletConnectButton.tsx`, `SafeWalletConnectButton.tsx`, `useWalletSessionConsistency.ts`

## Responsibilities

- This directory **does**: Provide UI for wallet connection; enforce consistency between wallet state and auth session
- This directory **does not**: Implement auth providers; handle server-side sessions

## Usage

```tsx
import { WalletConnectButton } from "@/components/kit/auth/WalletConnectButton";

<WalletConnectButton />;
```

## Standards

- Components must be client-side ("use client")
- Uses `useWalletSessionConsistency` to handle sign-out on wallet change

## Dependencies

- **Internal:** `@/shared/auth`
- **External:** `@rainbow-me/rainbowkit`, `wagmi`, `next-auth/react`

## Change Protocol

- Update this file when **Public Surface** changes (new exports)
- Bump **Last reviewed** date
- Ensure new components maintain architectural boundaries

## Notes

- This directory contains the canonical wallet connection UI
- `WalletConnectButton` is designed to be used in the global header
- `SafeWalletConnectButton` handles dynamic loading to prevent layout shift and SSR errors
- `useWalletSessionConsistency` is a critical security control to prevent session hijacking via wallet switching
