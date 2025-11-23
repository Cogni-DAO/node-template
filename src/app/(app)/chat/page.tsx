// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/chat/page`
 * Purpose: Protected chat page displaying authenticated session.
 * Scope: Client component that displays wallet address and session status. Does not implement chat functionality yet. Does NOT handle authentication - enforced by (app)/layout.tsx.
 * Invariants: Session guaranteed by (app)/layout auth guard.
 * Side-effects: IO (Auth.js session retrieval via client hook)
 * Notes: MVP scaffold - displays wallet address in terminal frame; chat UI coming soon. Auth enforced by parent layout, not by this page. Uses client component due to Next.js 15 async headers issue with server auth() in client layout context.
 * Links: docs/SECURITY_AUTH_SPEC.md, src/app/(app)/layout.tsx
 * @public
 */

"use client";

import { useSession } from "next-auth/react";
import type { ReactNode } from "react";

import { container, section } from "@/components";
import { Terminal } from "@/features/chat/components/Terminal";

export default function ChatPage(): ReactNode {
  const { data: session } = useSession();
  const walletAddress =
    session?.user?.walletAddress ?? session?.user?.id ?? "Unknown";

  return (
    <div className={section()}>
      <div className={container({ size: "lg", spacing: "xl" })}>
        <div className="mx-auto max-w-[var(--size-container-lg)]">
          <Terminal walletAddress={walletAddress} />
        </div>
      </div>
    </div>
  );
}
