# Authentication Architecture (Auth4 Goal)

This document outlines the roadmap to **Auth4**: a standardized, wallet-first authentication flow using **NextAuth v4** and the official **RainbowKit SIWE adapter**.

> [!IMPORTANT]
> This document supersedes previous v5 experiments. We are standardizing on **NextAuth v4** because the official RainbowKit SIWE adapter does not yet support v5.

## 🎯 Goal: Downgrade to NextAuth v4 & Adopt Canonical Adapter

We are downgrading from NextAuth v5 (Beta) to NextAuth v4 to support the official `@rainbow-me/rainbowkit-siwe-next-auth` adapter. This eliminates custom SIWE logic and aligns with the ecosystem standard.

### Version Matrix

| Package                                 | Version   | Notes                                  |
| :-------------------------------------- | :-------- | :------------------------------------- |
| `next-auth`                             | `^4.24.0` | **Downgrade from v5**. Stable release. |
| `@rainbow-me/rainbowkit`                | `^2.2.0`  | Existing dependency.                   |
| `@rainbow-me/rainbowkit-siwe-next-auth` | `^0.7.0`  | **New**. The official adapter.         |
| `siwe`                                  | `^2.0.0`  | Peer dependency for adapter.           |

### Implementation Checklist

- [x] **1. Downgrade & Dependencies**
  - [x] Uninstall `next-auth@beta`
  - [x] Install `next-auth@4`
  - [x] Install `@rainbow-me/rainbowkit-siwe-next-auth`

- [x] **2. Refactor Auth Configuration (v4 Style)**
  - [x] **[MODIFY] `src/auth.ts`**:
    - [x] Remove `NextAuth()` initialization.
    - [x] Export `authOptions: NextAuthOptions` instead.
    - [x] **CRITICAL**: `authOptions.secret` MUST be set to `process.env.AUTH_SECRET`.
    - [x] Remove `handlers`, `auth`, `signIn`, `signOut` exports.
    - [x] Keep `Credentials` provider logic (SIWE verification) but adapt types.

  - [x] **[MODIFY] `src/app/api/auth/[...nextauth]/route.ts`**:
    - [x] Import `NextAuth` from `next-auth/next`.
    - [x] Import `authOptions` from `@/auth`.
    - [x] **CRITICAL**: This is the ONLY place `NextAuth(authOptions)` is called.
    - [x] Export handler: `const handler = NextAuth(authOptions); export { handler as GET, handler as POST };`

- [x] **3. Server-Side Session Helper (v4)**
  - [x] **[NEW] `src/lib/auth/server.ts`**:
    - [x] Import `getServerSession` from `next-auth`.
    - [x] Import `authOptions` from `@/auth`.
    - [x] Export `getServerSessionUser()`:
      ```typescript
      export async function getServerSessionUser() {
        const session = await getServerSession(authOptions);
        // ... enforce wallet-first invariant ...
        return session?.user;
      }
      ```
  - [x] **[DELETE/MODIFY] `src/app/_lib/auth/session.ts`**:
    - [x] Make this a thin re-export of `src/lib/auth/server.ts` or delete it and update imports.
  - [x] **[MIGRATE]** Replace all usages of `auth()` or old helpers:
    - [x] API Routes -> use `getServerSessionUser()`

- [x] **4. Update Middleware (Edge)**
  - [x] **[MODIFY] `src/proxy.ts`** (Do NOT rename):
    - [x] Remove `auth()` wrapper (v5 specific).
    - [x] Use `getToken({ req, secret: process.env.AUTH_SECRET })` from `next-auth/jwt`.
    - [x] **CRITICAL**: Must use `process.env.AUTH_SECRET` explicitly.
    - [x] Maintain the `/api/v1/ai/*` protection logic.

- [x] **5. Update Provider Architecture**
  - [x] **[MODIFY] `src/app/providers/wallet.client.tsx`**:
    - [x] Import `RainbowKitSiweNextAuthProvider`.
    - [x] Wrap `RainbowKitProvider` with the SIWE adapter.
    - [x] Configure `getSiweMessageOptions`.
  - [x] **Boundary**: `RainbowKitSiweNextAuthProvider` owns the entire SIWE client flow (message, nonce, verify).

