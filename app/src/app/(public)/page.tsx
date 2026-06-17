// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(public)/page`
 * Purpose: Public landing page — a full, multi-section homepage (hero + live agent
 *   stream, showcase cards, activity feed, stats). Redirects signed-in users to /chat.
 * Scope: Server component that checks session and redirects or renders landing page. Does not handle authentication logic — proxy.ts handles primary auth routing; server-side check here is defense-in-depth.
 * Invariants: Responsive design. All editable copy/data lives in src/features/home/content.ts.
 * Side-effects: IO (session check, redirect)
 * Links: src/features/home/content.ts, src/features/home/components/*
 * @public
 */

import { redirect } from "next/navigation";
import type { ReactElement } from "react";

import { ActivityFeed } from "@/features/home/components/ActivityFeed";
import { HomeStats } from "@/features/home/components/HomeStats";
import { LandingHero } from "@/features/home/components/LandingHero";
import { ShowcaseCards } from "@/features/home/components/ShowcaseCards";
import { getServerSessionUser } from "@/lib/auth/server";

import { AuthRedirect } from "./AuthRedirect";

export default async function HomePage(): Promise<ReactElement> {
  const user = await getServerSessionUser();
  if (user) {
    redirect("/chat");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <AuthRedirect />
      <LandingHero />
      <ShowcaseCards />
      <ActivityFeed />
      <HomeStats />
    </div>
  );
}
