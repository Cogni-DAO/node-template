// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/adapters/ai/local-fs-artifact-sink`
 * Purpose: Unit tests for LocalFsArtifactSinkAdapter.
 * Scope: Verifies SINK_RETURNS_REF: write() returns ArtifactRef with correct fields.
 * Invariants:
 *   - SINK_RETURNS_REF: write() returns ArtifactRef, not raw bytes
 *   - ARTIFACT_BYTES_NEVER_IN_STATE: Only ref travels in state
 * Side-effects: IO (writes to tmp dir, cleaned up after test)
 * Links: task.0163, artifact-sink.port.ts
 * @internal
 */

import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ArtifactWriteParams } from "@cogni/ai-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocalFsArtifactSinkAdapter } from "@/adapters/server/ai/local-fs-artifact-sink.adapter";

const TEST_BASE_DIR = join(tmpdir(), "cogni-artifact-sink-test");

describe("LocalFsArtifactSinkAdapter", () => {
  let sink: LocalFsArtifactSinkAdapter;

  beforeEach(() => {
    sink = new LocalFsArtifactSinkAdapter({ baseDir: TEST_BASE_DIR });
  });

  afterEach(async () => {
    await rm(TEST_BASE_DIR, { recursive: true, force: true });
  });

  it("writes artifact to disk and returns ArtifactRef", async () => {
    const params: ArtifactWriteParams = {
      type: "image",
      data: Buffer.from("iVBORw0KGgoAAAANSUhEUg==", "base64"),
      mimeType: "image/png",
      toolCallId: "call_test_001",
    };

    const ref = await sink.write(params);

    // ArtifactRef shape
    expect(ref.type).toBe("image");
    expect(ref.id).toBeDefined();
    expect(typeof ref.id).toBe("string");
    expect(ref.mimeType).toBe("image/png");
    expect(ref.byteLength).toBe(params.data.byteLength);
    expect(ref.toolCallId).toBe("call_test_001");

    // File actually exists on disk
    const filePath = join(TEST_BASE_DIR, `${ref.id}.png`);
    expect(existsSync(filePath)).toBe(true);

    // File content matches input
    const written = await readFile(filePath);
    expect(written.equals(params.data)).toBe(true);
  });

  it("uses correct file extension from MIME type", async () => {
    const params: ArtifactWriteParams = {
      type: "image",
      data: Buffer.from([0xff, 0xd8, 0xff]),
      mimeType: "image/jpeg",
      toolCallId: "call_test_002",
    };

    const ref = await sink.write(params);

    const filePath = join(TEST_BASE_DIR, `${ref.id}.jpg`);
    expect(existsSync(filePath)).toBe(true);
  });

  it("falls back to .bin for unknown MIME types", async () => {
    const params: ArtifactWriteParams = {
      type: "file",
      data: Buffer.from("hello"),
      mimeType: "application/octet-stream",
      toolCallId: "call_test_003",
    };

    const ref = await sink.write(params);

    const filePath = join(TEST_BASE_DIR, `${ref.id}.bin`);
    expect(existsSync(filePath)).toBe(true);
  });

  it("includes metadata in ArtifactRef when provided", async () => {
    const params: ArtifactWriteParams = {
      type: "image",
      data: Buffer.from("test"),
      mimeType: "image/png",
      toolCallId: "call_test_004",
      metadata: { model: "test-model", prompt: "a sunset" },
    };

    const ref = await sink.write(params);

    expect(ref.metadata).toEqual({ model: "test-model", prompt: "a sunset" });
  });

  it("omits metadata from ArtifactRef when not provided", async () => {
    const params: ArtifactWriteParams = {
      type: "image",
      data: Buffer.from("test"),
      mimeType: "image/png",
      toolCallId: "call_test_005",
    };

    const ref = await sink.write(params);

    expect(ref.metadata).toBeUndefined();
  });

  it("generates unique IDs for each write", async () => {
    const params: ArtifactWriteParams = {
      type: "image",
      data: Buffer.from("test"),
      mimeType: "image/png",
      toolCallId: "call_test_006",
    };

    const ref1 = await sink.write(params);
    const ref2 = await sink.write({ ...params, toolCallId: "call_test_007" });

    expect(ref1.id).not.toBe(ref2.id);
  });
});
