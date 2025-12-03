// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/ai/config/provider-icons`
 * Purpose: Provides provider icon registry for model selection UI.
 * Scope: Maps model IDs to Lucide icon components based on provider prefixes. Does not implement icon rendering logic.
 * Invariants: Uses only Lucide icons (bundled with app).
 * Side-effects: none
 * Notes: Icons inferred from model ID prefixes; fallback to SparklesIcon.
 * Links: Used by ModelPicker component
 * @internal
 */

import {
  BrainCircuit,
  type LucideIcon,
  MessageCircle,
  Sparkles,
  Zap,
} from "lucide-react";

/**
 * Provider-to-icon mapping
 * Keys match provider_key from LiteLLM model_info
 */
const PROVIDER_ICONS = {
  qwen: MessageCircle,
  hermes: BrainCircuit,
  openai: Sparkles,
  anthropic: BrainCircuit,
  default: Zap,
} as const satisfies Record<string, LucideIcon>;

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
 * Get Lucide icon component for a model ID
 * Falls back to default icon if provider not found
 */
export function getProviderIcon(modelId: string): LucideIcon {
  const providerKey = getProviderKey(modelId);
  return PROVIDER_ICONS[providerKey];
}

/**
 * Get Lucide icon component directly from provider key
 * Use when providerKey is available from model_info
 */
export function getIconByProviderKey(
  providerKey: string | undefined
): LucideIcon {
  if (!providerKey) return PROVIDER_ICONS.default;
  return providerKey in PROVIDER_ICONS
    ? PROVIDER_ICONS[providerKey as keyof typeof PROVIDER_ICONS]
    : PROVIDER_ICONS.default;
}
