// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/adapters/server/sandbox/git-relay-helpers.test`
 * Purpose: Unit tests for git-relay pure helper functions.
 * Scope: Tests demuxDockerStream, injectTokenIntoUrl, and parseGitHubUrl. Does not test Docker or git CLI integration.
 * Invariants: None (unit tests)
 * Side-effects: none
 * Links: src/adapters/server/sandbox/git-relay.ts
 */

import { describe, expect, it } from "vitest";

import {
  demuxDockerStream,
  injectTokenIntoUrl,
  parseGitHubUrl,
} from "@/adapters/server/sandbox/git-relay";

// ─────────────────────────────────────────────────────────────────────────────
// demuxDockerStream
// ─────────────────────────────────────────────────────────────────────────────

describe("demuxDockerStream", () => {
  /** Build a Docker multiplexed frame: [streamType(1) + 3 zero bytes + size(4BE) + payload] */
  function frame(streamType: number, payload: string): Buffer {
    const data = Buffer.from(payload, "utf8");
    const header = Buffer.alloc(8);
    header.writeUInt8(streamType, 0);
    header.writeUInt32BE(data.length, 4);
    return Buffer.concat([header, data]);
  }

  it("extracts stdout (type 1) from a single frame", () => {
    const buf = frame(1, "hello world");
    expect(demuxDockerStream(buf)).toBe("hello world");
  });

  it("ignores stderr (type 2)", () => {
    const buf = frame(2, "error output");
    expect(demuxDockerStream(buf)).toBe("");
  });

  it("concatenates multiple stdout frames", () => {
    const buf = Buffer.concat([frame(1, "foo"), frame(1, "bar")]);
    expect(demuxDockerStream(buf)).toBe("foobar");
  });

  it("filters stdout from interleaved stdout+stderr", () => {
    const buf = Buffer.concat([
      frame(1, "out1"),
      frame(2, "err1"),
      frame(1, "out2"),
    ]);
    expect(demuxDockerStream(buf)).toBe("out1out2");
  });

  it("returns empty string for empty buffer", () => {
    expect(demuxDockerStream(Buffer.alloc(0))).toBe("");
  });

  it("handles truncated frame (incomplete payload) gracefully", () => {
    const full = frame(1, "complete");
    // Chop off last 3 bytes so payload is incomplete
    const truncated = full.subarray(0, full.length - 3);
    expect(demuxDockerStream(truncated)).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// injectTokenIntoUrl
// ─────────────────────────────────────────────────────────────────────────────

describe("injectTokenIntoUrl", () => {
  it("injects x-access-token into HTTPS URL", () => {
    expect(
      injectTokenIntoUrl("https://github.com/org/repo.git", "ghp_abc123")
    ).toBe("https://x-access-token:ghp_abc123@github.com/org/repo.git");
  });

  it("leaves non-HTTPS URLs unchanged", () => {
    const sshUrl = "git@github.com:org/repo.git";
    expect(injectTokenIntoUrl(sshUrl, "token")).toBe(sshUrl);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseGitHubUrl
// ─────────────────────────────────────────────────────────────────────────────

describe("parseGitHubUrl", () => {
  it("parses HTTPS URL with .git suffix", () => {
    expect(
      parseGitHubUrl("https://github.com/Cogni-DAO/node-template.git")
    ).toEqual({
      owner: "Cogni-DAO",
      repo: "node-template",
    });
  });

  it("parses HTTPS URL without .git suffix", () => {
    expect(parseGitHubUrl("https://github.com/org/repo")).toEqual({
      owner: "org",
      repo: "repo",
    });
  });

  it("parses SSH URL", () => {
    expect(parseGitHubUrl("git@github.com:org/repo.git")).toEqual({
      owner: "org",
      repo: "repo",
    });
  });

  it("returns undefined for non-GitHub URLs", () => {
    expect(parseGitHubUrl("https://gitlab.com/org/repo.git")).toEqual({
      owner: undefined,
      repo: undefined,
    });
  });

  it("returns undefined for malformed input", () => {
    expect(parseGitHubUrl("not-a-url")).toEqual({
      owner: undefined,
      repo: undefined,
    });
  });
});
