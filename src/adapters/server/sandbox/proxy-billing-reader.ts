// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/sandbox/proxy-billing-reader`
 * Purpose: Reads billing entries from a running proxy container's audit log.
 * Scope: Execs grep inside a live proxy container to extract per-run billing data. Does not stop or manage the proxy.
 * Invariants:
 *   - Per BILLING_INDEPENDENT_OF_CLIENT: billing data comes from proxy, not agent
 *   - Per APPEND_ONLY_AUDIT: reads from proxy's /tmp/audit.log
 *   - Uses x-cogni-run-id for exact per-run correlation (no JSON parsing)
 * Side-effects: IO (Docker exec inside proxy container)
 * Links: docs/spec/openclaw-sandbox-spec.md, llm-proxy-manager.ts
 * @internal
 */

import type Docker from "dockerode";
import type { Logger } from "pino";

import type { ProxyBillingEntry } from "@/ports";
import { makeLogger } from "@/shared/observability";

import { LlmProxyManager } from "./llm-proxy-manager";

/**
 * Audit log path inside the gateway proxy container.
 * Uses /tmp/ because nginx:alpine symlinks /var/log/nginx/access.log → /dev/stdout,
 * preventing file-based capture at the default path. Safe here: this is an isolated,
 * single-purpose container with no untrusted processes (see llm-proxy-manager.ts).
 */
const CONTAINER_AUDIT_LOG = "/tmp/audit.log";

/**
 * Reads billing entries from a running proxy container's audit log.
 * Uses `docker exec grep` to filter by x-cogni-run-id for exact per-run correlation.
 *
 * Unlike LlmProxyManager (which copies logs on stop), this operates on a
 * live long-running container — the proxy stays up across multiple runs.
 */
export class ProxyBillingReader {
  private readonly log: Logger;

  constructor(
    private readonly docker: Docker,
    private readonly proxyContainerName: string
  ) {
    this.log = makeLogger({ component: "ProxyBillingReader" });
  }

  /**
   * Read billing entries for a specific runId from the proxy audit log.
   * Execs `grep` inside the proxy container, filtering by run_id={runId}.
   *
   * Per MEMORY.md dockerode gotcha: uses hijack:true + bounded timeout.
   */
  async readEntries(runId: string): Promise<ProxyBillingEntry[]> {
    const container = this.docker.getContainer(this.proxyContainerName);

    try {
      const exec = await container.exec({
        Cmd: ["grep", `run_id=${runId}`, CONTAINER_AUDIT_LOG],
        AttachStdout: true,
        AttachStderr: true,
      });

      const stream = await exec.start({ hijack: true, stdin: false });
      const chunks: Buffer[] = [];

      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          stream.destroy();
          resolve();
        }, 5000);
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => {
          clearTimeout(timer);
          resolve();
        });
        stream.on("error", () => {
          clearTimeout(timer);
          resolve();
        });
      });

      if (chunks.length === 0) {
        this.log.debug({ runId }, "No audit log entries found for run");
        return [];
      }

      const raw = Buffer.concat(chunks);
      const logContent = LlmProxyManager.demuxDockerStream(raw);
      return this.parseAuditLines(logContent, runId);
    } catch (err) {
      this.log.warn(
        { runId, proxyContainer: this.proxyContainerName, error: err },
        "Failed to read billing entries from proxy"
      );
      return [];
    }
  }

  /**
   * Parse audit log lines into billing entries.
   * Format: `... litellm_call_id=X litellm_response_cost=Y`
   */
  private parseAuditLines(content: string, runId: string): ProxyBillingEntry[] {
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    const entries: ProxyBillingEntry[] = [];

    for (const line of lines) {
      const callIdMatch = line.match(/litellm_call_id=(\S+)/);
      const callId = callIdMatch?.[1];
      if (!callId || callId === "-") continue;

      const costMatch = line.match(/litellm_response_cost=(\S+)/);
      const costRaw = costMatch?.[1];
      let costUsd: number | undefined;
      if (costRaw && costRaw !== "-") {
        const parsed = Number.parseFloat(costRaw);
        if (Number.isFinite(parsed)) {
          costUsd = parsed;
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
