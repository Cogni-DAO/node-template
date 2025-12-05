// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/_fixtures/ai/fixtures`
 * Purpose: Provides fixture loader for AI test data including models list response.
 * Scope: Loads and types static JSON fixtures for test consistency. Does not implement test logic or assertions.
 * Invariants: Returns typed data matching contract schemas. Fixtures are static; tests stub env vars.
 * Side-effects: none
 * Notes: Single source of truth for models list in all tests. Use vi.stubEnv('DEFAULT_MODEL') in tests.
 * Links: models.response.json, @/contracts/ai.models.v1.contract
 * @internal
 */

import type { ModelsOutput } from "@/contracts/ai.models.v1.contract";
import { aiModelsOperation } from "@/contracts/ai.models.v1.contract";
import type { ModelsCatalog } from "@/shared/ai/model-catalog.server";
import modelsFixture from "./models.response.json";

/**
 * Load canonical models list fixture (static JSON)
 * @returns ModelsOutput with 7 models (5 free, 2 paid) and defaults
 * @throws If fixture doesn't match contract schema (catches drift early)
 */
export function loadModelsFixture(): ModelsOutput {
  // Validate via contract instead of casting - ensures test data matches production schema
  return aiModelsOperation.output.parse(modelsFixture);
}

/**
 * Load models catalog for mocking getCachedModels
 * @returns ModelsCatalog with models array and defaultPreferredModelId
 */
export function loadModelsCatalogFixture(): ModelsCatalog {
  return {
    models: modelsFixture.models,
    defaultModelId: modelsFixture.defaultPreferredModelId,
  };
}

/**
 * Create models response with both free and paid models
 * @returns ModelsOutput for testing credit-based model selection
 */
export function createModelsWithFree(): ModelsOutput {
  return {
    models: [
      { id: "free-model-123", name: "Free Model", isFree: true },
      { id: "paid-model-456", name: "Paid Model", isFree: false },
    ],
    defaultPreferredModelId: "paid-model-456",
    defaultFreeModelId: "free-model-123",
  };
}

/**
 * Create models response with only paid models (no free models available)
 * @returns ModelsOutput for testing blocked state when user has zero credits
 */
export function createModelsPaidOnly(): ModelsOutput {
  return {
    models: [{ id: "gpt-5-nano", name: "GPT-5 Nano", isFree: false }],
    defaultPreferredModelId: "gpt-5-nano",
    defaultFreeModelId: null,
  };
}

/**
 * Create models response with only Claude models (no OpenAI)
 * @returns ModelsOutput for testing that UI doesn't invent model IDs
 */
export function createModelsClaudeOnly(): ModelsOutput {
  return {
    models: [
      { id: "claude-haiku-free", name: "Claude Haiku", isFree: true },
      { id: "claude-sonnet-paid", name: "Claude Sonnet", isFree: false },
    ],
    defaultPreferredModelId: "claude-sonnet-paid",
    defaultFreeModelId: "claude-haiku-free",
  };
}

/**
 * Create models response with multiple free models
 * @returns ModelsOutput for testing user choice preservation
 */
export function createModelsMultipleFree(): ModelsOutput {
  return {
    models: [
      { id: "gpt-4o-mini", name: "GPT-4o Mini", isFree: true },
      { id: "claude-haiku", name: "Claude Haiku", isFree: true },
      { id: "gpt-5-nano", name: "GPT-5 Nano", isFree: false },
    ],
    defaultPreferredModelId: "gpt-5-nano",
    defaultFreeModelId: "gpt-4o-mini",
  };
}
