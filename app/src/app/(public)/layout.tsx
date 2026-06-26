// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(public)/layout`
 * Purpose: Layout for public (unauthenticated) pages with header and footer.
 * Scope: Wraps children with AppHeader and AppFooter. Does not handle authentication or routing.
 * Invariants: Always renders header above and footer below children.
 * Side-effects: none
 * Links: src/features/layout/components/AppHeader.tsx, src/features/layout/components/AppFooter.tsx
 * @public
 */

import type { ReactNode } from "react";

import { AppFooter, AppHeader } from "@/features/layout";
import { getBrandMark } from "@/shared/config/repoSpec.server";

export default function PublicLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>): ReactNode {
  // Server-side, build-safe repo-spec read; passed to the (client) header as a
  // serializable prop so the header never imports server-only repo-spec IO.
  const brandMark = getBrandMark();
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader brandMark={brandMark} />
      <main className="flex-1">{children}</main>
      <AppFooter />
    </div>
  );
}
