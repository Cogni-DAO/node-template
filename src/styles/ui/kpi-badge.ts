// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@styles/ui/kpi-badge`
 * Purpose: KPI-specific badge styling factories for live metrics display.
 * Scope: Provides CVA factories for KPI badge components. Does not handle data fetching.
 * Invariants: All variants use design tokens; factories return valid Tailwind class strings; maintains semantic color coding.
 * Side-effects: none
 * Notes: Extends base badge styling with KPI-specific tones for coverage, quality gates, etc.
 * Links: src/styles/ui/data.ts, docs/UI_IMPLEMENTATION_GUIDE.md
 * @public
 */

import { cva, type VariantProps } from "class-variance-authority";

const kpiBadgeToneVariants = {
  neutral: "bg-muted text-muted-foreground border-border",
  success: "bg-success text-[var(--color-white)] border-transparent",
  warning: "bg-warning text-[var(--color-white)] border-transparent",
  danger: "bg-danger text-[var(--color-white)] border-transparent",
} as const;

const kpiBadgeSizeVariants = {
  sm: "text-[var(--text-xs)] px-[var(--spacing-sm)] py-[var(--spacing-xs)]",
  md: "text-[var(--text-xs)] px-[var(--spacing-md)] py-[var(--spacing-xs)]",
} as const;

/**
 * KPI badge styling for live metrics with semantic color coding
 */
export const kpiBadge = cva(
  "inline-flex items-center gap-[var(--spacing-xs)] rounded-full border font-medium transition-colors focus:outline-none focus:ring-[var(--ring-width-sm)] focus:ring-ring focus:ring-offset-[var(--ring-offset-w-sm)]",
  {
    variants: {
      tone: kpiBadgeToneVariants,
      size: kpiBadgeSizeVariants,
    },
    defaultVariants: {
      tone: "neutral",
      size: "sm",
    },
  }
);

/**
 * KPI badge row layout styling for multiple badges
 */
export const kpiBadgeRow = cva(
  "flex flex-wrap items-center justify-center gap-[var(--spacing-sm)]"
);

/**
 * KPI badge image styling for external badge images
 */
export const kpiBadgeImage = cva("w-auto h-[var(--size-icon-lg)]");

/**
 * KPI badge link styling for interactive badges
 */
export const kpiBadgeLink = cva(
  "inline-block hover:opacity-[var(--opacity-80)] transition-opacity"
);

// Export variant types for external use
export type KpiBadgeTone = VariantProps<typeof kpiBadge>["tone"];
export type KpiBadgeSize = VariantProps<typeof kpiBadge>["size"];
