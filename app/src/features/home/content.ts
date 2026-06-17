// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/home/content`
 * Purpose: Single customization surface for the public landing page. ALL editable
 *   copy and placeholder data for the homepage lives here — hero, showcase cards,
 *   activity feed, and stats. The components in `./components/*` are layout only;
 *   they read everything from this file.
 * Scope: Public homepage content. No logic, no IO — pure data.
 * Invariants: Shapes are stable so layout components stay generic. Customize VALUES,
 *   not shapes, when minting a new node.
 * Side-effects: none
 * Links: src/features/home/components/LandingHero.tsx,
 *   src/features/home/components/ShowcaseCards.tsx,
 *   src/features/home/components/ActivityFeed.tsx,
 *   src/features/home/components/AgentStream.tsx,
 *   src/features/home/components/HomeStats.tsx
 * @public
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  ███  CUSTOMIZE YOUR NODE HERE  ███
 *
 *  This file is the homepage. To make the landing page yours, you edit WORDS in
 *  this file and the brand HUE in `src/styles/tailwind.css`. You should not need
 *  to touch the layout components for a first-class customization.
 *
 *  Walk top-to-bottom and replace every placeholder with copy + data that sells
 *  YOUR node's mission. A stranger should understand what this node is for in
 *  five seconds. See `docs/guides/new-node-styling.md` and the `node-styling`
 *  skill for the full playbook.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  Activity,
  BrainCircuit,
  CheckCircle,
  Network,
  Search,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

/* ─── HERO ────────────────────────────────────────────────────────────────
 * The first thing a visitor sees. `headline` renders as two lines; the second
 * line gets the brand gradient. Keep it short and declarative.
 */
export interface HeroContent {
  /** Tiny uppercase label inside the status pill at the top of the hero. */
  statusLabel: string;
  /** Line 1 of the headline (plain foreground color). */
  headlineTop: string;
  /** Line 2 of the headline (renders with the brand gradient). */
  headlineAccent: string;
  /** One- to two-sentence value prop under the headline. */
  subhead: string;
  /** Primary CTA — wired to the "try the demo" sign-in flow. */
  primaryCta: string;
  /** Small uppercase tagline shown next to the primary CTA. */
  ctaTagline: string;
}

export const HERO: HeroContent = {
  statusLabel: "Agent online",
  headlineTop: "Build something",
  headlineAccent: "community-owned.",
  subhead:
    "A community-built AI agent that researches, monitors, and acts on what matters to your mission — working in the open, accountable to the people it serves.",
  primaryCta: "Try the demo",
  ctaTagline: "Teach it. Guide it. Own it.",
};

/* ─── HERO LINKS ──────────────────────────────────────────────────────────
 * Secondary buttons in the hero. Point them at your community + source.
 */
export const HERO_LINKS = {
  chatUrl: "https://discord.gg/3b9sSyhZ4z",
  sourceUrl: "https://github.com/cogni-dao/cogni",
} as const;

/* ─── AGENT STREAM ────────────────────────────────────────────────────────
 * The live "console" embedded in the hero. Each sequence plays out like the
 * agent thinking in real time, then loops to the next. Rewrite these lines to
 * describe what YOUR agent actually does, step by step. Keep ~4-6 events each.
 */
export type StreamEventType =
  | "thinking"
  | "searching"
  | "analyzing"
  | "signal"
  | "done";

export interface StreamEvent {
  id: string;
  type: StreamEventType;
  text: string;
  /** ms offset from the start of the sequence when this line appears. */
  at: number;
}

/** Label shown in the stream header next to the spinner. */
export const AGENT_STREAM_SUBJECT = "cogni/node";