- [x] **6. Refactor WalletConnectButton**
  - [x] **[MODIFY] `src/components/kit/auth/WalletConnectButton.tsx`**:
    - [x] Remove custom `handleLogin`, `signMessage`, `signIn` logic.
    - [x] Remove `useEffect` for auto-login (handled by adapter).
    - [x] **Keep**: Wallet-session consistency check (force signOut on mismatch).
    - [x] **Constraint**: This component MUST NOT construct SIWE messages or call `signIn('credentials')`.

---

## 🔒 Strict Constraints & Invariants

To prevent regression to hybrid v4/v5 states, the following constraints must be strictly enforced:

### 1. Auth Configuration Exports

- **File**: `src/auth.ts`
- **Rule**: MUST export `authOptions` ONLY.
- **Forbidden**: `export const { auth, handlers, signIn, signOut } = NextAuth(...)`.
- **Why**: Prevents usage of v5-style helpers that don't work with the v4 adapter.

### 2. Route Handler Entrypoint

- **File**: `src/app/api/auth/[...nextauth]/route.ts`
- **Rule**: MUST be the **only** place where `NextAuth(authOptions)` is initialized.
- **Why**: Centralizes the auth runtime.

### 3. Server-Side Session Access

- **File**: `src/lib/auth/server.ts`
- **Rule**: All server-side session reads MUST use `getServerSessionUser()`.
- **Forbidden**: Direct usage of `getServerSession(authOptions)` in page/route logic (except within the helper).
- **Why**: Enforces the wallet-first invariant (session must have `walletAddress`) in one place.

### 4. Adapter Integration

- **File**: `src/app/providers/wallet.client.tsx`
- **Rule**: MUST wrap `RainbowKitProvider` with `RainbowKitSiweNextAuthProvider`.
- **Rule**: `getSiweMessageOptions` MUST be configured.
- **Forbidden**: Any component calling `signIn('credentials')` or manually building SIWE messages.

### 5. Session Shape

- **Location**: `src/auth.ts` (callbacks)
- **Rule**: `session.user.walletAddress` and `session.user.id` MUST be populated in the `session` callback.
- **Invariant**: If `walletAddress` is missing, the session is invalid.

### 6. Secret Consistency

- **Rule**: `process.env.AUTH_SECRET` is the single source of truth.
- **Guardrail**: Middleware (`getToken`) and NextAuth (`authOptions`) MUST use the exact same secret variable.

---

## 🏗️ Architecture & Context

### Core Principles

- **Strategy**: Wallet-first authentication via SIWE.
- **Engine**: NextAuth v4 (Stable).
- **Adapter**: `@rainbow-me/rainbowkit-siwe-next-auth`.
- **Sessions**: Stateless JWT sessions (no database session table).
- **Secret**: `AUTH_SECRET` is the single source of truth for JWT signing/verification.

### Server-Side Session Helper (v4)

We will replace the v5 `auth()` helper with a dedicated v4-compatible helper to ensure type safety and invariant enforcement.

**`src/lib/auth/server.ts`** (Canonical):

```typescript
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";

export async function getServerSessionUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.walletAddress) return null;
  return session.user;
}
```

### Dev Troubleshooting

#### Ghost Sessions

**Problem**: After a database reset (`pnpm dev:stack:db:reset`), your browser may still hold a valid JWT cookie pointing to a user ID that no longer exists in the database.
**Symptom**: Foreign key constraint violations when creating billing accounts or other resources.
**Policy**:

1.  If a valid JWT session refers to a `userId` that is missing from the `users` table, this is a **ghost session**.
2.  We do **NOT** auto-create users in billing or account adapters to fix this.
3.  The request should fail (500/logged) and developers should clear cookies and re-login.
    **Enforcement**: The billing/account layer (`getOrCreateBillingAccountForUser`) must assume the user row already exists.
