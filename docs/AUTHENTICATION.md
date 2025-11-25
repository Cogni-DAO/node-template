# Authentication

## Current UX (MVP): Connect vs Verify vs Session

The current authentication flow involves a 2-step sequence after a true disconnect or permission revocation:

1.  **Wallet Connection**: The user approves the site in their wallet (e.g., MetaMask "Connect this website").
2.  **Session Verification**: The user is presented with the "Verify your account" modal (RainbowKit's built-in SIWE UI) and must click "Sign message" to trigger the wallet signature prompt.

This "Verify your account" modal appears when the wallet is **connected** but the NextAuth session is **unauthenticated**. It is a standard part of the [RainbowKit Authentication](https://rainbowkit.com/docs/authentication) flow and ensures the user explicitly consents to signing in.

We use the stock [RainbowKit ConnectButton](https://rainbowkit.com/docs/connect-button) for the MVP, which enforces this behavior.

## Invariants: Wallet-Session Coherence

**Disconnecting or switching the wallet invalidates the SIWE session.**

Since the wallet address is the canonical identity for billing and credits, we enforce strict coherence to prevent confusion (e.g., user thinks they are paying with Wallet A but are actually signed in as Wallet B).

- If the wallet disconnects -> The session is signed out.
- If the wallet switches to a different address -> The session is signed out.

## Known UX problems (intentional, MVP-tolerated)

### Problem A — Sign-in has two sections

- **Section 1**: MetaMask "Connect this website" (wallet permission).
- **Section 2**: RainbowKit "Verify your account" modal + MetaMask SIWE "Sign-in request" (signature).
- **Issue**: This feels disjoint because the intermediate step is a separate in-app modal requiring another click ("Sign message").

### Problem B — Only Disconnect exists (no session-only Sign Out)

- We currently rely on RainbowKit "Disconnect", which removes the wallet connection/permission.
- **Result**: Next time, the user must do both steps again (connect approval + SIWE signature).
- **Desired future**: Add a session-only "Sign out" that clears the NextAuth session but leaves the wallet connected, so re-login is typically just one SIWE signature prompt.

## Planned evolution (post-MVP): Custom header control to remove disjoint flow

To remove the extra click and disjoint flow, we plan to:

1.  Adopt [RainbowKit Custom ConnectButton](https://rainbowkit.com/docs/custom-connect-button) (`ConnectButton.Custom`) to gain full control over the UI.
2.  Automatically trigger the SIWE signature prompt immediately after wallet connection, bypassing the "Verify your account" modal step.
3.  Add two explicit actions in the UI:
    - **Sign out**: Clears the NextAuth session (using [NextAuth client API](https://next-auth.js.org/getting-started/client)).
    - **Disconnect wallet**: Fully disconnects the wallet.

This evolution is UI-level only; it will **not** introduce bespoke SIWE message creation or bypass the RainbowKit SIWE adapter.
