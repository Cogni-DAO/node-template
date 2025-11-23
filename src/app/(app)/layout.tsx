// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/layout`
 * Purpose: Auth guard layout for protected application pages.
 * Scope: Client layout component that enforces authentication for all routes under (app). Does not handle business logic or page content.
 * Invariants: Requires valid Auth.js session to render children; redirects unauthenticated users to home; shows loading state during auth check.
 * Side-effects: IO (Auth.js session retrieval via client hook, Next.js navigation)
 * Notes: All pages under (app)/* automatically require authentication. Do NOT add per-page auth checks. Uses client-side auth to avoid Next.js 15 async headers issue.
 * Links: docs/SECURITY_AUTH_SPEC.md, Next.js route groups
 * @public
 */

"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import type { ReactNode } from "react";
import { useEffect } from "react";

import { container, section } from "@/components";

export default function AppLayout({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const { status } = useSession();
  const router = useRouter();

  // Redirect unauthenticated users to home
  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/");
    }
  }, [status, router]);

  // Loading state
  if (status === "loading") {
    return (
      <div className={section()}>
        <div className={container({ size: "lg" })}>
          <div className="text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  // Redirect in progress or no session
  if (status === "unauthenticated") {
    return null;
  }

  // Authenticated: render children
  return <>{children}</>;
}
