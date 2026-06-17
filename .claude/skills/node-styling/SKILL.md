---
name: node-styling
description: Use whenever you customize a Cogni node's visual identity — branding, icon, name, theme colors, metadata, the public homepage, or chat suggestions. Triggers on "style this node", "rebrand", "customize the node", "make the homepage for <mission>", node launch/formation styling. The homepage is the main event, not an afterthought.
---

# Node Styling

Each Cogni node owns its visual identity while sharing the app shell and layout. Customization is a handful of files under `app/src/`. Canonical reference: [`docs/guides/new-node-styling.md`](../../../docs/guides/new-node-styling.md).

## The one rule that matters

**A recolor + a swapped icon is NOT a customization. It's the table-stakes 10%.** The node's homepage is the product's face — it must *express the mission*. If you change the hue and the Lucide icon and stop, you have shipped an anti-pattern. The bulk of the work is items **4 (Homepage)** and **5 (Chat)** below, designed *for this node's actual purpose*.

Before touching a single token, answer: **what is this node FOR, and what should a first-time visitor instantly understand?** Style everything in service of that answer.

## What to customize

### 1. Icon + Name (header + sidebar)
Each node uses a [Lucide icon](https://lucide.dev/icons) + `cogni/{name}` text. Pick an icon that *means* the mission — not a generic default.

- `src/features/layout/components/AppHeader.tsx` — public header
- `src/features/layout/components/AppSidebar.tsx` — signed-in sidebar

```tsx
import { Activity } from "lucide-react";

<Activity className="size-5 shrink-0 text-primary" />
<span className="font-bold">
  cogni<span className="text-primary">/poly</span>
</span>
```

| Node | Icon | Import |
| --- | --- | --- |
| Operator | `Brain` | `lucide-react` |
| Poly | `Activity` | `lucide-react` |
| Resy | `UtensilsCrossed` | `lucide-react` |

Choose an icon for the mission, not convenience. (For an open-source knowledge map, `Boxes` says "containers" — `Network`, `Library`, or `GitFork` say "interconnected OSS"; pick deliberately and justify it.)

### 2. Theme colors (`src/styles/tailwind.css`)
Set `--primary` in **both** `:root` (light) and `.dark`. The accent gradient (`--accent-from/-to/-glow`) and sidebar colors should share the hue. Search the current hue number (e.g. `217`) and replace in both sections.

```css
--primary: 160 65% 45%;        /* main brand color */
--ring: 160 65% 45%;           /* focus rings */
--sidebar-primary: 160 65% 45%;
--sidebar-accent: 160 25% 17%;
--sidebar-ring: 160 65% 45%;
--accent-from: 164 75% 38%;    /* gradient start */
--accent-to: 164 90% 55%;      /* gradient end */
--accent-glow: 164 85% 45%;    /* glow effects */
```

| Node | Hue | `--primary` (dark) |
| --- | --- | --- |
| Operator | 217 (blue) | `217 71% 40%` |
| Poly | 160 (teal) | `160 65% 45%` |

### 3. Metadata (`src/app/layout.tsx`)
```tsx
export const metadata: Metadata = {
  title: "Cogni <Node> — <one-line mission>",
  description: "Your node description here.",
};
```

### 4. Homepage (`src/features/home/content.ts`) — the main event
The template ships a **full, multi-section landing page** out of the box — animated hero + live agent-stream console, a showcase-cards grid, a public activity feed of explainable signals, and a stats band. This is the same framework the Poly and Resy nodes use. You do **not** design a page from scratch and you do **not** rebuild the layout.

**Customize the page by rewriting `app/src/features/home/content.ts`.** It is the single source of all homepage copy and placeholder data (`HERO`, `AGENT_STREAM_SEQUENCES`, `SHOWCASE_*`, `FEED_*`, `STATS`). Walk it top to bottom and replace every value with copy that sells *this* node's mission to a stranger in five seconds. Keep the data shapes; change the words. The hue from step 2 flows through every section automatically.

The layout components in `src/features/home/components/*` are generic — only touch them to add or remove a whole section. If you decide the mission needs a genuinely different layout, *then* reach for [`/frontend-design`](../../../.claude/skills); otherwise content + hue is the first-class path. Signed-in users redirect to `/chat`.

### 5. Chat suggested messages (`src/features/ai/components/ChatComposerExtras.tsx`)
Tailor the welcome suggestions to the node's domain. A prediction node shows market prompts; a reservation node shows booking prompts; a knowledge node shows discovery/search prompts. Generic prompts here are the same anti-pattern as a generic homepage.

## Checklist
- [ ] Lucide icon chosen *for the mission* — `AppHeader.tsx` + `AppSidebar.tsx`
- [ ] Primary hue set in `tailwind.css` (both `:root` and `.dark`, accent + sidebar follow)
- [ ] `layout.tsx` metadata: mission-expressing title + description
- [ ] **`content.ts` fully rewritten for the mission** — every section (hero, agent stream, showcase cards, activity feed, stats) speaks to *this* node, not the template defaults
- [ ] Chat suggestions tailored to the domain
- [ ] `pnpm check` passes
- [ ] Dev server (or candidate) shows the right icon, colors, name, AND a homepage a stranger understands

## Anti-patterns
- Changing only the icon + hue and calling the node "customized." (90% of the job is `content.ts` + chat.)
- Shipping `content.ts` with the template defaults still in it (the "community-owned" hero, the v2-roadmap cards). A stranger should see *your* mission, not the scaffold.
- Rebuilding the homepage layout from scratch when content + hue would have done the job.
- An icon/palette with no stated connection to the mission.
