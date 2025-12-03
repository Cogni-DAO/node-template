// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/ai/config/provider-icons`
 * Purpose: Provides provider icon registry for model selection UI.
 * Scope: Maps provider keys to icon components (custom SVGs + Lucide fallbacks). Does not implement icon rendering logic.
 * Invariants: Icons use currentColor for theme compatibility.
 * Side-effects: none
 * Notes: Custom inline SVG components for major providers, Lucide fallbacks for others.
 * Links: Used by ModelPicker component
 * @internal
 */

import { BrainCircuit, Zap } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

import { AnthropicIcon } from "../icons/providers/AnthropicIcon";
import { OpenAIIcon } from "../icons/providers/OpenAIIcon";
import { QwenIcon } from "../icons/providers/QwenIcon";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * Provider-to-icon mapping
 * Keys match provider_key from LiteLLM model_info
 */
const PROVIDER_ICONS = {
  qwen: QwenIcon,
  hermes: BrainCircuit, // Lucide fallback (no custom SVG)
  openai: OpenAIIcon,
  anthropic: AnthropicIcon,
  default: Zap,
} as const satisfies Record<string, IconComponent>;

/**
 * Extract provider key from model ID
 * Examples:
 * - "qwen3-4b" → "qwen"
 * - "gpt-4o-mini" → "gpt"
 * - "claude-3-haiku" → "claude"
 */
function getProviderKey(modelId: string): keyof typeof PROVIDER_ICONS {
  const match = modelId.match(/^([a-z]+)/i);
  if (!match?.[1]) return "default";

  const key = match[1].toLowerCase();
  return key in PROVIDER_ICONS
    ? (key as keyof typeof PROVIDER_ICONS)
    : "default";
}

/**
 * Get icon component for a model ID
 * Falls back to default icon if provider not found
 */
export function getProviderIcon(modelId: string): IconComponent {
  const providerKey = getProviderKey(modelId);
  return PROVIDER_ICONS[providerKey];
}

/**
 * Get icon component directly from provider key
 * Use when providerKey is available from model_info
 */
export function getIconByProviderKey(
  providerKey: string | undefined
): IconComponent {
  if (!providerKey) return PROVIDER_ICONS.default;
  return providerKey in PROVIDER_ICONS
    ? PROVIDER_ICONS[providerKey as keyof typeof PROVIDER_ICONS]
    : PROVIDER_ICONS.default;
}
