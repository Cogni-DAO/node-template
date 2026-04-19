// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/research/page`
 * Purpose: Copy-trade candidate research synthesis — static dossier.
 * Scope: Auth-gated shell; content is static client view.
 * Side-effects: IO (auth check)
 * Links: [ResearchView](./view), work/items/spike.0323.poly-copy-trade-candidate-identification.md
 * @public
 */

import { redirect } from "next/navigation";

import { getServerSessionUser } from "@/lib/auth/server";
import { ResearchView } from "./view";

export default async function ResearchPage() {
  const user = await getServerSessionUser();
  if (!user) {
    redirect("/");
  }
  return <ResearchView />;
}
