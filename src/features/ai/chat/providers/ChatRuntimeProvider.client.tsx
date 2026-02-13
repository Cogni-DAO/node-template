// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/chat/providers/ChatRuntimeProvider`
 * Purpose: Runtime provider for chat using AI SDK streaming with multi-turn state.
 * Scope: Feature-local provider. Uses useChatRuntime for AI SDK Data Stream Protocol streaming. Manages stateKey state for conversation continuity. Does not persist messages or manage auth.
 * Invariants:
 *   - CLIENT_SENDS_MESSAGE_ONLY: prepareSendMessagesRequest extracts last user message text and sends { message, model, graphName, stateKey }
 *   - THREAD_STATE_BY_KEY: stateKey stored in stateKeyMap map for future thread switching
 * Side-effects: IO (fetch to /api/v1/ai/chat via runtime)
 * Notes: Uses @assistant-ui/react-ai-sdk useChatRuntime; captures X-State-Key from response header
 * Links: ai.chat.v1 contract, chat/AGENTS.md (Thread State Management)
 * @public
 */

"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { useQueryClient } from "@tanstack/react-query";
import { DefaultChatTransport } from "ai";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { ChatError } from "@/contracts/error.chat.v1.contract";
import type { GraphId } from "@/ports";
import * as clientLogger from "@/shared/observability/client";
import { EVENT_NAMES } from "@/shared/observability/events";

import { mapHttpError } from "../utils/mapHttpError";

/**
 * Ref handle for ChatRuntimeProvider
 */
export interface ChatRuntimeRef {
  retryLastSend: () => void;
}

interface ChatRuntimeProviderProps {
  children: ReactNode;
  selectedModel: string;
  selectedGraph: GraphId;
  defaultModelId: string;
  onAuthExpired?: () => void;
  onError?: (error: ChatError) => void;
}

export function ChatRuntimeProvider({
  children,
  selectedModel,
  selectedGraph,
  defaultModelId,
  onAuthExpired,
  onError,
}: ChatRuntimeProviderProps) {
  const queryClient = useQueryClient();
  const selectedModelRef = useRef(selectedModel);
  const selectedGraphRef = useRef(selectedGraph);

  // State key for multi-turn conversations
  // Map pattern preserved for future thread switching/forks support (see chat/AGENTS.md)
  // Server generates stateKey on first request, we capture from X-State-Key and reuse
  const [stateKeyMap, setStateKeyMap] = useState<Record<string, string>>({});
  const activeStateKey = "default"; // Placeholder for future state/thread selection
  const stateKey = stateKeyMap[activeStateKey];
  const stateKeyRef = useRef(stateKey);

  // Keep refs in sync
  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  useEffect(() => {
    selectedGraphRef.current = selectedGraph;
  }, [selectedGraph]);

  useEffect(() => {
    stateKeyRef.current = stateKey;
  }, [stateKey]);

  // Handle response - capture stateKey and handle errors
  const handleResponse = useCallback(
    async (response: Response) => {
      // Capture stateKey from response header for multi-turn continuity
      // Server generates stateKey on first request, we reuse it for subsequent requests
      const newStateKey = response.headers.get("X-State-Key");
      if (newStateKey && newStateKey !== stateKeyRef.current) {
        setStateKeyMap((prev) => ({
          ...prev,
          [activeStateKey]: newStateKey,
        }));
      }

      if (response.status === 401) {
        onAuthExpired?.();
        throw new Error("Unauthorized");
      }

      if (response.status === 402) {
        const body = await response.json().catch(() => ({}));
        const error = mapHttpError(402, body, crypto.randomUUID());
        onError?.(error);
        throw new Error("Insufficient credits");
      }

      if (response.status === 409) {
        // UX-001: Invalid model - log warning but let retry happen via body.model
        clientLogger.warn(EVENT_NAMES.CLIENT_CHAT_MODEL_INVALID_RETRY, {
          model: selectedModelRef.current,
          defaultModelId,
        });
        // The server returns defaultModelId in the 409 response
        // For now, throw to trigger retry - user can resend with default model
        throw new Error("Invalid model");
      }

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const error = mapHttpError(response.status, body, crypto.randomUUID());
        onError?.(error);
        throw new Error(body.error || "Request failed");
      }
    },
    [defaultModelId, onAuthExpired, onError]
  );

  // Handle stream finish - invalidate credits query
  const handleFinish = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["payments-summary"] });
  }, [queryClient]);

  // Transport-level options (api, request shape, response interception) must be
  // on the transport — they are NOT valid ChatInit/useChatRuntime options.
  // useDynamicChatTransport inside useChatRuntime wraps this in a ref-based
  // proxy, so recreating each render is safe.
  const runtime = useChatRuntime({
    transport: new DefaultChatTransport({
      api: "/api/v1/ai/chat",
      prepareSendMessagesRequest: ({ messages }) => ({
        body: {
          message: extractLastUserText(messages),
          model: selectedModelRef.current,
          graphName: selectedGraphRef.current,
          ...(stateKeyRef.current ? { stateKey: stateKeyRef.current } : {}),
        },
      }),
      // Wrap fetch to intercept responses (stateKey capture + error handling).
      // ChatInit has no onResponse; fetch wrapper is the transport-level equivalent.
      fetch: async (url, init) => {
        const response = await globalThis.fetch(url, init);
        await handleResponse(response);
        return response;
      },
    }),
    onFinish: handleFinish,
    onError: (error) => {
      clientLogger.error(EVENT_NAMES.CLIENT_CHAT_STREAM_ERROR, {
        message: error instanceof Error ? error.message : String(error),
      });
    },
  });

  // Note: disabled prop is handled by parent - composer should be disabled there

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}

/**
 * Extract the text content from the last user message in the messages array.
 * Falls back to empty string if no user message found.
 */
function extractLastUserText(
  messages: Array<{
    role: string;
    parts?: Array<{ type: string; text?: string }>;
  }>
): string {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUserMsg?.parts) return "";
  return lastUserMsg.parts
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text!)
    .join("\n");
}
