// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@components/kit/data-display/KpiBadgeRow`
 * Purpose: Horizontal row of KPI badges for hero/footer dashboards.
 * Scope: Layout container for multiple KPI badges. Does not handle data fetching or badge logic.
 * Invariants: Responsive flex layout; centered alignment; handles empty state gracefully.
 * Side-effects: none
 * Notes: Used in hero sections and dashboard displays. Wraps and centers KPI badges responsively.
 * Links: src/components/kit/data-display/KpiBadge.tsx
 * @public
 */

import type { ReactElement } from "react";

import { kpiBadgeRow } from "@/styles/ui";

import { KpiBadge, type KpiBadgeProps } from "./KpiBadge";

interface KpiBadgeRowProps {
  /** Array of KPI badge configurations */
  badges: KpiBadgeProps[];
}

/**
 * Horizontal row of KPI badges with responsive layout
 */
export function KpiBadgeRow({ badges }: KpiBadgeRowProps): ReactElement | null {
  if (!badges.length) return null;

  return (
    <div className={kpiBadgeRow()}>
      {badges.map((badge, idx) => (
        <KpiBadge key={`${badge.label ?? badge.imageSrc ?? idx}`} {...badge} />
      ))}
    </div>
  );
}
