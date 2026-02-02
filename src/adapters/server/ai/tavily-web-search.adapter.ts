// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/ai/tavily-web-search.adapter`
 * Purpose: Tavily API adapter implementing WebSearchCapability.
 * Scope: HTTP transport to Tavily search API. Does NOT define tool contracts.
 * Invariants:
 *   - AUTH_VIA_ADAPTER: API key resolved from config, never from context
 *   - STRUCTURED_RESULTS: Returns typed WebSearchResult
 * Side-effects: IO (HTTP requests to api.tavily.com)
 * Links: TOOL_USE_SPEC.md
 * @internal
 */

import type {
  WebSearchCapability,
  WebSearchParams,
  WebSearchResult,
} from "@cogni/ai-tools";

import { EVENT_NAMES, makeLogger } from "@/shared/observability";

const logger = makeLogger({ component: "TavilyWebSearchAdapter" });

/**
 * Tavily API response shape.
 * Note: Optional fields may be null or undefined depending on request params.
 */
interface TavilySearchResponse {
  results: Array<{
    title: string;
    url: string;
    content: string;
    score?: number | null;
    raw_content?: string | null;
  }>;
  query: string;
}

/**
 * Configuration for TavilyWebSearchAdapter.
 */
export interface TavilyWebSearchConfig {
  /** Tavily API key */
  apiKey: string;
  /** Request timeout in milliseconds (default: 10000) */
  timeoutMs?: number;
}

/**
 * Tavily API adapter implementing WebSearchCapability.
 *
 * Per AUTH_VIA_ADAPTER: API key is resolved from config at construction,
 * never passed in search parameters.
 */
export class TavilyWebSearchAdapter implements WebSearchCapability {
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(config: TavilyWebSearchConfig) {
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? 10000;
  }

  /**
   * Execute a web search via Tavily API.
   */
  async search(params: WebSearchParams): Promise<WebSearchResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          api_key: this.apiKey,
          query: params.query,
          max_results: params.maxResults ?? 5,
          topic: params.topic ?? "general",
          include_raw_content: params.includeRawContent ?? false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        logger.error(
          {
            event: EVENT_NAMES.ADAPTER_TAVILY_ERROR,
            dep: "tavily",
            reasonCode: "http_error",
            status: response.status,
          },
          EVENT_NAMES.ADAPTER_TAVILY_ERROR
        );
        const errorText = await response.text();
        throw new Error(`Tavily API error (${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as TavilySearchResponse;

      return {
        query: data.query,
        results: data.results.map((r) => ({
          title: r.title,
          url: r.url,
          content: r.content,
          // Conditionally include optional fields to satisfy exactOptionalPropertyTypes
          // Note: Tavily API may return null for optional fields, so we check both
          ...(r.score != null && { score: r.score }),
          ...(r.raw_content != null && { rawContent: r.raw_content }),
        })),
      };
    } catch (error) {
      // Log network-level errors (timeout, DNS, connection refused, etc.)
      if (error instanceof Error && error.name === "AbortError") {
        logger.error(
          {
            event: EVENT_NAMES.ADAPTER_TAVILY_ERROR,
            dep: "tavily",
            reasonCode: "timeout",
            durationMs: this.timeoutMs,
          },
          EVENT_NAMES.ADAPTER_TAVILY_ERROR
        );
      } else if (
        error instanceof Error &&
        error.message.startsWith("Tavily API error")
      ) {
        // Already logged above, just re-throw
      } else {
        const reasonCode =
          error instanceof Error && error.message === "fetch failed"
            ? "network_error"
            : "unknown_error";
        logger.error(
          {
            event: EVENT_NAMES.ADAPTER_TAVILY_ERROR,
            dep: "tavily",
            reasonCode,
          },
          EVENT_NAMES.ADAPTER_TAVILY_ERROR
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
