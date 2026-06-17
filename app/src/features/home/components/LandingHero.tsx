// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/home/components/LandingHero`
 * Purpose: Above-the-fold hero — animated backdrop, live status pill, gradient
 *   headline, value prop, CTAs, and the embedded AgentStream console.
 * Scope: Homepage hero. All copy comes from `../content`. Wires the primary CTA
 *   to the existing try-demo auth flow.
 * Invariants: Responsive; signed-out only (signed-in users are redirected by the page).
 * Side-effects: timers (live counter), opens auth modals via useTryDemo
 * Links: src/features/home/content.ts, src/features/home/components/AgentStream.tsx,
 *   src/features/home/hooks/useTryDemo.ts, src/components/vendor/shadcn-io/sparkles.tsx
 */

"use client";

import { ArrowRight, Github, TrendingUp } from "lucide-react";
import Link from "next/link";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";

import { Button } from "@/components";
// eslint-disable-next-line no-restricted-imports
import { SparklesCore } from "@/components/vendor/shadcn-io/sparkles";

import { HERO, HERO_LINKS } from "../content";
import { useTryDemo } from "../hooks/useTryDemo";

import { AgentStream } from "./AgentStream";

/** Live counter that ticks up to suggest continuous activity, then loops. */
function LiveCounter(): ReactElement {
  const [value, setValue] = useState(1);

  useEffect(() => {
    const interval = setInterval(() => {
      setValue((prev) => (prev >= 9999 ? 1 : prev + Math.floor(Math.random() * 7) + 1));
    }, 90);
    return () => clearInterval(interval);
  }, []);

  return (
    <span className="inline-flex items-center gap-2 font-mono text-sm tracking-widest">
      <span className="inline-block size-2 animate-pulse rounded-full bg-success" />
      <span className="text-success tabular-nums">
        {String(value).padStart(4, "0")}
      </span>
    </span>
  );
}

export function LandingHero(): ReactElement {
  const { handleTryDemo } = useTryDemo();

  return (
    <section className="relative flex w-full flex-col items-center justify-center overflow-hidden bg-background px-4 pt-28 pb-16 sm:px-6 sm:pt-32 sm:pb-20">
      {/* Animated particle backdrop, masked to fade at the edges */}
      <div className="pointer-events-none absolute inset-0 z-0">
        <SparklesCore
          id="hero-sparkles"
          background="transparent"
          minSize={0.4}
          maxSize={1}
          particleDensity={70}
          className="h-full w-full"
          // eslint-disable-next-line ui-governance/no-raw-colors -- tsparticles canvas needs a literal color; neutral white works on any brand hue
          particleColor="#FFFFFF"
        />
        {/* eslint-disable-next-line ui-governance/no-arbitrary-non-token-values -- radial mask fades particles out toward the edges */}
        <div className="absolute inset-0 h-full w-full bg-background [mask-image:radial-gradient(70%_60%_at_center,transparent_10%,white)]" />
      </div>

      <div className="relative z-10 mx-auto max-w-4xl text-center">
        {/* Status pill with live counter */}
        <div className="mb-8 inline-flex items-center gap-3 rounded-full border border-border/60 bg-background/60 px-4 py-2 backdrop-blur-sm">
          <TrendingUp className="size-3.5 text-primary" />
          <span className="text-muted-foreground text-xs uppercase tracking-widest">
            {HERO.statusLabel}
          </span>
          <LiveCounter />
        </div>

        {/* Headline */}
        <h1 className="font-bold text-4xl tracking-tight sm:text-6xl lg:text-7xl">
          <span className="text-foreground">{HERO.headlineTop}</span>
          <br />
          <span className="text-gradient-accent">{HERO.headlineAccent}</span>
        </h1>

        {/* Subhead */}
        <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground sm:text-xl">
          {HERO.subhead}
        </p>

        {/* CTAs */}
        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <Button size="lg" onClick={handleTryDemo}>
            {HERO.primaryCta}
            <ArrowRight className="ml-2 size-4" />
          </Button>
          <Button variant="outline" size="lg" asChild>
            <Link
              href={HERO_LINKS.chatUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg
                viewBox="0 0 127.14 96.36"
                fill="currentColor"
                className="mr-2 size-4"
                aria-hidden="true"
              >
                <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z" />
              </svg>
              Join the chat
            </Link>
          </Button>
          <Button variant="outline" size="lg" asChild>
            <Link href={HERO_LINKS.sourceUrl}>
              <Github className="mr-2 size-4" />
              Start your own
            </Link>
          </Button>
        </div>

        <span className="mt-6 block text-muted-foreground text-xs uppercase tracking-widest">
          {HERO.ctaTagline}
        </span>

        {/* Live agent stream */}
        <AgentStream />
      </div>
    </section>
  );
}
