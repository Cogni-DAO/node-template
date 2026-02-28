// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(public)/AuthRedirect`
 * Purpose: Client-side redirect to /chat when session becomes authenticated (e.g., after SIWE sign-in).
 * Scope: Watches NextAuth session status and navigates on change. Renders nothing. Does not handle sign-out or session management.
 * Invariants: Only redirects on "authenticated" status; no render output.
 * Side-effects: IO (Next.js navigation)
 * Links: src/app/(public)/page.tsx
 * @public
 */

"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useRef } from "react";

export function AuthRedirect(): null {
  const { data: session, status } = useSession();
  const router = useRouter();
  const redirected = useRef(false);

  useEffect(() => {
    // Only redirect once per mount, and only when session has real user data.
    // Prevents redirect loops when useSession() flickers between states
    // during session transitions (SIWE completion, JWT refresh, link callbacks).
    if (
      status === "authenticated" &&
      session?.user?.id &&
      !redirected.current
    ) {
      redirected.current = true;
      router.replace("/chat");
    }
  }, [status, session, router]);

  return null;
}
