// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * decodeAeadKey accepts both key formats that reach the node:
 * 64-char hex (dev `openssl rand -hex 32`) and base64-of-32-bytes
 * (substrate secret materialization). Regression guard for the candidate-a
 * bug where a base64 key was parsed as hex, producing a malformed AEAD key.
 */

import { randomBytes } from "node:crypto";
import { decodeAeadKey } from "@cogni/node-shared";
import { describe, expect, it } from "vitest";

describe("decodeAeadKey", () => {
  const raw = randomBytes(32);

  it("decodes 64-char hex to the same 32 bytes", () => {
    expect(decodeAeadKey(raw.toString("hex")).equals(raw)).toBe(true);
  });

  it("decodes base64 of 32 bytes (substrate format) to the same 32 bytes", () => {
    expect(decodeAeadKey(raw.toString("base64")).equals(raw)).toBe(true);
  });

  it("decodes base64url too", () => {
    expect(decodeAeadKey(raw.toString("base64url")).equals(raw)).toBe(true);
  });

  it("trims surrounding whitespace/newlines", () => {
    expect(decodeAeadKey(`  ${raw.toString("base64")}\n`).equals(raw)).toBe(
      true
    );
  });

  it("rejects a key that is not 32 bytes", () => {
    expect(() => decodeAeadKey(randomBytes(16).toString("hex"))).toThrow();
    expect(() => decodeAeadKey("not-a-real-key")).toThrow();
  });
});
