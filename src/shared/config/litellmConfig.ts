// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@shared/config/litellmConfig`
 * Purpose: Read LiteLLM config file and extract default models based on metadata annotations.
 * Scope: Server-side only. Reads litellm.config.yaml from configured path (default: platform/infra/services/runtime/configs/litellm.config.yaml).
 *        Caches the parsed config after first read.
 * Invariants: Fail-fast if config missing, invalid YAML, or missing default annotation.
 * Side-effects: IO (reads config file) on first call only.
 * Links: platform/infra/services/runtime/configs/litellm.config.yaml
 * @public
 */

import fs from "node:fs";
import path from "node:path";

import { parse } from "yaml";

/**
 * LiteLLM model entry shape (minimal for default detection).
 */
interface LiteLLMModel {
  model_name: string;
  model_info?: {
    metadata?: {
      cogni?: {
        default_flash?: boolean;
        default_thinking?: boolean;
        default_free?: boolean;
      };
    };
  };
}

/**
 * LiteLLM config shape (minimal).
 */
interface LiteLLMConfig {
  model_list: LiteLLMModel[];
}

/**
 * Error thrown when LiteLLM config file cannot be found.
 */
export class LiteLLMConfigNotFoundError extends Error {
  constructor(configPath: string) {
    super(`LiteLLM config file not found at ${configPath}`);
    this.name = "LiteLLMConfigNotFoundError";
  }
}

/**
 * Error thrown when LiteLLM config YAML is invalid.
 */
export class InvalidLiteLLMConfigError extends Error {
  constructor(message: string) {
    super(`Invalid LiteLLM config: ${message}`);
    this.name = "InvalidLiteLLMConfigError";
  }
}

/**
 * Error thrown when no model is annotated as default for the requested type.
 */
export class MissingDefaultModelError extends Error {
  constructor(type: 'flash' | 'thinking' | 'free') {
    super(`No model found with metadata.cogni.default_${type}: true in LiteLLM config`);
    this.name = "MissingDefaultModelError";
  }
}

let cachedConfig: LiteLLMConfig | null = null;

function getConfigPath(): string {
  // Allow override via environment variable
  const envPath = process.env.LITELLM_CONFIG_PATH;
  if (envPath) {
    return envPath;
  }
  // Default path relative to repository root
  return path.join(process.cwd(), 'platform/infra/services/runtime/configs/litellm.config.yaml');
}

/**
 * Load and parse LiteLLM config from disk.
 * @throws {LiteLLMConfigNotFoundError} if config file does not exist
 * @throws {InvalidLiteLLMConfigError} if YAML parsing fails or config shape invalid
 */
function loadLiteLLMConfig(): LiteLLMConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    throw new LiteLLMConfigNotFoundError(configPath);
  }

  const content = fs.readFileSync(configPath, 'utf8');

  let parsed: unknown;
  try {
    parsed = parse(content);
  } catch (error) {
    throw new InvalidLiteLLMConfigError(
      `Failed to parse YAML: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Basic validation
  if (!parsed || typeof parsed !== 'object') {
    throw new InvalidLiteLLMConfigError('Config is not an object');
  }

  const config = parsed as Partial<LiteLLMConfig>;
  if (!Array.isArray(config.model_list)) {
    throw new InvalidLiteLLMConfigError('Missing or invalid model_list array');
  }

  // Ensure each model has model_name string (optional but helpful)
  for (const model of config.model_list) {
    if (typeof model.model_name !== 'string') {
      throw new InvalidLiteLLMConfigError('Model missing model_name string');
    }
  }

  return config as LiteLLMConfig;
}

/**
 * Get the LiteLLM config, cached after first load.
 */
function getLiteLLMConfig(): LiteLLMConfig {
  if (cachedConfig) {
    return cachedConfig;
  }
  cachedConfig = loadLiteLLMConfig();
  return cachedConfig;
}

/**
 * Retrieve the default model name for a given type (flash, thinking, free).
 * @param type - Which default to retrieve: 'flash', 'thinking', or 'free'
 * @returns The model_name of the first model annotated with default_{type}: true
 * @throws {MissingDefaultModelError} if no such model exists
 */
export function getDefaultModelFromLiteLLMConfig(type: 'flash' | 'thinking' | 'free'): string {
  const config = getLiteLLMConfig();
  const property = `default_${type}` as const;

  for (const model of config.model_list) {
    if (model.model_info?.metadata?.cogni?.[property] === true) {
      return model.model_name;
    }
  }

  throw new MissingDefaultModelError(type);
}