export const AGENT_STREAM_SEQUENCES: StreamEvent[][] = [
  [
    {
      id: "a1",
      type: "thinking",
      text: "Reviewing the goals the community set for this week...",
      at: 0,
    },
    {
      id: "a2",
      type: "searching",
      text: "Gathering fresh sources across the mission's watch list",
      at: 1800,
    },
    {
      id: "a3",
      type: "analyzing",
      text: "Cross-checking 3 new findings against what we already know",
      at: 3400,
    },
    {
      id: "a4",
      type: "signal",
      text: "Signal: a high-confidence opportunity that fits the mission. Drafting a recommendation.",
      at: 5600,
    },
    {
      id: "a5",
      type: "done",
      text: "Pass complete. 1 recommendation ready for member review.",
      at: 7200,
    },
  ],
  [
    {
      id: "b1",
      type: "thinking",
      text: "Picking up where the last run left off...",
      at: 0,
    },
    {
      id: "b2",
      type: "searching",
      text: "Scanning the latest activity — 42 items in the queue",
      at: 2000,
    },
    {
      id: "b3",
      type: "analyzing",
      text: "Comparing against the community's stated priorities",
      at: 3800,
    },
    {
      id: "b4",
      type: "signal",
      text: "Signal: two items worth a closer look. Tagging for member input.",
      at: 5400,
    },
    {
      id: "b5",
      type: "done",
      text: "Pass complete. 2 items surfaced, 42 reviewed.",
      at: 6800,
    },
  ],
  [
    {
      id: "c1",
      type: "thinking",
      text: "Listening for new requests from members...",
      at: 0,
    },
    {
      id: "c2",
      type: "searching",
      text: "No open requests — running the routine background sweep",
      at: 1600,
    },
    {
      id: "c3",
      type: "analyzing",
      text: "Everything tracking to plan. No action needed right now.",
      at: 3200,
    },
    {
      id: "c4",
      type: "done",
      text: "Pass complete. 0 new signals — all clear.",
      at: 5000,
    },
  ],
];

/* ─── SHOWCASE CARDS ──────────────────────────────────────────────────────
 * A grid of cards showing what the node tracks / produces. The two-segment bar
 * is a generic split (e.g. Yes/No, Open/Closed, On-track/At-risk) — name the
 * segments per item. Replace the category list and the cards with your domain.
 */
export interface ShowcaseOutcome {
  label: string;
  /** 0-100; the two outcomes in a card should sum to ~100. */
  value: number;
}

export interface ShowcaseItem {
  id: string;
  title: string;
  /** Must match one of SHOWCASE_CATEGORIES (besides "All"). */
  category: string;
  /** Free-text source / origin shown in muted text. */
  source: string;
  /** Headline number shown top-right, e.g. "$4.2M" or "94%". */
  metric: string;
  /** 24h-style delta in percent; positive = up (success), negative = down. */
  change: number;
  /** Two-segment split bar. */
  outcomes: [ShowcaseOutcome, ShowcaseOutcome];
  /** Left footer meta (e.g. volume, members, size). */
  footerLeft: string;
  /** Right footer meta (e.g. "Updated 2h ago", "Resolves Jun 18"). */
  footerRight: string;
}

export const SHOWCASE_SECTION = {
  eyebrow: "Live coverage",
  heading: "One agent. Every signal.",
  subhead:
    "It goes where the signal is. The node watches the surfaces your community cares about, so nothing important slips by — wherever it shows up.",
} as const;

export const SHOWCASE_CATEGORIES = [
  "All",
  "Research",
  "Operations",
  "Community",
  "Risk",
] as const;

export const SHOWCASE_ITEMS: ShowcaseItem[] = [
  {
    id: "1",
    title: "Should we prioritize the v2 roadmap this quarter?",
    category: "Operations",
    source: "Governance",
    metric: "62%",
    change: 4,
    outcomes: [
      { label: "Yes", value: 62 },
      { label: "No", value: 38 },
    ],
    footerLeft: "128 voters",
    footerRight: "Closes Jun 18",
  },
  {
    id: "2",
    title: "Is the new contributor onboarding working?",
    category: "Community",
    source: "Activity ledger",
    metric: "78%",
    change: 6,
    outcomes: [
      { label: "On-track", value: 78 },
      { label: "At-risk", value: 22 },
    ],
    footerLeft: "34 contributors",
    footerRight: "Updated 2h ago",
  },
  {
    id: "3",
    title: "Treasury runway under the current burn?",
    category: "Risk",
    source: "Treasury",
    metric: "$1.2M",
    change: -3,
    outcomes: [
      { label: "Healthy", value: 71 },
      { label: "Tight", value: 29 },
    ],
    footerLeft: "18-mo runway",
    footerRight: "Updated 1d ago",
  },
  {
    id: "4",
    title: "Does the latest research support the thesis?",
    category: "Research",
    source: "Knowledge base",
    metric: "84%",
    change: 7,
    outcomes: [
      { label: "Supports", value: 84 },
      { label: "Refutes", value: 16 },
    ],
    footerLeft: "9 sources",
    footerRight: "Updated 4h ago",
  },
];

