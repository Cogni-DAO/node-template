// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/home/components/ShowcaseCards`
 * Purpose: Showcase section — eyebrow + heading, category filter pills, and a
 *   grid of cards describing what the node tracks / produces.
 * Scope: Presentational. All copy + data from `../content`. Category pills filter
 *   the grid client-side.
 * Invariants: Two-segment bar values per card should sum to ~100.
 * Side-effects: none
 * Links: src/features/home/content.ts
 */

"use client";

import { cn } from "@cogni/node-ui-kit/util/cn";
import { motion } from "framer-motion";
import { TrendingDown, TrendingUp } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";

import {
  SHOWCASE_CATEGORIES,
  SHOWCASE_ITEMS,
  SHOWCASE_SECTION,
  type ShowcaseItem,
  type ShowcaseOutcome,
} from "../content";

function SplitBar({
  outcomes,
}: {
  outcomes: [ShowcaseOutcome, ShowcaseOutcome];
}): ReactElement {
  const [a, b] = outcomes;
  return (
    <div className="flex gap-1.5">
      <div
        className="flex items-center justify-center rounded-md bg-success/15 py-2 font-mono text-success text-xs transition-all"
        // eslint-disable-next-line no-inline-styles/no-inline-styles -- data-driven bar width cannot be a static token
        style={{ width: `${a.value}%` }}
      >
        {a.value > 15 && <span>{`${a.label} ${a.value}`}</span>}
      </div>
      <div
        className="flex items-center justify-center rounded-md bg-destructive/15 py-2 font-mono text-destructive text-xs transition-all"
        // eslint-disable-next-line no-inline-styles/no-inline-styles -- data-driven bar width cannot be a static token
        style={{ width: `${b.value}%` }}
      >
        {b.value > 15 && <span>{`${b.label} ${b.value}`}</span>}
      </div>
    </div>
  );
}

function ChangeBadge({ change }: { change: number }): ReactElement {
  const isUp = change > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 font-mono text-xs",
        isUp ? "text-success" : "text-destructive"
      )}
    >
      {isUp ? (
        <TrendingUp className="size-3" />
      ) : (
        <TrendingDown className="size-3" />
      )}
      {isUp ? "+" : ""}
      {change}%
    </span>
  );
}

function Card({
  item,
  delay,
}: {
  item: ShowcaseItem;
  delay: number;
}): ReactElement {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay }}
      className="rounded-lg border border-border/40 bg-card p-4 sm:p-5"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded-sm bg-secondary px-1.5 py-0.5 font-mono text-muted-foreground text-xs uppercase tracking-wider">
              {item.category}
            </span>
            <span className="text-muted-foreground/50 text-xs">
              {item.source}
            </span>
          </div>
          <h3 className="font-semibold text-foreground text-sm leading-snug sm:text-base">
            {item.title}
          </h3>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-bold font-mono text-foreground text-lg tabular-nums sm:text-xl">
            {item.metric}
          </div>
          <ChangeBadge change={item.change} />
        </div>
      </div>

      <SplitBar outcomes={item.outcomes} />

      <div className="mt-3 flex items-center justify-between">
        <span className="font-mono text-muted-foreground/60 text-xs uppercase tracking-wider">
          {item.footerLeft}
        </span>
        <span className="font-mono text-muted-foreground/60 text-xs uppercase tracking-wider">
          {item.footerRight}
        </span>
      </div>
    </motion.div>
  );
}

export function ShowcaseCards(): ReactElement {
  const [active, setActive] = useState<string>(SHOWCASE_CATEGORIES[0]);
  const items =
    active === SHOWCASE_CATEGORIES[0]
      ? SHOWCASE_ITEMS
      : SHOWCASE_ITEMS.filter((m) => m.category === active);

  return (
    <section id="showcase" className="w-full bg-background py-20 md:py-28">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="mb-12"
        >
          <span className="font-mono text-primary text-xs uppercase tracking-widest">
            {SHOWCASE_SECTION.eyebrow}
          </span>
          <h2 className="mt-3 font-bold text-3xl tracking-tight sm:text-4xl">
            {SHOWCASE_SECTION.heading}
          </h2>
          <p className="mt-3 max-w-lg text-muted-foreground">
            {SHOWCASE_SECTION.subhead}
          </p>
        </motion.div>

        {/* Category pills */}
        <div className="mb-6 flex flex-wrap gap-2">
          {SHOWCASE_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActive(cat)}
              className={cn(
                "rounded-full px-3 py-1 font-mono text-xs uppercase tracking-wider transition-colors",
                cat === active
                  ? "bg-primary/15 text-primary"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              )}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Card grid */}
        <div className="grid gap-4 sm:grid-cols-2">
          {items.map((m, i) => (
            <Card key={m.id} item={m} delay={i * 0.08} />
          ))}
        </div>
      </div>
    </section>
  );
}
