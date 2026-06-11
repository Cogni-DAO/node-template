---
id: guide.new-node-styling
type: guide
title: New Node Styling Guide
status: draft
trust: draft
summary: How to customize branding, theming, and UI for a Cogni node minted from node-template.
read_when: Creating a new node or customizing an existing node's visual identity.
owner: derekg1729
created: 2026-04-01
verified: null
tags: [nodes, styling, ui]
---

# New Node Styling Guide

Each Cogni node owns its visual identity while sharing the app shell and layout patterns. The first pass usually means editing five files under `app/src/`.

> **Design quality:** this guide is the _where_ (which files to edit). For the _what_, use the `node-styling` skill (`.claude/skills/node-styling/`) — it makes the mission the driver and routes the homepage build to `/frontend-design`. Don't ship a one-token recolor and call it a customization; design the homepage for the mission.

## 1. Logo and Name

Files:

- `app/src/features/layout/components/AppHeader.tsx`
- `app/src/features/layout/components/AppSidebar.tsx`
- `app/public/*`

The current template uses image logo assets:

```tsx
<Image
  src="/TransparentBrainOnly.png"
  alt="Cogni"
  width={24}
  height={24}
/>
```

For a fast rebrand, replace the public image assets and update visible labels from `Cogni` to the node name. If the node has a better symbolic identity, use a `lucide-react` icon in both header and sidebar:

```tsx
import { Activity } from "lucide-react";

<Activity className="size-5 shrink-0 text-primary" />
<span className="font-bold">
  cogni<span className="text-primary">/poly</span>
</span>
```

Examples:

| Node     | Icon              | Import         |
| -------- | ----------------- | -------------- |
| Operator | `Brain`           | `lucide-react` |
| Poly     | `Activity`        | `lucide-react` |
| Resy     | `UtensilsCrossed` | `lucide-react` |

## 2. Theme Colors

File:

- `app/src/styles/tailwind.css`

Set the `--primary` CSS variable in both `:root` and `.dark`. The accent gradient and sidebar variables should use the same hue family.

Key variables:

```css
--primary: 160 65% 45%;
--ring: 160 65% 45%;
--sidebar-primary: 160 65% 45%;
--sidebar-accent: 160 25% 17%;
--sidebar-ring: 160 65% 45%;
--accent-from: 164 75% 38%;
--accent-to: 164 90% 55%;
--accent-glow: 164 85% 45%;
```

Search for the current hue numbers, for example `217` and `222.2`, then update both light and dark sections.

## 3. Metadata

File:

- `app/src/app/layout.tsx`

Update the metadata export:

```tsx
export const metadata: Metadata = {
  title: "Cogni Poly - Community AI Prediction Trading",
  description: "Your node description here.",
};
```

## 4. Homepage

File:

- `app/src/app/(public)/page.tsx`

Customize the public landing page hero, calls to action, and domain-specific copy. Signed-in users redirect to `/chat`.

## 5. Chat Defaults

Files:

- `app/src/features/ai/components/ChatComposerExtras.tsx`
- `graphs/src/index.ts`

Tailor the default graph and graph list to the node's domain. Prediction-market nodes should expose market-analysis prompts and graphs; reservation nodes should expose reservation workflows; general nodes can keep `langgraph:brain`.

## Checklist

- [ ] Update logo or icon in header and sidebar.
- [ ] Update visible node name and external links.
- [ ] Pick a primary hue and update `tailwind.css` light and dark variables.
- [ ] Set `layout.tsx` metadata.
- [ ] Customize the public homepage.
- [ ] Customize chat graph defaults and suggestions.
- [ ] Verify `pnpm check` passes.
- [ ] Verify the dev server shows the expected logo, colors, and name.
