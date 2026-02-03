// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@shared/ai/guards/citation.guard`
 * Purpose: Citation enforcement for AI responses mentioning repository code.
 * Scope: Validates that responses mentioning code include proper citations. Does NOT modify responses.
 * Invariants:
 *   - NO_CLAIMS_WITHOUT_CITES: Responses mentioning code/files must include citations
 *   - Citation format: `repo:<repoId>:<path>#L<start>-L<end>@<sha7>`
 *   - Fail-closed: Missing citations result in rejection message
 * Side-effects: none (pure validation)
 * Links: COGNI_BRAIN_SPEC.md
 * @public
 */

import { REPO_CITATION_REGEX } from "@cogni/ai-tools";

/**
 * Patterns that indicate the response mentions repository code/files.
 * These are heuristics - erring on the side of requiring citations.
 */
const CODE_MENTION_PATTERNS = [
  // File path patterns
  /\b(?:src|lib|packages|services|tests?)\/[a-zA-Z0-9_\-./]+\.[a-z]{1,4}\b/i,
  // Function/class definitions
  /\b(?:function|class|interface|type|const|let|var|export|import)\s+[A-Z][a-zA-Z0-9_]*/,
  // Code references like "in the X function" or "the Y class"
  /\b(?:in|the|this)\s+`?[A-Z][a-zA-Z0-9_]+`?\s+(?:function|class|method|component|module|file)/i,
  // Line number references
  /\blines?\s+\d+(?:\s*[-–]\s*\d+)?/i,
  // File extension mentions
  /\b[a-zA-Z0-9_-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|md|json|yaml|yml)\b/,
  // Code block indicators (suggesting code is being discussed)
  /```[a-z]*\n/,
  // Import/require statements being discussed
  /\b(?:import|require|from)\s+['"][^'"]+['"]/,
];

/**
 * Patterns that indicate general discussion without specific code claims.
 * Used to avoid false positives.
 */
const GENERAL_DISCUSSION_PATTERNS = [
  // Questions about how to do something
  /^(?:how|what|where|why|can|should|would)\s/i,
  // Suggestions without specific file references
  /^(?:you\s+(?:could|should|might)|consider|try)\s/i,
  // Generic code concepts
  /\b(?:best\s+practice|pattern|approach|strategy|technique)\b/i,
];

/**
 * Result of citation validation.
 */
export interface CitationValidationResult {
  /** Whether the response passes citation requirements */
  valid: boolean;
  /** Whether the response mentions code/files */
  mentionsCode: boolean;
  /** Number of valid citations found */
  citationCount: number;
  /** Extracted citations */
  citations: string[];
  /** Reason for rejection (if invalid) */
  rejectionReason?: string;
}

/**
 * Options for citation validation.
 */
export interface CitationValidationOptions {
  /** Allowed repository IDs (default: ["main"]) */
  allowedRepoIds?: string[];
  /** Current HEAD sha7 for validation (optional) */
  currentSha?: string;
  /** Whether to require citations (default: true). Set false for non-repo contexts. */
  requireCitations?: boolean;
}

/**
 * Check if response mentions code or files.
 */
function detectsCodeMentions(response: string): boolean {
  // Check if it's general discussion first
  for (const pattern of GENERAL_DISCUSSION_PATTERNS) {
    if (pattern.test(response)) {
      // If it matches general discussion AND has no specific patterns, skip
      const hasSpecificPattern = CODE_MENTION_PATTERNS.some((p) =>
        p.test(response)
      );
      if (!hasSpecificPattern) {
        return false;
      }
    }
  }

  // Check for code mention patterns
  return CODE_MENTION_PATTERNS.some((pattern) => pattern.test(response));
}

/**
 * Extract all repo citations from response.
 */
function extractCitations(response: string): string[] {
  const matches = response.match(REPO_CITATION_REGEX);
  return matches ? [...new Set(matches)] : [];
}

/**
 * Parse a citation token into its components.
 */
export interface ParsedCitation {
  repoId: string;
  path: string;
  lineStart: number;
  lineEnd: number;
  sha: string;
}

/**
 * Parse a citation token.
 * Returns null if the citation is malformed.
 */
export function parseCitation(citation: string): ParsedCitation | null {
  // Format: repo:<repoId>:<path>#L<start>-L<end>@<sha7>
  const match = citation.match(
    /^repo:([a-z0-9_-]+):([^#\s]+)#L(\d+)-L(\d+)@([0-9a-f]{7})$/
  );
  if (!match) {
    return null;
  }

  // All groups are guaranteed to match if the regex matched
  const repoId = match[1];
  const path = match[2];
  const startStr = match[3];
  const endStr = match[4];
  const sha = match[5];

  // Validate all groups were captured (should never fail given regex structure)
  if (!repoId || !path || !startStr || !endStr || !sha) {
    return null;
  }

  const lineStart = parseInt(startStr, 10);
  const lineEnd = parseInt(endStr, 10);

  // Validate line numbers
  if (lineStart < 1 || lineEnd < lineStart) {
    return null;
  }

  return {
    repoId,
    path,
    lineStart,
    lineEnd,
    sha,
  };
}

/**
 * Validate citations against options.
 */
function validateCitations(
  citations: string[],
  options: CitationValidationOptions
): { valid: string[]; invalid: string[] } {
  const allowedRepoIds = options.allowedRepoIds ?? ["main"];
  const valid: string[] = [];
  const invalid: string[] = [];

  for (const citation of citations) {
    const parsed = parseCitation(citation);
    if (!parsed) {
      invalid.push(citation);
      continue;
    }

    // Check repo ID
    if (!allowedRepoIds.includes(parsed.repoId)) {
      invalid.push(citation);
      continue;
    }

    // Check SHA if provided
    if (options.currentSha && parsed.sha !== options.currentSha.slice(0, 7)) {
      // SHA mismatch - citation may be stale but still valid structure
      // We'll allow it but could log a warning in production
    }

    valid.push(citation);
  }

  return { valid, invalid };
}

/**
 * Validate that a response has proper citations for code mentions.
 *
 * Per NO_CLAIMS_WITHOUT_CITES: Responses mentioning code/files must include
 * valid `repo:` citation tokens.
 *
 * @param response - The AI response text to validate
 * @param options - Validation options
 * @returns Validation result with details
 *
 * @example
 * ```typescript
 * const result = validateCitations(
 *   "The function is defined in src/foo.ts repo:main:src/foo.ts#L10-L20@abc1234",
 *   { allowedRepoIds: ["main"] }
 * );
 * if (!result.valid) {
 *   return "Insufficient cited evidence. Please specify the file or module.";
 * }
 * ```
 */
export function validateResponseCitations(
  response: string,
  options: CitationValidationOptions = {}
): CitationValidationResult {
  const requireCitations = options.requireCitations ?? true;
  const mentionsCode = detectsCodeMentions(response);
  const citations = extractCitations(response);
  const { valid } = validateCitations(citations, options);

  // If citations not required, always valid
  if (!requireCitations) {
    return {
      valid: true,
      mentionsCode,
      citationCount: valid.length,
      citations: valid,
    };
  }

  // If no code mentions, citations not required
  if (!mentionsCode) {
    return {
      valid: true,
      mentionsCode: false,
      citationCount: valid.length,
      citations: valid,
    };
  }

  // Code mentioned - require at least one citation
  if (valid.length === 0) {
    return {
      valid: false,
      mentionsCode: true,
      citationCount: 0,
      citations: [],
      rejectionReason:
        "Response mentions code but lacks citations. " +
        "Use core__repo_search or core__repo_open to retrieve code with citations.",
    };
  }

  return {
    valid: true,
    mentionsCode: true,
    citationCount: valid.length,
    citations: valid,
  };
}

/**
 * Standard rejection message for uncited code claims.
 */
export const INSUFFICIENT_CITATION_MESSAGE =
  "Insufficient cited evidence. I need to search the repository to provide " +
  "accurate information. Could you specify which file or module you're asking about?";

/**
 * Check if a response needs citation retry.
 *
 * @param response - The AI response text
 * @param options - Validation options
 * @returns true if response mentions code but lacks citations
 */
export function needsCitationRetry(
  response: string,
  options: CitationValidationOptions = {}
): boolean {
  const result = validateResponseCitations(response, options);
  return !result.valid && result.mentionsCode;
}
