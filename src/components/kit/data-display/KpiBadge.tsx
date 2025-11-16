// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@components/kit/data-display/KpiBadge`
 * Purpose: KPI badge primitive used for live metrics (coverage, quality gate, build status, etc).
 * Scope: Renders KPI metrics with standardized UI. Does not handle data fetching. Supports both text and external image content.
 * Invariants: No className forwarding; uses typed props only; external images are accessible.
 * Side-effects: none
 * Notes: Data source is external (Sonar, Shields, CI APIs, etc). UI is standardized via CVA factories.
 * Links: src/styles/ui/kpi-badge.ts, docs/UI_IMPLEMENTATION_GUIDE.md
 * @public
 */

import Image from "next/image";
import type { ReactElement } from "react";

import {
  kpiBadge,
  kpiBadgeImage,
  kpiBadgeLink,
  type KpiBadgeSize,
  type KpiBadgeTone,
} from "@/styles/ui";

type KpiBadgeKind = "text" | "external-image";

export interface KpiBadgeProps {
  /** Badge display mode */
  kind?: KpiBadgeKind;
  /** Visual tone for semantic meaning */
  tone?: KpiBadgeTone;
  /** Badge size */
  size?: KpiBadgeSize;

  // Common props
  /** Optional link URL */
  href?: string;
  /** Accessibility label */
  ariaLabel?: string;

  // kind === "text" props
  /** Text label for metric */
  label?: string;
  /** Metric value */
  value?: string;

  // kind === "external-image" props
  /** External badge image URL (e.g. SonarCloud, Shields.io) */
  imageSrc?: string;
  /** Alt text for external image */
  imageAlt?: string;
}

/**
 * KPI badge primitive for displaying live metrics
 */
export function KpiBadge({
  kind = "text",
  tone = "neutral",
  size = "sm",
  href,
  ariaLabel,
  label,
  value,
  imageSrc,
  imageAlt,
}: KpiBadgeProps): ReactElement {
  const content =
    kind === "external-image" && imageSrc ? (
      <Image
        src={imageSrc}
        alt={imageAlt ?? ariaLabel ?? label ?? ""}
        width={100}
        height={24}
        className={kpiBadgeImage()}
        unoptimized
      />
    ) : (
      <span className={kpiBadge({ tone, size })}>
        {label}
        {value ? `: ${value}` : ""}
      </span>
    );

  return href ? (
    <a
      href={href}
      aria-label={ariaLabel ?? label}
      target="_blank"
      rel="noopener noreferrer"
      className={kpiBadgeLink()}
    >
      {content}
    </a>
  ) : (
    content
  );
}
