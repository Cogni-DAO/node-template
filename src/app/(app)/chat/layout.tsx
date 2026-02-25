// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/chat/layout`
 * Purpose: Chat-specific layout that creates a fixed-height viewport container.
 * Scope: Wraps chat page with height constraints to pin composer to bottom. Uses `flex` (horizontal) to support sidebar + chat area layout. Does not affect other routes.
 * Invariants: Fills remaining height within SidebarInset; overflow-hidden prevents document scroll.
 * Side-effects: none
 * Notes: Uses flex-1 to fill the remaining space within the app layout (SidebarInset > AppTopBar > content area).
 * Links: src/app/(app)/chat/page.tsx
 * @public
 */

import type { ReactNode } from "react";

export default function ChatLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>): ReactNode {
  return <div className="flex flex-1 overflow-hidden">{children}</div>;
}
