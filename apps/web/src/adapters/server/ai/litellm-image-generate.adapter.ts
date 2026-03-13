// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/ai/litellm-image-generate.adapter`
 * Purpose: LiteLLM adapter implementing ImageGenerateCapability via chat completions with image output.
 * Scope: HTTP transport to LiteLLM proxy for image generation. Does NOT define tool contracts.
 * Invariants:
 *   - AUTH_VIA_ADAPTER: LiteLLM master key resolved from config, never from context
 *   - ARTIFACT_BYTES_NEVER_IN_STATE: Returns base64 to capability caller, not to LangGraph state
 * Side-effects: IO (HTTP requests to LiteLLM proxy)
 * Links: task.0163, TOOL_USE_SPEC.md
 * @internal
 */

import type {
  ImageGenerateCapability,
  ImageGenerateParams,
  ImageGenerateResult,
} from "@cogni/ai-tools";

import { EVENT_NAMES, makeLogger } from "@/shared/observability";

const logger = makeLogger({ component: "LiteLlmImageGenerateAdapter" });

/** Default model for image generation (matches litellm.config.yaml entry). */
const DEFAULT_IMAGE_MODEL = "gemini-2.0-flash-image";

/**
 * Configuration for LiteLlmImageGenerateAdapter.
 */
export interface LiteLlmImageGenerateConfig {
  /** LiteLLM proxy base URL (e.g., "http://litellm:4000") */
  baseUrl: string;
  /** LiteLLM master key for authentication */
  masterKey: string;
  /** Request timeout in milliseconds (default: 60000 — image gen is slow) */
  timeoutMs?: number;
}

/**
 * OpenRouter image generation response shape.
 * Images are returned in `choices[].message.images[]` as data URIs.
 */
interface LiteLlmImageResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      images?: Array<{
        image_url?: {
          url?: string;
        };
      }>;
    };
  }>;
  model?: string;
}

/**
 * LiteLLM adapter for image generation via chat completions.
 *
 * Routes through LiteLLM proxy → OpenRouter → Gemini Flash (image generation).
 * The model returns images in `message.images[0].image_url.url` as `data:image/png;base64,...`.
 *
 * Per AUTH_VIA_ADAPTER: LiteLLM master key is resolved from config at construction.
 */
export class LiteLlmImageGenerateAdapter implements ImageGenerateCapability {
  private readonly baseUrl: string;
  private readonly masterKey: string;
  private readonly timeoutMs: number;

  constructor(config: LiteLlmImageGenerateConfig) {
    this.baseUrl = config.baseUrl;
    this.masterKey = config.masterKey;
    this.timeoutMs = config.timeoutMs ?? 60_000;
  }

  async generate(params: ImageGenerateParams): Promise<ImageGenerateResult> {
    const model = params.model ?? DEFAULT_IMAGE_MODEL;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.masterKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "user",
              content: params.prompt,
            },
          ],
          // Signal to OpenRouter/Gemini that we want image output
          modalities: ["text", "image"],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "[unreadable]");
        logger.error(
          {
            event: EVENT_NAMES.ADAPTER_IMAGE_GENERATE_ERROR,
            dep: "litellm",
            reasonCode: "http_error",
            status: response.status,
          },
          EVENT_NAMES.ADAPTER_IMAGE_GENERATE_ERROR
        );
        throw new Error(
          `LiteLLM image generation error (${response.status}): ${errorText.slice(0, 512)}`
        );
      }

      const data = (await response.json()) as LiteLlmImageResponse;

      // Extract image from response — OpenRouter returns in message.images[]
      const images = data.choices?.[0]?.message?.images;
      const imageUrl = images?.[0]?.image_url?.url;

      if (!imageUrl) {
        logger.error(
          {
            event: EVENT_NAMES.ADAPTER_IMAGE_GENERATE_ERROR,
            dep: "litellm",
            reasonCode: "no_image_in_response",
            hasChoices: !!data.choices?.length,
          },
          EVENT_NAMES.ADAPTER_IMAGE_GENERATE_ERROR
        );
        throw new Error("No image returned in LiteLLM response");
      }

      // Parse data URI: "data:image/png;base64,<base64data>"
      const { mimeType, base64 } = parseDataUri(imageUrl);

      return {
        imageBase64: base64,
        mimeType,
        model: data.model ?? model,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        logger.error(
          {
            event: EVENT_NAMES.ADAPTER_IMAGE_GENERATE_ERROR,
            dep: "litellm",
            reasonCode: "timeout",
            durationMs: this.timeoutMs,
          },
          EVENT_NAMES.ADAPTER_IMAGE_GENERATE_ERROR
        );
      } else if (
        !(
          error instanceof Error &&
          error.message.startsWith("LiteLLM image generation error")
        )
      ) {
        const reasonCode =
          error instanceof Error && error.message === "fetch failed"
            ? "network_error"
            : "unknown_error";
        logger.error(
          {
            event: EVENT_NAMES.ADAPTER_IMAGE_GENERATE_ERROR,
            dep: "litellm",
            reasonCode,
          },
          EVENT_NAMES.ADAPTER_IMAGE_GENERATE_ERROR
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Parse a data URI into MIME type and base64 payload.
 * Expected format: "data:<mimeType>;base64,<data>"
 */
function parseDataUri(uri: string): { mimeType: string; base64: string } {
  const match = uri.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) {
    throw new Error(
      "Invalid data URI format — expected data:<mime>;base64,..."
    );
  }
  // match[1] and match[2] are guaranteed by the regex groups above
  return { mimeType: match[1] as string, base64: match[2] as string };
}
