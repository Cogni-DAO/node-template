// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/_lib/models-cache`
 * Purpose: Provides server-side cache for LiteLLM model metadata with long TTL and stale-while-revalidate.
 * Scope: Fetches from LiteLLM /model/info, caches results, validates model IDs. Does not modify model configuration or handle UI state.
 * Invariants: Cache refreshes in background (SWR), stale data served on errors, cold-start failure returns error (no hardcoded fallback).
 * Side-effects: global (module-scoped cache), IO (fetch to LiteLLM /model/info every 1h)
 * Notes: Derives all model metadata from LiteLLM model_info (no app-side hardcoding). Single source of truth: litellm.config.yaml.
 * Links: /api/v1/ai/models route, chat route validation
 * @internal
 */

import type { Model, ModelsOutput } from "@/contracts/ai.models.v1.contract";
import { serverEnv } from "@/shared/env/server";
import { makeLogger } from "@/shared/observability";

const log = makeLogger({ module: "models-cache" });

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour (models change only on LiteLLM restart)

interface CacheEntry {
  data: ModelsOutput;
  timestamp: number;
}

let cache: CacheEntry | null = null;
let refreshPromise: Promise<ModelsOutput> | null = null;

/**
 * Transform LiteLLM /model/info response to our Model schema
 * Handles variant shapes: { data: [...] } or { models: [...] } or raw array
 * Item keys: model_name (preferred) or id
 */
function transformModelInfoResponse(data: unknown): Model[] {
  // Handle multiple wrapper formats
  let modelsList: unknown[];
  if (Array.isArray(data)) {
    modelsList = data;
  } else if (typeof data === "object" && data !== null) {
    const wrapper = data as { data?: unknown[]; models?: unknown[] };
    modelsList = wrapper.data ?? wrapper.models ?? [];
  } else {
    // Explicit error for unexpected shape
    log.error(
      { responseType: typeof data },
      "LiteLLM /model/info unexpected response shape"
    );
    throw new Error(
      `LiteLLM /model/info returned unexpected shape (type: ${typeof data})`
    );
  }

  if (!Array.isArray(modelsList)) {
    log.error({ modelsList }, "LiteLLM /model/info wrapper missing array");
    throw new Error("LiteLLM /model/info response missing models array");
  }

  return modelsList
    .map((item): Model | null => {
      if (typeof item !== "object" || item === null) return null;

      // Prefer model_name, fallback to id
      const id =
        (item as { model_name?: string }).model_name ??
        (item as { id?: string }).id;

      // Drop malformed entries with no valid ID
      if (!id) return null;

      const modelInfo = ((item as Record<string, unknown>).model_info ??
        {}) as {
        display_name?: string;
        is_free?: boolean;
        provider_key?: string;
      };

      // Use model_info fields from LiteLLM config (no inference)
      return {
        id,
        name: modelInfo.display_name,
        isFree: modelInfo.is_free ?? false, // Default to paid if missing
        providerKey: modelInfo.provider_key,
      };
    })
    .filter((item): item is Model => item !== null);
}

/**
 * Fetch models from LiteLLM /model/info endpoint
 * Throws on error - caller handles fallback to stale cache
 */
async function fetchModelsFromLiteLLM(): Promise<ModelsOutput> {
  const masterKey = serverEnv().LITELLM_MASTER_KEY;

  // AbortController for timeout (compatible with Node 16+)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${serverEnv().LITELLM_BASE_URL}/model/info`, {
      method: "GET",
      headers: masterKey ? { Authorization: `Bearer ${masterKey}` } : {},
      signal: controller.signal,
    });

    if (!response.ok) {
      // LOUD ERROR: Auth/config mistakes observable
      log.error(
        {
          status: response.status,
          baseUrl: serverEnv().LITELLM_BASE_URL,
          hasMasterKey: !!masterKey,
        },
        "LiteLLM /model/info request failed"
      );
      throw new Error(`LiteLLM /model/info returned ${response.status}`);
    }

    const data = await response.json();
    const models = transformModelInfoResponse(data);

    if (models.length === 0) {
      log.error("LiteLLM /model/info returned empty list");
      throw new Error("LiteLLM returned no models");
    }

    return {
      models,
      defaultModelId: serverEnv().DEFAULT_MODEL,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Get cached models list with SWR (stale-while-revalidate)
 * - Returns cached data if fresh (< TTL)
 * - Returns stale data immediately + triggers background refresh if expired
 * - Throws on first call if LiteLLM unreachable (no cache, no fallback)
 */
export async function getCachedModels(): Promise<ModelsOutput> {
  const now = Date.now();

  // Fresh cache hit
  if (cache && now - cache.timestamp < CACHE_TTL_MS) {
    return cache.data;
  }

  // Stale cache: return immediately + refresh in background
  if (cache) {
    const staleData = cache.data; // Capture for closure

    // Trigger background refresh if not already in progress
    if (!refreshPromise) {
      refreshPromise = fetchModelsFromLiteLLM()
        .then((data) => {
          cache = { data, timestamp: Date.now() };
          refreshPromise = null;
          return data;
        })
        .catch((err) => {
          log.warn(
            { err },
            "Background models refresh failed, serving stale cache"
          );
          refreshPromise = null;
          // Serve stale cache
          return staleData;
        });
    }
    return staleData; // Return stale immediately (SWR)
  }

  // No cache: blocking fetch (cold start)
  // If this fails, let it throw - caller returns 503
  const data = await fetchModelsFromLiteLLM();
  cache = { data, timestamp: now };
  return data;
}

/**
 * Check if a model ID is in the allowed list (fast, cached)
 */
export async function isModelAllowed(modelId: string): Promise<boolean> {
  try {
    const { models } = await getCachedModels();
    return models.some((m) => m.id === modelId);
  } catch (error) {
    // LOUD ERROR: Make allowlist failures observable
    log.error(
      { err: error, modelId },
      "Model allowlist unavailable, allowing DEFAULT_MODEL only"
    );
    // If cache unavailable, only allow DEFAULT_MODEL (fail-open for default only)
    return modelId === serverEnv().DEFAULT_MODEL;
  }
}

/**
 * Get default model ID (from env, not cache)
 */
export function getDefaultModelId(): string {
  return serverEnv().DEFAULT_MODEL;
}
