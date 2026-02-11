// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/sandbox/proxy-billing-reader`
 * Purpose: Reads billing entries from the proxy's audit log via shared volume.
 * Scope: Tail-reads JSONL audit log on disk, filters by runId. Does not use Docker socket or dockerode.
 * Invariants:
 *   - Per BILLING_INDEPENDENT_OF_CLIENT: billing data comes from proxy audit log, not agent
 *   - Per NO_DOCKERODE_IN_BILLING_PATH: reads from shared volume, never uses docker exec
 *   - Per BILLING_DATA_PLANE_IS_EXPLICIT: shared named volume between proxy and app
 * Side-effects: IO (filesystem read from shared volume)
 * Links: docs/spec/openclaw-sandbox-spec.md, nginx-gateway.conf.template
 * @internal
 */

import { open, stat } from "node:fs/promises";
import { join } from "node:path";

import type { Logger } from "pino";

import type { ProxyBillingEntry } from "@/ports";
import { makeLogger } from "@/shared/observability";

const AUDIT_FILENAME = "audit.jsonl";

/** Maximum bytes to tail-read from audit log (2 MB). */
const MAX_TAIL_BYTES = 2 * 1024 * 1024;

/** Retry schedule: delays between attempts (ms). */
const RETRY_DELAYS = [500, 1000, 2000];

interface AuditEntry {
  run_id?: string;
  litellm_call_id?: string;
  litellm_response_cost?: string;
}

/**
 * Reads billing entries from the proxy's JSONL audit log on a shared volume.
 *
 * The gateway nginx proxy writes one JSON line per LLM call to /billing/audit.jsonl.
 * This reader tail-reads the last N bytes and filters by run_id for the requested run.
 *
 * Bounded retry handles nginx write flush latency (up to ~3.5s total).
 */
export class ProxyBillingReader {
  private readonly log: Logger;
  private readonly auditLogPath: string;

  constructor(billingDir: string, logger?: Logger) {
    this.log =
      logger?.child({ component: "ProxyBillingReader" }) ??
      makeLogger({ component: "ProxyBillingReader" });
    this.auditLogPath = join(billingDir, AUDIT_FILENAME);
  }

  /**
   * Read billing entries for a specific runId from the proxy audit log.
   * Tail-reads last 2MB, parses JSONL lines, filters by run_id.
   * Retries up to 3 times with backoff if file missing or no matching entries.
   */
  async readEntries(runId: string): Promise<ProxyBillingEntry[]> {
    let lastErr: unknown;

    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      if (attempt > 0) {
        const delay = RETRY_DELAYS[attempt - 1] ?? 1000;
        await sleep(delay);
      }

      try {
        const entries = await this.readOnce(runId);
        if (entries.length > 0) {
          return entries;
        }
        // Zero entries — retry (nginx may not have flushed yet)
      } catch (err) {
        lastErr = err;
        // File missing or read error — retry
      }
    }

    // All retries exhausted
    let fileExists = false;
    let fileSizeBytes = 0;
    try {
      const s = await stat(this.auditLogPath);
      fileExists = true;
      fileSizeBytes = s.size;
    } catch {
      // file doesn't exist
    }

    this.log.error(
      {
        runId,
        path: this.auditLogPath,
        fileExists,
        fileSizeBytes,
        attempts: RETRY_DELAYS.length + 1,
        error: lastErr,
      },
      "Billing audit log read failed after retries"
    );
    return [];
  }

  /**
   * Single read attempt: tail-read audit log and parse matching entries.
   */
  private async readOnce(runId: string): Promise<ProxyBillingEntry[]> {
    const fileStat = await stat(this.auditLogPath);
    const fileSize = fileStat.size;
    if (fileSize === 0) return [];

    const readSize = Math.min(fileSize, MAX_TAIL_BYTES);
    const offset = Math.max(0, fileSize - readSize);
    const buffer = Buffer.alloc(readSize);

    const fh = await open(this.auditLogPath, "r");
    try {
      await fh.read(buffer, 0, readSize, offset);
    } finally {
      await fh.close();
    }

    const content = buffer.toString("utf-8");
    const lines = content.split("\n");

    // If we started mid-file, discard first (potentially partial) line
    if (offset > 0) {
      lines.shift();
    }

    const entries: ProxyBillingEntry[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;

      let parsed: AuditEntry;
      try {
        parsed = JSON.parse(trimmed) as AuditEntry;
      } catch {
        // Malformed line — skip
        continue;
      }

      if (parsed.run_id !== runId) continue;

      const callId = parsed.litellm_call_id;
      if (!callId || callId === "-") continue;

      let costUsd: number | undefined;
      if (
        parsed.litellm_response_cost &&
        parsed.litellm_response_cost !== "-"
      ) {
        const cost = Number.parseFloat(parsed.litellm_response_cost);
        if (Number.isFinite(cost)) {
          costUsd = cost;
        }
      }

      entries.push(
        costUsd !== undefined
          ? { litellmCallId: callId, costUsd }
          : { litellmCallId: callId }
      );
    }

    this.log.debug(
      { runId, lineCount: lines.length, billingEntryCount: entries.length },
      "Parsed proxy audit entries"
    );
    return entries;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
