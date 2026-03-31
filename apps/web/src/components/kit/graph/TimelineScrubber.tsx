// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@components/kit/graph/TimelineScrubber`
 * Purpose: Playback controls for the timeline force graph — play/pause, speed, and time scrubbing.
 * Scope: Presentational. Manages playback state and emits timestamp via onChange. Does not fetch data.
 * Invariants: TOKENS_ONLY — uses semantic color tokens.
 * Side-effects: timer (setInterval for playback)
 * Links: [ForceGraph](./ForceGraph.tsx)
 * @public
 */

"use client";

import { Pause, Play, SkipForward } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components";

export interface TimelineScrubberProps {
  /** Start of the time range (Unix ms) */
  min: number;
  /** End of the time range (Unix ms) */
  max: number;
  /** Current position (Unix ms) */
  value: number;
  /** Called when the position changes */
  onChange: (timestamp: number) => void;
  /** Container className for layout overrides */
  className?: string | undefined;
}

const SPEEDS = [1, 2, 5, 10] as const;

export function TimelineScrubber({
  min,
  max,
  value,
  onChange,
  className,
}: TimelineScrubberProps) {
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(0);
  const speed = SPEEDS[speedIdx] ?? 1;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Advance playback
  useEffect(() => {
    if (!playing) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    // Advance by speed * 1 second of real time per 50ms tick
    intervalRef.current = setInterval(() => {
      onChange(Math.min(max, value + speed * 1000));
    }, 50);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [playing, speed, value, max, onChange]);

  // Pause when we hit the end
  useEffect(() => {
    if (value >= max && playing) setPlaying(false);
  }, [value, max, playing]);

  const cycleSpeed = useCallback(() => {
    setSpeedIdx((i) => (i + 1) % SPEEDS.length);
  }, []);

  const skipToLive = useCallback(() => {
    onChange(max);
    setPlaying(false);
  }, [max, onChange]);

  const handleScrub = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(Number(e.target.value));
      setPlaying(false);
    },
    [onChange]
  );

  const formatTime = (ms: number) => {
    const d = new Date(ms);
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border border-border bg-card p-2 ${className ?? ""}`}
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setPlaying((p) => !p)}
        aria-label={playing ? "Pause" : "Play"}
        className="h-8 w-8 p-0"
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onClick={cycleSpeed}
        className="h-8 w-12 p-0 font-mono text-xs"
        aria-label={`Speed: ${speed}x`}
      >
        {speed}x
      </Button>

      <span className="text-muted-foreground text-xs tabular-nums">
        {formatTime(min)}
      </span>

      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={handleScrub}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-primary"
      />

      <span className="text-muted-foreground text-xs tabular-nums">
        {formatTime(max)}
      </span>

      <Button
        variant="ghost"
        size="sm"
        onClick={skipToLive}
        aria-label="Skip to live"
        className="h-8 w-8 p-0"
      >
        <SkipForward className="h-4 w-4" />
      </Button>
    </div>
  );
}
