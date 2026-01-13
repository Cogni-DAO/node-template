// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@core/ai/errors`
 * Purpose: Domain error types and normalization for LLM failures.
 * Scope: Defines LlmError, classification helpers, and error-to-code normalization. Does not perform IO or logging.
 * Invariants:
 *   - LlmError captures kind + optional HTTP status at throw site (adapter boundary)
 *   - normalizeErrorToExecutionCode is the SINGLE source of truth for error classification
 *   - ERROR_NORMALIZATION_ONCE: map once at completion layer, propagate everywhere
 * Side-effects: none
 * Links: Used by adapters (throw), completion (catch + normalize), metrics (consume code)
 * @public
 */

import type { AiExecutionErrorCode } from "@cogni/ai-core";

// ─────────────────────────────────────────────────────────────────────────────
// LLM Error Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error classification kinds for LLM failures.
 * Derived from HTTP status codes at adapter boundary.
 */
export type LlmErrorKind =
  | "timeout"
  | "rate_limited"
  | "provider_4xx"
  | "provider_5xx"
  | "aborted"
  | "unknown";

/**
 * Typed error for LLM adapter failures.
 * Thrown by adapters on HTTP/stream errors.
 */
export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly status: number | undefined;

  constructor(message: string, kind: LlmErrorKind, status?: number) {
    super(message);
    this.name = "LlmError";
    this.kind = kind;
    this.status = status;
  }
}

/**
 * Type guard for LlmError.
 */
export function isLlmError(error: unknown): error is LlmError {
  return error instanceof LlmError;
}

/**
 * Classify LlmError kind from HTTP status code.
 */
export function classifyLlmErrorFromStatus(status: number): LlmErrorKind {
  if (status === 408) return "timeout";
  if (status === 429) return "rate_limited";
  if (status >= 400 && status < 500) return "provider_4xx";
  if (status >= 500 && status < 600) return "provider_5xx";
  return "unknown";
}

// ─────────────────────────────────────────────────────────────────────────────
// Error Normalization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize any error to stable AiExecutionErrorCode.
 * Single source of truth for error classification.
 *
 * Priority:
 * 1. AbortError → "aborted"
 * 2. LlmError with status 429 → "rate_limit"
 * 3. LlmError with status 408 → "timeout"
 * 4. LlmError kind fallback
 * 5. Default → "internal"
 */
export function normalizeErrorToExecutionCode(
  error: unknown
): AiExecutionErrorCode {
  // AbortError takes precedence
  if (error instanceof Error && error.name === "AbortError") {
    return "aborted";
  }

  // LlmError with typed classification
  if (isLlmError(error)) {
    // Status-first (most reliable)
    if (error.status === 429) return "rate_limit";
    if (error.status === 408) return "timeout";

    // Kind fallback
    switch (error.kind) {
      case "rate_limited":
        return "rate_limit";
      case "timeout":
        return "timeout";
      case "aborted":
        return "aborted";
      default:
        return "internal";
    }
  }

  // Unknown error type
  return "internal";
}
