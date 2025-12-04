// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/chat/page`
 * Purpose: Protected chat page with assistant-ui integration.
 * Scope: Client component that displays chat interface using assistant-ui Thread component. Does not handle authentication directly.
 * Invariants: Session guaranteed by (app)/layout auth guard.
 * Side-effects: IO (chat API calls, session management)
 * Notes: Uses assistant-ui with useExternalStoreRuntime; ThreadWelcome customized for Cogni copy.
 * Links: src/components/vendor/assistant-ui/thread.tsx, src/features/ai/chat/providers/ChatRuntimeProvider.client.tsx
 * @public
 */

"use client";

import { signOut } from "next-auth/react";
import { type ReactNode, useEffect, useState } from "react";

import { Thread } from "@/components";
import { ChatRuntimeProvider } from "@/features/ai/chat/providers/ChatRuntimeProvider.client";
import { ChatComposerExtras, useModels } from "@/features/ai/public";
import { useCreditsSummary } from "@/features/payments/public";

const ChatWelcomeWithHint = () => (
  <div className="mx-auto flex h-full w-full max-w-[var(--thread-max-width)] flex-col items-center justify-center">
    <div className="flex flex-col justify-center px-8">
      <div className="fade-in slide-in-from-bottom-2 animate-in font-semibold text-2xl duration-300 ease-out">
        This is where YOU need to add value
      </div>
      <div className="fade-in slide-in-from-bottom-2 animate-in text-2xl text-muted-foreground/65 delay-100 duration-300 ease-out">
        This is dumb right now. Fork this project, and make this AI valuable to
        one specific niche.
      </div>
    </div>
  </div>
);

export default function ChatPage(): ReactNode {
  const modelsQuery = useModels();

  // Initialize with fallback, will be updated by Thread component from API
  const [selectedModel, setSelectedModel] = useState("gpt-4o-mini");
  const defaultModelId = modelsQuery.data?.defaultModelId ?? "gpt-4o-mini";

  const { data: creditsData, isLoading: isCreditsLoading } =
    useCreditsSummary();
  const balance = creditsData?.balanceCredits ?? 0;

  // Update selected model when API data loads
  useEffect(() => {
    if (modelsQuery.data?.defaultModelId && selectedModel === "gpt-4o-mini") {
      setSelectedModel(modelsQuery.data.defaultModelId);
    }
  }, [modelsQuery.data?.defaultModelId, selectedModel]);

  // Auto-select free model if balance is 0 and current model is paid
  useEffect(() => {
    if (isCreditsLoading || !modelsQuery.data) return;

    const currentModel = modelsQuery.data.models.find(
      (m) => m.id === selectedModel
    );
    const isPaid = currentModel && !currentModel.isFree;

    if (balance <= 0 && isPaid) {
      const firstFreeModel = modelsQuery.data.models.find((m) => m.isFree);
      if (firstFreeModel) {
        setSelectedModel(firstFreeModel.id);
      }
    }
  }, [balance, isCreditsLoading, modelsQuery.data, selectedModel]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ChatRuntimeProvider
        selectedModel={selectedModel}
        defaultModelId={defaultModelId}
        onAuthExpired={() => signOut()}
      >
        <Thread
          welcomeMessage={<ChatWelcomeWithHint />}
          composerLeft={
            <ChatComposerExtras
              selectedModel={selectedModel}
              onModelChange={setSelectedModel}
              defaultModelId={defaultModelId}
              balance={balance}
            />
          }
        />
      </ChatRuntimeProvider>
    </div>
  );
}
