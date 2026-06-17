// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/home/components/AgentStream`
 * Purpose: Live "agent console" embedded in the hero. Replays simulated reasoning
 *   sequences to show the node working in real time, then loops.
 * Scope: Presentational. Reads all copy from `../content`. No real IO.
 * Invariants: Cleans up its timers on unmount / sequence change.
 * Side-effects: timers (setTimeout) for the streaming animation
 * Links: src/features/home/content.ts, src/features/home/components/LandingHero.tsx
 */

"use client";

import { cn } from "@cogni/node-ui-kit/util/cn";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle, Loader2 } from "lucide-react";
import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";

import {
  AGENT_STREAM_SEQUENCES,
  AGENT_STREAM_SUBJECT,
  STREAM_ICONS,
  type StreamEvent,
} from "../content";

function EventIcon({ type }: { type: StreamEvent["type"] }): ReactElement {
  const Icon = STREAM_ICONS[type];
  return (
    <Icon
      className={cn(
        "size-3",
        type === "analyzing" || type === "signal"
          ? "text-success"
          : type === "done"
            ? "text-muted-foreground"
            : type === "thinking"
              ? "text-primary"
              : "text-muted-foreground"
      )}
    />
  );
}

export function AgentStream(): ReactElement {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [seqIdx, setSeqIdx] = useState(0);
  const [isStreaming, setIsStreaming] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sequence =
      AGENT_STREAM_SEQUENCES[seqIdx % AGENT_STREAM_SEQUENCES.length];
    if (!sequence) return;
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    setEvents([]);
    setIsStreaming(true);

    for (const event of sequence) {
      timeouts.push(
        setTimeout(() => {
          setEvents((prev) => [...prev, event]);
        }, event.at)
      );
    }

    const lastEvent = sequence[sequence.length - 1];
    if (!lastEvent) return;
    timeouts.push(
      setTimeout(() => {
        setIsStreaming(false);
      }, lastEvent.at + 500)
    );
    timeouts.push(
      setTimeout(() => {
        setSeqIdx((prev) => prev + 1);
      }, lastEvent.at + 4000)
    );

    return () => {
      for (const t of timeouts) clearTimeout(t);
    };
  }, [seqIdx]);

  const eventCount = events.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: eventCount triggers scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [eventCount]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.5 }}
      className="mx-auto mt-12 w-full max-w-lg"
    >
      <div className="overflow-hidden rounded-lg border border-border/40 bg-card/80 backdrop-blur-md">
        {/* Header */}
        <div className="flex items-center gap-2 border-border/40 border-b px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            {isStreaming ? (
              <Loader2 className="size-3 animate-spin text-primary" />
            ) : (
              <CheckCircle className="size-3 text-muted-foreground" />
            )}
            <span className="font-mono text-muted-foreground text-xs uppercase tracking-wider">
              {isStreaming ? "Agent running" : "Pass complete"}
            </span>
          </div>
          <div className="flex-1" />
          <span className="font-mono text-muted-foreground/50 text-xs">
            {AGENT_STREAM_SUBJECT}
          </span>
        </div>

        {/* Stream output */}
        <div ref={scrollRef} className="h-36 overflow-y-auto px-4 py-3 sm:h-40">
          <AnimatePresence mode="popLayout">
            {events.map((event) => (
              <motion.div
                key={event.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="mb-2 flex items-start gap-2 last:mb-0"
              >
                <span className="mt-0.5 shrink-0">
                  <EventIcon type={event.type} />
                </span>
                <span
                  className={cn(
                    "font-mono text-xs leading-relaxed",
                    event.type === "signal"
                      ? "text-success"
                      : event.type === "done"
                        ? "text-muted-foreground/60"
                        : "text-muted-foreground"
                  )}
                >
                  {event.text}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Typing indicator */}
          {isStreaming && events.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-1 pt-1"
            >
              <span className="size-1 animate-pulse rounded-full bg-primary/60" />
              <span
                className="size-1 animate-pulse rounded-full bg-primary/60"
                // eslint-disable-next-line no-inline-styles/no-inline-styles -- Staggers static pulse timing without introducing one-off CSS helpers
                style={{ animationDelay: "150ms" }}
              />
              <span
                className="size-1 animate-pulse rounded-full bg-primary/60"
                // eslint-disable-next-line no-inline-styles/no-inline-styles -- Staggers static pulse timing without introducing one-off CSS helpers
                style={{ animationDelay: "300ms" }}
              />
            </motion.div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
