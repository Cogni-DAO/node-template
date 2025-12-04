// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/ai/chat/components/ChatComposerExtras`
 * Purpose: Provides composer toolbar extras for chat including model selection.
 * Scope: Smart component managing model selection state, localStorage persistence, and API data synchronization. Does not implement model fetching or localStorage utilities (delegates to hooks and preferences module).
 * Invariants: Validates localStorage preference against API models.
 * Side-effects: global (localStorage via preferences module), IO (API fetch via useModels hook)
 * Notes: Designed to be passed as composerLeft slot to kit Thread.
 * Links: ModelPicker component, useModels hook, model-preference module
 * @public
 */

"use client";

import { useEffect, useState } from "react";

import { ModelPicker } from "@/features/ai/components/ModelPicker";
import { useModels } from "@/features/ai/hooks/useModels";
import {
  setPreferredModelId,
  validatePreferredModel,
} from "@/features/ai/preferences/model-preference";

export interface ChatComposerExtrasProps {
  selectedModel: string;
  onModelChange: (model: string) => void;
  defaultModelId: string;
  balance?: number;
}

export function ChatComposerExtras({
  selectedModel,
  onModelChange,
  defaultModelId,
  balance = 0,
}: Readonly<ChatComposerExtrasProps>) {
  const modelsQuery = useModels();
  const [localModel, setLocalModel] = useState(selectedModel);

  // Initialize from localStorage on mount, validate against API models
  useEffect(() => {
    if (modelsQuery.data) {
      const modelIds = modelsQuery.data.models.map((m) => m.id);
      const validated = validatePreferredModel(modelIds, defaultModelId);
      if (validated !== localModel) {
        setLocalModel(validated);
        onModelChange(validated);
      }
    }
  }, [modelsQuery.data, defaultModelId, localModel, onModelChange]);

  const handleModelChange = (modelId: string) => {
    setLocalModel(modelId);
    setPreferredModelId(modelId);
    onModelChange(modelId);
  };

  return (
    <ModelPicker
      models={modelsQuery.data?.models ?? []}
      value={localModel}
      onValueChange={handleModelChange}
      disabled={modelsQuery.isLoading || modelsQuery.isError}
      balance={balance}
    />
  );
}
