// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/ai/services/pii-masking`
 * Purpose: Best-effort PII and secret masking for persisted message content.
 * Scope: Regex-based masking of API keys, tokens, and common secret patterns. Does not guarantee complete PII removal.
 * Invariants:
 *   - REDACT_BEFORE_PERSIST: applied before saveThread()
 *   - Best-effort only — stored content must still be treated as personal data
 * Side-effects: none
 * Links: docs/spec/thread-persistence.md
 * @public
 */

import type { UIMessage } from "ai";

/**
 * Patterns for common secret/PII formats.
 * Order matters — more specific patterns first to avoid partial matches.
 */
const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // AWS keys
  { pattern: /AKIA[0-9A-Z]{16}/g, replacement: "[REDACTED_AWS_KEY]" },
  // Generic API keys (sk-*, key-*, token-*, api-* prefixed)
  {
    pattern: /\b(sk|key|token|api)[-_][a-zA-Z0-9_-]{20,}\b/gi,
    replacement: "[REDACTED_API_KEY]",
  },
  // Bearer tokens
  {
    pattern: /Bearer\s+[a-zA-Z0-9._~+/=-]{20,}/gi,
    replacement: "Bearer [REDACTED_TOKEN]",
  },
  // GitHub tokens (ghp_, gho_, ghs_, ghu_, ghr_)
  {
    pattern: /\bgh[pohsr]_[a-zA-Z0-9]{36,}\b/g,
    replacement: "[REDACTED_GH_TOKEN]",
  },
  // Base64-encoded secrets (long base64 strings that look like secrets)
  {
    pattern: /\b[A-Za-z0-9+/]{40,}={0,2}\b/g,
    replacement: "[REDACTED_BASE64]",
  },
];

/**
 * Apply best-effort secret masking to a string.
 */
function maskSecrets(text: string): string {
  let result = text;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Apply PII masking to a UIMessage array before persistence.
 *
 * Per REDACT_BEFORE_PERSIST: masks API keys, tokens, and common secret patterns
 * in text parts. Tool call args and results are also masked.
 *
 * Returns a new array — does not mutate the input.
 */
export function maskMessagesForPersistence(messages: UIMessage[]): UIMessage[] {
  return messages.map((msg) => ({
    ...msg,
    parts: msg.parts.map((part) => {
      if (part.type === "text") {
        return { ...part, text: maskSecrets(part.text) };
      }
      // Mask tool inputs and outputs
      if (part.type === "dynamic-tool") {
        const masked = { ...part } as Record<string, unknown>;
        if (
          "input" in part &&
          part.input !== undefined &&
          part.input !== null
        ) {
          masked.input = JSON.parse(maskSecrets(JSON.stringify(part.input)));
        }
        if (
          "output" in part &&
          part.output !== undefined &&
          part.output !== null
        ) {
          masked.output = JSON.parse(maskSecrets(JSON.stringify(part.output)));
        }
        return masked;
      }
      return part;
    }),
  })) as UIMessage[];
}
