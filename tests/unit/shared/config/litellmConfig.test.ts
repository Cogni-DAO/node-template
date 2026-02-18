// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/shared/config/litellmConfig`
 * Purpose: Validate default model selection from LiteLLM config metadata.
 * Scope: Unit tests for getDefaultModelFromLiteLLMConfig; uses temporary fixture files.
 * Invariants: Fail-fast on missing config, invalid YAML, missing defaults.
 * Side-effects: none (temp filesystem only)
 * Links: src/shared/config/litellmConfig.ts, platform/infra/services/runtime/configs/litellm.config.yaml
 * @public
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

const ORIGINAL_CWD = process.cwd();

function writeLiteLLMConfig(yaml: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "litellm-config-"));
  const configDir = path.join(tmpDir, "platform/infra/services/runtime/configs");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "litellm.config.yaml"), yaml);
  return tmpDir;
}

async function loadLiteLLMConfigModule() {
  vi.resetModules();
  return import("@/shared/config/litellmConfig");
}

function cleanup(tmpDir: string): void {
  process.chdir(ORIGINAL_CWD);
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

const VALID_CONFIG = `
model_list:
  - model_name: gpt-4o-mini
    model_info:
      metadata:
        cogni:
          default_free: true
  - model_name: deepseek-v3.2
    model_info:
      metadata:
        cogni:
          default_thinking: true
  - model_name: llama-3.3-70b
    model_info:
      metadata:
        cogni:
          default_flash: true
  - model_name: other-model
    model_info:
      metadata:
        cogni:
          something_else: true
`;

describe("getDefaultModelFromLiteLLMConfig", () => {
  it("returns correct default model for each type", async () => {
    const tmpDir = writeLiteLLMConfig(VALID_CONFIG);
    process.chdir(tmpDir);

    try {
      const { getDefaultModelFromLiteLLMConfig } = await loadLiteLLMConfigModule();
      expect(getDefaultModelFromLiteLLMConfig('flash')).toBe('llama-3.3-70b');
      expect(getDefaultModelFromLiteLLMConfig('thinking')).toBe('deepseek-v3.2');
      expect(getDefaultModelFromLiteLLMConfig('free')).toBe('gpt-4o-mini');
    } finally {
      cleanup(tmpDir);
    }
  });

  it("throws MissingDefaultModelError when default not found", async () => {
    const config = `
model_list:
  - model_name: some-model
    model_info:
      metadata:
        cogni:
          default_flash: false
`;
    const tmpDir = writeLiteLLMConfig(config);
    process.chdir(tmpDir);

    try {
      const { getDefaultModelFromLiteLLMConfig } = await loadLiteLLMConfigModule();
      expect(() => getDefaultModelFromLiteLLMConfig('flash')).toThrow(
        /No model found with metadata\.cogni\.default_flash/
      );
    } finally {
      cleanup(tmpDir);
    }
  });

  it("throws MissingDefaultModelError when metadata missing", async () => {
    const config = `
model_list:
  - model_name: some-model
`;
    const tmpDir = writeLiteLLMConfig(config);
    process.chdir(tmpDir);

    try {
      const { getDefaultModelFromLiteLLMConfig } = await loadLiteLLMConfigModule();
      expect(() => getDefaultModelFromLiteLLMConfig('flash')).toThrow(
        /No model found with metadata\.cogni\.default_flash/
      );
    } finally {
      cleanup(tmpDir);
    }
  });

  it("throws LiteLLMConfigNotFoundError when config file missing", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "empty-"));
    process.chdir(tmpDir);
    // No config file created

    try {
      const { getDefaultModelFromLiteLLMConfig } = await loadLiteLLMConfigModule();
      expect(() => getDefaultModelFromLiteLLMConfig('flash')).toThrow(
        /LiteLLM config file not found/
      );
    } finally {
      cleanup(tmpDir);
    }
  });

  it("throws InvalidLiteLLMConfigError on invalid YAML", async () => {
    const tmpDir = writeLiteLLMConfig('invalid: [');
    process.chdir(tmpDir);

    try {
      const { getDefaultModelFromLiteLLMConfig } = await loadLiteLLMConfigModule();
      expect(() => getDefaultModelFromLiteLLMConfig('flash')).toThrow(
        /Invalid LiteLLM config/
      );
    } finally {
      cleanup(tmpDir);
    }
  });

  it("throws InvalidLiteLLMConfigError when model_list missing", async () => {
    const config = `some_other_field: value`;
    const tmpDir = writeLiteLLMConfig(config);
    process.chdir(tmpDir);

    try {
      const { getDefaultModelFromLiteLLMConfig } = await loadLiteLLMConfigModule();
      expect(() => getDefaultModelFromLiteLLMConfig('flash')).toThrow(
        /Missing or invalid model_list array/
      );
    } finally {
      cleanup(tmpDir);
    }
  });

  it("throws InvalidLiteLLMConfigError when model_list not an array", async () => {
    const config = `model_list: not_an_array`;
    const tmpDir = writeLiteLLMConfig(config);
    process.chdir(tmpDir);

    try {
      const { getDefaultModelFromLiteLLMConfig } = await loadLiteLLMConfigModule();
      expect(() => getDefaultModelFromLiteLLMConfig('flash')).toThrow(
        /Missing or invalid model_list array/
      );
    } finally {
      cleanup(tmpDir);
    }
  });

  it("throws InvalidLiteLLMConfigError when model missing model_name", async () => {
    const config = `
model_list:
  - litellm_params:
      model: openrouter/foo
`;
    const tmpDir = writeLiteLLMConfig(config);
    process.chdir(tmpDir);

    try {
      const { getDefaultModelFromLiteLLMConfig } = await loadLiteLLMConfigModule();
      expect(() => getDefaultModelFromLiteLLMConfig('flash')).toThrow(
        /Model missing model_name string/
      );
    } finally {
      cleanup(tmpDir);
    }
  });

  it("respects LITELLM_CONFIG_PATH environment variable", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "custom-path-"));
    const customPath = path.join(tmpDir, "custom-litellm.yaml");
    fs.writeFileSync(customPath, VALID_CONFIG);
    process.env.LITELLM_CONFIG_PATH = customPath;
    process.chdir(ORIGINAL_CWD); // stay in original cwd to ensure default path not used

    try {
      const { getDefaultModelFromLiteLLMConfig } = await loadLiteLLMConfigModule();
      expect(getDefaultModelFromLiteLLMConfig('flash')).toBe('llama-3.3-70b');
    } finally {
      delete process.env.LITELLM_CONFIG_PATH;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("caches config after first load", async () => {
    const tmpDir = writeLiteLLMConfig(VALID_CONFIG);
    process.chdir(tmpDir);

    try {
      const module = await loadLiteLLMConfigModule();
      const first = module.getDefaultModelFromLiteLLMConfig('flash');
      // Write a different config to same path; caching should ignore change
      fs.writeFileSync(
        path.join(tmpDir, "platform/infra/services/runtime/configs/litellm.config.yaml"),
        `
model_list:
  - model_name: new-flash
    model_info:
      metadata:
        cogni:
          default_flash: true
`
      );
      const second = module.getDefaultModelFromLiteLLMConfig('flash');
      expect(second).toBe(first); // still llama-3.3-70b because cached
    } finally {
      cleanup(tmpDir);
    }
  });

  it("picks first matching model when multiple defaults (should not happen)", async () => {
    const config = `
model_list:
  - model_name: first-flash
    model_info:
      metadata:
        cogni:
          default_flash: true
  - model_name: second-flash
    model_info:
      metadata:
        cogni:
          default_flash: true
`;
    const tmpDir = writeLiteLLMConfig(config);
    process.chdir(tmpDir);

    try {
      const { getDefaultModelFromLiteLLMConfig } = await loadLiteLLMConfigModule();
      expect(getDefaultModelFromLiteLLMConfig('flash')).toBe('first-flash');
    } finally {
      cleanup(tmpDir);
    }
  });
});