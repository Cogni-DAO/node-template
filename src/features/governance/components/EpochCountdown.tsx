// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/governance/components/EpochCountdown`
 * Purpose: Monospace countdown timer with progress bar for the current epoch.
 * Scope: Governance feature component. Client-side timer with 60s interval. Does not perform data fetching or server-side logic.
 * Invariants: Progress computed from epoch start/end window. Timer updates every minute.
 * Side-effects: time
 * Links: src/contracts/governance.epoch.v1.contract.ts
 * @public
 */

"use client";

import { Clock } from "lucide-react";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { Badge, Card, CardContent, Progress } from "@/components";

interface EpochCountdownProps {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly status: "open" | "closed";
  readonly contributorCount: number;
  readonly totalPoints: number;
}

function useCountdown(periodStart: string, periodEnd: string) {
  const [timeLeft, setTimeLeft] = useState("");
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const end = new Date(periodEnd).getTime();
    const start = new Date(periodStart).getTime();
    const tick = () => {
      const now = Date.now();
      const remaining = Math.max(0, end - now);
      const total = end - start;
      setProgress(Math.min(100, ((total - remaining) / total) * 100));
      const d = Math.floor(remaining / 86_400_000);
      const h = Math.floor((remaining % 86_400_000) / 3_600_000);
      const m = Math.floor((remaining % 3_600_000) / 60_000);
      setTimeLeft(`${d}d  ${h}h  ${String(m).padStart(2, "0")}m`);
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [periodStart, periodEnd]);

  return { timeLeft, progress };
}

export function EpochCountdown({
  periodStart,
  periodEnd,
  status,
  contributorCount,
  totalPoints,
}: EpochCountdownProps): ReactElement {
  const { timeLeft, progress } = useCountdown(periodStart, periodEnd);

  return (
    <Card className="border-border/50 bg-card/50">
      <CardContent className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span className="text-sm">Time remaining</span>
          </div>
          <Badge
            intent={status === "open" ? "default" : "secondary"}
            size="sm"
            className={status === "open" ? "animate-pulse" : ""}
          >
            {status === "open" ? "ACTIVE" : "CLOSED"}
          </Badge>
        </div>
        <div className="mb-3 font-bold font-mono text-4xl text-foreground">
          {timeLeft}
        </div>
        <Progress value={progress} className="h-2 bg-secondary" />
        <div className="mt-3 flex justify-between text-muted-foreground text-xs">
          <span>{contributorCount} contributors</span>
          <span>{totalPoints} total points</span>
        </div>
      </CardContent>
    </Card>
  );
}
