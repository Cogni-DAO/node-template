// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/layout/components/AppHeader`
 * Purpose: Application header composing kit components and feature-specific widgets.
 * Scope: Public-page header. Renders logo, treasury, socials, session-aware account slot, theme toggle. Does not handle routing or analytics.
 * Invariants: No horizontal overflow; min-w-0/truncate/shrink-0 guards; GitHub hidden <lg; theme hidden <md; treasury always visible.
 * Side-effects: none
 * Notes: Lives in features/layout as app-shell composition that knows about treasury, account chrome, etc.
 * Links: src/features/layout/components/AccountSlot.tsx, src/styles/tailwind.css, docs/spec/onchain-readers.md
 * @public
 */

"use client";

import { Github } from "lucide-react";
import Link from "next/link";
import type { ReactElement } from "react";

import { ModeToggle } from "@/components";
import { TreasuryBadge } from "@/features/treasury/components/TreasuryBadge";
import { resolveBrandIcon } from "@/shared/brand/brandIcons";
import type { BrandMark } from "@/shared/config/repoSpec.server";

import { AccountSlot } from "./AccountSlot";

export function AppHeader({ brandMark }: { brandMark: BrandMark }): ReactElement {
  // Brand mark resolved from this node's repo-spec (passed by the server layout —
  // serializable {slug,icon,color}). Single source for the icon + color; forks set
  // the repo-spec fields and never hand-edit this JSX. Icon name → component here.
  const BrandIcon = resolveBrandIcon(brandMark.icon);
  const brandColor = brandMark.color ?? undefined;
  const slug = brandMark.slug;

  return (
    <header className="border-border border-b bg-background py-3">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded focus:bg-background focus:p-2 focus:text-foreground"
      >
        Skip to main content
      </a>
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          {/* Left side: Logo + Treasury */}
          <nav
            aria-label="Primary"
            className="flex min-w-0 items-center gap-3 sm:gap-4"
          >
            <Link
              href="/"
              aria-current="page"
              className="flex min-w-0 items-center gap-2 pl-4 sm:pl-0"
            >
              <BrandIcon
                className="size-6 shrink-0"
                color={brandColor}
                strokeWidth={2}
                aria-hidden="true"
              />
              <span className="hidden truncate font-bold text-xl md:inline">
                cogni
                <span className="text-gradient-accent">/{slug}</span>
              </span>
            </Link>

            <div className="flex">
              <TreasuryBadge />
            </div>
          </nav>

          {/* Right side: GitHub + Wallet + Theme */}
          <div className="flex shrink-0 items-center gap-3">
            <a
              href="https://github.com/cogni-dao"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Cogni on GitHub"
              className="hidden text-muted-foreground transition-colors hover:text-foreground lg:inline-flex"
            >
              <Github className="size-4" strokeWidth={1.5} aria-hidden="true" />
            </a>

            <AccountSlot showAppLink />

            <ModeToggle className="hidden md:flex" />
          </div>
        </div>
      </div>
    </header>
  );
}
