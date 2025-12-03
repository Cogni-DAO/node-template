// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/_lib/models-cache`
 * Purpose: Provides server-side cache for available LiteLLM models with TTL and stale-while-revalidate.
 * Scope: Exposes cached model list for validation and API responses without per-request network calls. Does not implement model fetching logic (currently returns hardcoded list).
 * Invariants: Cache refreshes in background (SWR), stale data served on errors.
 * Side-effects: global (module-scoped cache), IO (background fetch intervals)
 * Notes: Temporarily hardcoded from litellm.config.yaml (TODO: fetch from LiteLLM API).
 * Links: /api/v1/ai/models route, chat route validation
 * @internal
 */

import type { Model, ModelsOutput } from "@/contracts/ai.models.v1.contract";
import { serverEnv } from "@/shared/env/server";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Hardcoded models list from platform/infra/services/runtime/configs/litellm.config.yaml
 * TODO: Replace with dynamic fetch from ${LITELLM_BASE_URL}/v1/models
 */
const HARDCODED_MODELS: Model[] = [
  // Free ZDR Models
  { id: "qwen3-4b", name: "Qwen 3 4B (Free)", isFree: true },
  { id: "qwen3-235b", name: "Qwen 3 235B (Free)", isFree: true },
  { id: "qwen3-coder", name: "Qwen 3 Coder (Free)", isFree: true },
  { id: "hermes-3-405b", name: "Hermes 3 405B (Free)", isFree: true },
  { id: "gpt-oss-20b", name: "GPT OSS 20B (Free)", isFree: true },
  // Paid Models
  { id: "gpt-4o-mini", name: "GPT-4O Mini", isFree: false },
  { id: "claude-3-haiku", name: "Claude 3 Haiku", isFree: false },
];

interface CacheEntry {
  data: ModelsOutput;
  timestamp: number;
}

let cache: CacheEntry | null = null;
let refreshPromise: Promise<ModelsOutput> | null = null;

/**
 * Fetch models from LiteLLM (placeholder for future implementation)
 * Currently returns hardcoded list
 */
async function fetchModelsFromLiteLLM(): Promise<ModelsOutput> {
  // TODO: Implement actual fetch from LiteLLM
  // const response = await fetch(`${serverEnv().LITELLM_BASE_URL}/v1/models`);
  // Parse and map to our schema

  return {
    models: HARDCODED_MODELS,
    defaultModelId: serverEnv().DEFAULT_MODEL,
  };
}

/**
 * Get cached models list with SWR (stale-while-revalidate)
 * - Returns cached data if fresh (< TTL)
 * - Returns stale data immediately + triggers background refresh if expired
 * - Blocks only on first call (no cache)
 */
export async function getCachedModels(): Promise<ModelsOutput> {
  const now = Date.now();

  // Fresh cache hit
  if (cache && now - cache.timestamp < CACHE_TTL_MS) {
    return cache.data;
  }

  // Stale cache: return immediately + refresh in background
  if (cache) {
    // Trigger background refresh if not already in progress
    if (!refreshPromise) {
      refreshPromise = fetchModelsFromLiteLLM()
        .then((data) => {
          cache = { data, timestamp: Date.now() };
          refreshPromise = null;
          return data;
        })
        .catch((err) => {
          console.error("Background models refresh failed:", err);
          refreshPromise = null;
          // Keep stale cache on error (cache must exist at this point)
          if (!cache) throw new Error("Cache unexpectedly missing");
          return cache.data;
        });
    }
    return cache.data; // Return stale immediately (SWR)
  }

  // No cache: blocking fetch
  const data = await fetchModelsFromLiteLLM();
  cache = { data, timestamp: now };
  return data;
}

/**
 * Check if a model ID is in the allowed list (fast, cached)
 */
export async function isModelAllowed(modelId: string): Promise<boolean> {
  const { models } = await getCachedModels();
  return models.some((m) => m.id === modelId);
}

/**
 * Get default model ID (cached)
 */
export async function getDefaultModelId(): Promise<string> {
  const { defaultModelId } = await getCachedModels();
  return defaultModelId;
}
