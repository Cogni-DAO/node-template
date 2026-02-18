---
id: dynamic-default-model-selection
type: spec
title: Dynamic Default Model Selection from LiteLLM Config Metadata
status: draft
spec_state: draft
trust: draft
summary: Replace hardcoded default model with dynamic selection based on default_flash/default_thinking metadata in LiteLLM config.
read_when: Implementing default model resolution for governance schedules, reasoning tasks, or any system component that needs a default model.
implements: proj.context-optimization
owner: derekg1729
created: 2026-02-18
verified: 2026-02-18
tags: [ai, config, governance, litellm]
---

# Dynamic Default Model Selection from LiteLLM Config Metadata

> [!CRITICAL]
> All default model selections must be derived from LiteLLM config metadata, never hardcoded. Fail-fast if metadata missing.

## Context

Cogni uses LiteLLM proxy for model routing and configuration. The LiteLLM config (`litellm.config.yaml`) includes metadata annotations (`cogni.default_flash`, `cogni.default_thinking`, `cogni.default_free`) to designate which models should serve as system defaults. Currently, governance schedules hardcode a default model (`deepseek-v3.2`) and other places may also hardcode defaults (e.g., `gpt-4o-mini`). This prevents runtime configuration changes and makes metadata irrelevant.

## Goal

Replace all hardcoded default model selections with dynamic lookup from LiteLLM config metadata, enabling configuration-driven defaults and eliminating code changes for model switching.

## Non-Goals

- Changing LiteLLM config schema beyond existing metadata fields
- Dynamic model selection at runtime per request (user preference, load balancing)
- Fallback logic beyond fail-fast (if metadata missing, throw error)
- Support for multiple default_flash models (first match wins)

## Core Invariants

1. **NO_HARDCODED_DEFAULT_MODEL**: No system component may hardcode a model ID as a default. All defaults must be resolved via `getDefaultModelFromLiteLLMConfig()` or equivalent.

2. **METADATA_DRIVEN_DEFAULTS**: Default model selection is based solely on `model_info.metadata.cogni.default_flash`, `default_thinking`, `default_free` annotations in LiteLLM config.

3. **FAIL_FAST_IF_MISSING**: If a required default metadata annotation is missing from the config, the system must throw a clear error at startup or first use, not silently fall back to a hardcoded model.

4. **CONFIG_LOADED_AT_RUNTIME**: The LiteLLM config must be read at runtime (not build time) to allow configuration updates without redeploy.

5. **ONE_DEFAULT_PER_TYPE**: Exactly one model must be annotated with `default_flash: true`. Similarly for `default_thinking: true` and `default_free: true`. The selection logic picks the first matching model; duplicates are ignored (first wins). This is enforced by validation tooling (optional).

6. **MODEL_ID_CANONICAL**: The resolved default model ID is the `model_name` field from LiteLLM config (e.g., `llama-3.3-70b`), not the underlying provider model name.

## Design

### 1. Default Model Resolution Utility

Create a shared utility `getDefaultModelFromLiteLLMConfig(type: 'flash' | 'thinking' | 'free'): string` that:

- Reads `litellm.config.yaml` from the configured path (default: `platform/infra/services/runtime/configs/litellm.config.yaml`)
- Parses YAML, validates basic structure
- Iterates over `model_list`, finds first model where `model_info.metadata.cogni[type] === true`
- Returns `model_name`
- Throws `MissingDefaultModelError` if no model matches

**Performance**: The config should be cached after first read (with file watcher optional). Since config changes infrequently, reading on each call is acceptable.

**Configuration Path**: Should be configurable via environment variable `LITELLM_CONFIG_PATH` with default fallback.

### 2. Integration Points

| Component | Current Hardcode | New Default Type | Notes |
|-----------|------------------|------------------|-------|
| `syncGovernanceSchedules.ts` | `GOVERNANCE_MODEL = "deepseek-v3.2"` | `flash` | Governance schedules are general-purpose tasks; use default_flash (fast, cost-effective). |
| Reasoning-heavy tasks (future) | (none) | `thinking` | For tasks requiring deep reasoning, use default_thinking. |
| Free-tier fallback | `gpt-4o-mini` (in tests) | `free` | For free-tier users or zero-credit contexts, use default_free. |

**Implementation steps**:

