// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/capabilities/image-generate`
 * Purpose: Factory for ImageGenerateCapability — bridges ai-tools capability interface to LiteLLM adapter.
 * Scope: Creates ImageGenerateCapability from server environment. Does not implement transport.
 * Invariants:
 *   - NO_SECRETS_IN_CONTEXT: LiteLLM master key resolved from env, never passed to tools
 * Side-effects: none (factory only)
 * Links: Called by bootstrap container; consumed by ai-tools image-generate tool.
 *        Uses LITELLM_BASE_URL + LITELLM_MASTER_KEY.
 * @internal
 */

import type { ImageGenerateCapability } from "@cogni/ai-tools";

import { LiteLlmImageGenerateAdapter } from "@/adapters/server";
import type { ServerEnv } from "@/shared/env";

/**
 * Stub ImageGenerateCapability that throws when not configured.
 * Used when LiteLLM is not available.
 */
export const stubImageGenerateCapability: ImageGenerateCapability = {
  generate: async () => {
    throw new Error(
      "ImageGenerateCapability not configured. Requires LITELLM_BASE_URL and LITELLM_MASTER_KEY."
    );
  },
};

/**
 * Create ImageGenerateCapability from server environment.
 *
 * - Configured (LITELLM_BASE_URL + LITELLM_MASTER_KEY): LiteLlmImageGenerateAdapter
 * - Not configured: stub that throws on use
 *
 * @param env - Server environment
 * @returns ImageGenerateCapability backed by appropriate adapter
 */
export function createImageGenerateCapability(
  env: ServerEnv
): ImageGenerateCapability {
  const baseUrl = env.LITELLM_BASE_URL;
  const masterKey = env.LITELLM_MASTER_KEY;

  if (!baseUrl || !masterKey) {
    return stubImageGenerateCapability;
  }

  const adapter = new LiteLlmImageGenerateAdapter({
    baseUrl,
    masterKey,
    timeoutMs: 60_000,
  });
  return { generate: (p) => adapter.generate(p) };
}
