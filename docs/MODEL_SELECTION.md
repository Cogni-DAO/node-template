# Model Selection

## Overview

Users can select their preferred AI model via a dropdown in the chat composer. The selection persists in localStorage and is validated server-side on every request. All model metadata is dynamically fetched from LiteLLM.

## Core Workflow

1. **Server**: Fetches models from LiteLLM `/model/info` endpoint (1h cache with SWR)
2. **Client**: Requests available models from `GET /api/v1/ai/models` (auth-required)
3. **UI**: Displays ModelPicker dialog with search, icons from `model_info.provider_key`, and free/paid badges from `model_info.is_free`
4. **Persistence**: Saves selection to localStorage (`cogni.chat.preferredModelId`), validates against API list on mount
5. **Request**: Chat sends `model` field (REQUIRED) as `selectedModel ?? defaultModelId`
6. **Validation**: Server checks model against cached allowlist (fast O(n) scan)
7. **Fallback**: Invalid model returns 409 + defaultModelId, client auto-retries once with default

## Data Flow

```
litellm.config.yaml (model_info)
  ↓ fetched every 1h
LiteLLM /model/info endpoint
  ↓ cached + SWR
GET /api/v1/ai/models (auth-protected)
  ↓ React Query (5min stale)
ModelPicker UI
  ↓ user selection
localStorage + Chat Request
  ↓ validated
Server (409 if invalid) → LiteLLM Adapter
```

## Single Source of Truth

**All model metadata comes from `platform/infra/services/runtime/configs/litellm.config.yaml`**:

- `model_name` → `id` (e.g., "qwen3-4b", "gpt-4o-mini")
- `model_info.display_name` → `name` (e.g., "Qwen 3 4B (Free)")
- `model_info.is_free` → `isFree` (boolean for tier badge)
- `model_info.provider_key` → `providerKey` (for icon rendering: "qwen", "openai", "anthropic")

**No hardcoded model lists in application code.**

## Key Files

**Config (Source of Truth)**:

- `platform/infra/services/runtime/configs/litellm.config.yaml` - Model definitions with model_info metadata

**API Layer**:

- `src/contracts/ai.models.v1.contract.ts` - Models contract (id, name, isFree, providerKey, defaultModelId)
- `src/app/_lib/models-cache.ts` - Fetches from LiteLLM /model/info, 1h cache with SWR
- `src/app/api/v1/ai/models/route.ts` - Auth-protected endpoint returning cached models
- `src/contracts/ai.chat.v1.contract.ts:58` - Chat contract with REQUIRED `model` field
- `src/app/api/v1/ai/chat/route.ts:162-179` - Validation with 409 retry response

**UI Layer**:

- `src/features/ai/public.ts` - Feature barrel (stable import surface)
- `src/features/ai/components/ModelPicker.tsx` - Dialog+ScrollArea picker with search
- `src/features/ai/components/ChatComposerExtras.tsx` - Composer toolbar integration
- `src/features/ai/config/provider-icons.ts` - Provider key → Lucide icon mapping
- `src/components/kit/chat/Thread.tsx` - Slot-based wrapper (`composerLeft` prop)
- `src/app/(app)/chat/page.tsx:59-89` - State management

## Endpoints

- `GET /api/v1/ai/models` → `{ models: Model[], defaultModelId: string }`
  - Model: `{ id, name?, isFree, providerKey? }`
- `POST /api/v1/ai/chat` → Accepts `model: string` (required), returns 409 if invalid

## Adding New Models

1. Update `litellm.config.yaml` with new model entry and `model_info` fields
2. Restart LiteLLM service
3. Cache refreshes within 1h (or immediately on first request after restart)
4. UI automatically shows new model
