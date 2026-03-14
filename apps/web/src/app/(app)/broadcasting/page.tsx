// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/broadcasting/page`
 * Purpose: Broadcasting dashboard page shell — auth check and client view render.
 * Scope: Auth check only. Data fetching handled client-side via React Query.
 * Invariants: Protected route (server-side auth check).
 * Side-effects: none
 * Links: [BroadcastingView](./view.tsx)
 * @public
 */

import { redirect } from "next/navigation";

import { getServerSessionUser } from "@/lib/auth/server";
import { BroadcastingView } from "./view";

export default async function BroadcastingPage() {
  const user = await getServerSessionUser();
  if (!user) {
    redirect("/");
  }

  return <BroadcastingView />;
}