/* ─── ACTIVITY FEED ───────────────────────────────────────────────────────
 * "What the agent is thinking" — public, explainable output. Each signal shows
 * the call, a confidence, the reasoning, and the sources. This is where you
 * prove the node works in the open. Rewrite for your domain.
 */
export type SignalDirection = "positive" | "negative" | "neutral";

export interface FeedSignal {
  id: string;
  title: string;
  category: string;
  source: string;
  direction: SignalDirection;
  /** 0-100 self-reported confidence. */
  confidence: number;
  /** The agent's reasoning, 1-2 sentences. */
  thesis: string;
  /** Citations / inputs the agent used. */
  sources: string[];
  /** Human-friendly relative time, e.g. "2m ago". */
  timestamp: string;
}

export const FEED_SECTION = {
  eyebrow: "Agent activity",
  heading: "What the agent is thinking.",
  subhead:
    "Live output from the node's reasoning engine. Every signal is public — see exactly what it sees, and why it decided what it did.",
} as const;

/** The status-bar verbs and the running totals shown above the feed. */
export const FEED_STATUS = {
  scannedLabel: "items reviewed",
  signalsLabel: "signals today",
  startScanned: 2847,
  signalsToday: 12,
} as const;

export const FEED_SIGNALS: FeedSignal[] = [
  {
    id: "s1",
    title: "Should we prioritize the v2 roadmap this quarter?",
    category: "Operations",
    source: "Governance",
    direction: "positive",
    confidence: 74,
    thesis:
      "Member sentiment and the last two retros both point to v2 as the highest-leverage bet. Recommend opening a formal proposal.",
    sources: ["Retro notes", "Member poll", "Roadmap draft"],
    timestamp: "2m ago",
  },
  {
    id: "s2",
    title: "New contributor onboarding is converting well",
    category: "Community",
    source: "Activity ledger",
    direction: "positive",
    confidence: 61,
    thesis:
      "First-PR-to-second-PR rate is up 18% since the new guide shipped. Worth doubling down on the mentorship pairing step.",
    sources: ["Activity ledger", "PR history"],
    timestamp: "8m ago",
  },
  {
    id: "s3",
    title: "Treasury burn is trending above plan",
    category: "Risk",
    source: "Treasury",
    direction: "negative",
    confidence: 58,
    thesis:
      "Three months of above-forecast spend. Runway still healthy at ~18 months, but recommend a budget review before the next epoch.",
    sources: ["Treasury ledger", "Budget forecast"],
    timestamp: "14m ago",
  },
  {
    id: "s4",
    title: "Latest research is inconclusive — no action yet",
    category: "Research",
    source: "Knowledge base",
    direction: "neutral",
    confidence: 67,
    thesis:
      "Sources are split and the sample is small. Holding for more data before making a recommendation. Re-checking next pass.",
    sources: ["Knowledge base", "External reports"],
    timestamp: "21m ago",
  },
];

/* ─── STATS ───────────────────────────────────────────────────────────────
 * The closing band of big numbers. Keep them true and specific to your node.
 */
export interface StatItem {
  value: string;
  label: string;
}

export const STATS: StatItem[] = [
  { value: "0%", label: "Payment Fees" },
  { value: "100%", label: "Open Source" },
  { value: "24/7", label: "Always On" },
  { value: "1", label: "Community" },
];

/* ─── STREAM ICONS ────────────────────────────────────────────────────────
 * Maps stream event types to icons. You usually won't need to touch this.
 */
export const STREAM_ICONS: Record<StreamEventType, LucideIcon> = {
  thinking: BrainCircuit,
  searching: Search,
  analyzing: Activity,
  signal: Sparkles,
  done: CheckCircle,
};

export const SECTION_ICON: LucideIcon = Network;
