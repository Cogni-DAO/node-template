---
id: task.0235
type: task
title: "Chat activity status line — consume StatusEvent in thread UI"
status: needs_implement
priority: 1
rank: 1
estimate: 2
summary: "Add a 1-line activity indicator above the chat composer that shows the current agent phase (thinking, tool_use, compacting) from StatusEvent data-status chunks. Replaces the invisible thinking gap."
outcome: "Users see 'Thinking...', 'Using search_web...', 'Compacting context...' in real-time while the AI is working. Fades in/out with Framer Motion. Auto-dismisses on text_delta or done."
spec_refs:
assignees: []
credit:
project: proj.premium-frontend-ux
branch: feat/chat-activity-status-line
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-30
updated: 2026-03-31
labels: [ui, chat, ai-graphs]
external_refs:
---

# Chat Activity Status Line

## Design

### Outcome

When the AI is processing, users see a single animated line above the composer: "Thinking...", "Using search_web...", or "Compacting context...". Replaces the current void between sending a message and seeing the first text chunk.

### Approach

**Solution**: Use `@assistant-ui/react`'s `useThreadRuntime` to subscribe to the latest assistant message's content parts. Extract `DataMessagePart` with `name === "status"` and render a `<StatusLine>` component between messages and composer in the Thread. Animate with Framer Motion.

**Why this works**: The backend already emits `StatusEvent` → the chat route maps it to `data-status` UIMessageChunk with `transient: true` → `@assistant-ui/react` converts it to a `DataMessagePart` in the in-progress message's content array. We just need to read it and render.

**Reuses**:

- Existing `StatusEvent` → `data-status` pipeline (zero backend changes)
- `@assistant-ui/react` v0.12.10 `useThreadRuntime` + `ThreadPrimitive.If running` (already installed)
- `framer-motion` (already installed) for enter/exit animation
- `lucide-react` icons (already installed): Brain, Wrench, Minimize2
- Status icon pattern from `work-item-icons.tsx` (same icon+color approach)

**Rejected**:

- **`useMessagePartData` hook**: Requires being inside a MessagePart context — can't use at thread level
- **Separate SSE connection**: Overkill — the status is already in the AI SDK stream
- **onData callback**: Would require switching from `useChatRuntime` to `useDataStreamRuntime` — invasive change

### Invariants

- [ ] STATUS_IS_EPHEMERAL: Status line is transient — never persisted, disappears when stream ends
- [ ] STATUS_BEST_EFFORT: Missing status events gracefully fall back to no indicator (not an error)
- [ ] CONTRACTS_ARE_TRUTH: Status data shape matches `CogniStatus` from ai.completions.v1.contract
- [ ] ARCHITECTURE_ALIGNMENT: New component in kit/chat/, wired in vendor/assistant-ui/thread.tsx

### Files

**Create**:

- `apps/web/src/components/kit/chat/StatusLine.tsx` — presentational component with phase icon + animated text

**Modify**:

- `apps/web/src/components/vendor/assistant-ui/thread.tsx` — add StatusLine between messages and composer, gated by `ThreadPrimitive.If running`

### Implementation Plan

- [ ] **Checkpoint 1**: StatusLine component renders statically with all three phases
  - Create `StatusLine.tsx` with phase→icon+text map
  - Accept `phase` and `label` props
  - Framer Motion `AnimatePresence` for enter/exit
  - Validation: component renders in isolation

- [ ] **Checkpoint 2**: Wire into Thread, extract status from runtime
  - Add `useThreadRuntime` subscription in Thread to read latest message's data parts
  - Find last `DataMessagePart` with `name === "status"` in the in-progress message
  - Render `StatusLine` inside `ThreadPrimitive.If running` block between messages and composer
  - Validation: send a message in dev, see status line appear during processing

## Validation

```bash
pnpm check:fast
```
