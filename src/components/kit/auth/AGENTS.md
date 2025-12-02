# src/components/kit/auth · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derek
- **Last reviewed:** 2025-12-02
- **Status:** stable

## Purpose

Authentication UI components. Provides the wallet connection button using RainbowKit.

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
  - `WalletConnectButton` - RainbowKit ConnectButton with variant prop (default | compact)
  - `SafeWalletConnectButton` - SSR-safe wrapper (exported as "WalletConnectButton" via components/index.ts)
- **Routes (if any):** none
- **CLI (if any):** none
- **Env/Config keys:** none
- **Files considered API:** `WalletConnectButton.tsx`, `SafeWalletConnectButton.tsx`

## Responsibilities

- This directory **does**: Provide UI for wallet connection via RainbowKit with responsive variants for mobile overflow prevention
- This directory **does not**: Implement auth providers; handle server-side sessions; auto sign-out; stable wallet slot rendering (see HANDOFF_WALLET_BUTTON_STABILITY.md)

## Usage

```tsx
import { WalletConnectButton } from "@/components";

// Default: full address/balance when connected
<WalletConnectButton />

// Compact: avatar-only, no balance (mobile)
<WalletConnectButton variant="compact" className="sm:hidden" />
```

## Standards

- Components must be client-side ("use client")
- Sign-out is explicit user action only - no auto sign-out based on wallet state
- Follow RainbowKit best practices: global provider, explicit connect/disconnect flows

## Dependencies

- **Internal:** none
- **External:** `@rainbow-me/rainbowkit`

## Change Protocol

- Update this file when **Public Surface** changes (new exports)
- Bump **Last reviewed** date
- Ensure new components maintain architectural boundaries

## Notes

- This directory contains the canonical wallet connection UI
- `WalletConnectButton` is designed to be used in the global header
- `SafeWalletConnectButton` handles dynamic loading to prevent layout shift and SSR errors
- Auth session is source of truth; wallet connection is ephemeral