1. **Create utility** in `src/shared/config/litellmConfig.ts` (or `packages/config` if cross-package)
2. **Update `syncGovernanceSchedules.ts`**:
   - Import `getDefaultModelFromLiteLLMConfig`
   - Replace `GOVERNANCE_MODEL` with `getDefaultModelFromLiteLLMConfig('flash')`
   - Remove TODO comment
3. **Update tests** to mock config or use test config fixture.

### 3. Configuration Validation

Add a validation script (or integrate into existing config validation) that ensures:

- Exactly one `default_flash` exists
- Exactly one `default_thinking` exists
- Exactly one `default_free` exists (optional)
- No duplicate annotations

Validation can run as part of CI/CD or startup health check.

### 4. Error Handling

- **Missing config file**: Throw `ConfigNotFoundError` with path.
- **Invalid YAML**: Throw `InvalidConfigError` with parsing details.
- **Missing default**: Throw `MissingDefaultModelError` with type and config snippet.

All errors should be logged and cause startup failure (for critical systems) or fallback to safe default? According to invariant #3, fail-fast. However, for backward compatibility, we may allow a fallback to a well-known default (e.g., `gpt-4o-mini`) but with loud warnings. However, the spec recommends fail-fast to enforce config correctness.

**Tradeoff**: Fail-fast ensures configuration integrity but may cause deployment failures if config is malformed. Since config is managed as code, failures will be caught at deploy time.

### 5. Testing Strategy

- **Unit tests**: Parse mock config, extract defaults, handle missing/duplicate annotations.
- **Integration test**: Use a test config fixture (`litellm.test.config.yaml`) to verify resolution works in real scenario.
- **Contract test**: Ensure governance schedule creation uses resolved default model (mock utility).
- **Validation test**: Run validation script on production config as part of CI.

## Schema

The LiteLLM config schema already supports metadata. No changes required.

## File Pointers

| File | Change |
|------|--------|
| `src/shared/config/litellmConfig.ts` | New utility: `getDefaultModelFromLiteLLMConfig`, `MissingDefaultModelError`, config loading logic. |
| `packages/scheduler-core/src/services/syncGovernanceSchedules.ts` | Replace `GOVERNANCE_MODEL` with dynamic lookup. |
| `platform/infra/services/runtime/configs/litellm.config.yaml` | Verify metadata annotations exist. |
| `tests/unit/shared/config/litellmConfig.test.ts` | Unit tests for utility. |
| `tests/integration/litellm/default-model-selection.int.test.ts` | Integration test with test config. |
| `scripts/validate-litellm-config.js` | Optional validation script. |

## Design Decisions

### 1. Why `model_name` not `litellm_params.model`?

The `model_name` is the alias used across Cogni system (e.g., `llama-3.3-70b`). The underlying provider model (`openrouter/meta-llama/llama-3.3-70b-instruct`) is an implementation detail hidden by LiteLLM proxy. Using `model_name` ensures consistency with other parts of the system.

### 2. Why fail-fast instead of fallback?

Hardcoded fallbacks recreate the problem we're solving: they make metadata optional and allow config drift. Fail-fast ensures the configuration is correct and forces operators to explicitly define defaults. This aligns with "configuration as code" philosophy.

### 3. Why not support multiple defaults?

Multiple defaults would introduce ambiguity. The system needs a single default for each category. If multiple models are annotated, the first one wins (deterministic). Validation script can warn about duplicates.

### 4. Why runtime config loading vs build-time injection?

Runtime loading allows config changes without rebuilding/deploying code. Since config is separate from code (infra-as-code), we can update config independently. This is consistent with other configuration (e.g., feature flags).

## Acceptance Checks

- [ ] `syncGovernanceSchedules.ts` no longer contains a hardcoded model string.
- [ ] `getDefaultModelFromLiteLLMConfig('flash')` returns the model annotated with `default_flash: true` in the config.
- [ ] Missing metadata throws a clear error.
- [ ] Unit tests cover all error cases.
- [ ] Integration test passes with test config.
- [ ] Validation script passes on production config.
- [ ] All existing governance schedule tests pass (with mocked config).

## Related

- Task.0068: Dynamic default model selection from LiteLLM config metadata
- LiteLLM config documentation: [litellm.config.yaml](../../platform/infra/services/runtime/configs/litellm.config.yaml)
- OpenClaw context optimization spec: [openclaw-context-optimization.md](openclaw-context-optimization.md)