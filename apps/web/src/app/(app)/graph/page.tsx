// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/graph/page`
 * Purpose: Graph visualization page shell — auth gate + view mount.
 * Scope: Auth check only. Does not fetch data or implement business logic.
 * Invariants: Protected route (server-side auth check).
 * Side-effects: IO
 * Links: [GraphView](./view.tsx)
 * @public
 */

import { redirect } from "next/navigation";

import { getServerSessionUser } from "@/lib/auth/server";
import { GraphView } from "./view";

export default async function GraphPage() {
  const user = await getServerSessionUser();
  if (!user) {
    redirect("/");
  }

  return <GraphView />;
}
