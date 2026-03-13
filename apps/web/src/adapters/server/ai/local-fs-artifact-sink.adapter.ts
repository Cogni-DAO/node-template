// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/ai/local-fs-artifact-sink.adapter`
 * Purpose: Dev-only local filesystem artifact sink for persisting generated artifacts.
 * Scope: Writes artifact bytes to local disk, returns ArtifactRef. Does NOT serve files.
 * Invariants:
 *   - SINK_RETURNS_REF: write() returns ArtifactRef with storage metadata
 *   - ARTIFACT_BYTES_NEVER_IN_STATE: Raw bytes go to disk, only ref travels in state
 *   - DEV_ONLY_EPHEMERAL: This adapter is for dev/staging only — NOT a production artifact strategy.
 *     Production requires MinIO (S3-compatible OSS) or equivalent durable object storage.
 * Side-effects: IO (filesystem writes)
 * Links: task.0163, proj.tool-use-evolution.md (Walk P1: Artifact Storage)
 * @internal
 */

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  ArtifactRef,
  ArtifactSinkPort,
  ArtifactWriteParams,
} from "@cogni/ai-core";

import { makeLogger } from "@/shared/observability";

const logger = makeLogger({ component: "LocalFsArtifactSink" });

/** Map MIME types to file extensions. */
const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "application/pdf": "pdf",
};

/**
 * Configuration for LocalFsArtifactSinkAdapter.
 */
export interface LocalFsArtifactSinkConfig {
  /** Base directory for artifact storage (e.g., "/tmp/cogni-artifacts") */
  baseDir: string;
}

/**
 * Local filesystem artifact sink — dev-only, ephemeral.
 *
 * Writes artifact bytes to disk under `baseDir/<toolCallId>.<ext>`.
 * Returns an ArtifactRef with a URL that can be used to serve the file.
 *
 * WARNING: This is NOT a production artifact strategy.
 * - Local disk is ephemeral (lost on pod restart)
 * - No CDN, no replication, no lifecycle management
 * - Production path: MinIO (S3-compatible OSS) — see proj.tool-use-evolution.md
 */
export class LocalFsArtifactSinkAdapter implements ArtifactSinkPort {
  private readonly baseDir: string;
  private dirEnsured = false;

  constructor(config: LocalFsArtifactSinkConfig) {
    this.baseDir = config.baseDir;
  }

  async write(params: ArtifactWriteParams): Promise<ArtifactRef> {
    // Ensure directory exists (once per process)
    if (!this.dirEnsured) {
      await mkdir(this.baseDir, { recursive: true });
      this.dirEnsured = true;
    }

    const id = randomUUID();
    const ext = MIME_TO_EXT[params.mimeType] ?? "bin";
    const filename = `${id}.${ext}`;
    const filePath = join(this.baseDir, filename);

    await writeFile(filePath, params.data);

    const byteLength = params.data.byteLength;
    logger.debug(
      {
        id,
        toolCallId: params.toolCallId,
        mimeType: params.mimeType,
        byteLength,
        filePath,
      },
      "Artifact written to local filesystem"
    );

    return {
      type: params.type,
      id,
      mimeType: params.mimeType,
      byteLength,
      toolCallId: params.toolCallId,
      ...(params.metadata !== undefined && { metadata: params.metadata }),
    };
  }
}
