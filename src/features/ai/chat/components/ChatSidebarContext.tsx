"use client";

import { create } from "zustand";

import type { ThreadSummary } from "@/contracts/ai.threads.v1.contract";

interface ChatSidebarState {
  threads: ThreadSummary[];
  activeThreadKey: string | null;
  onSelectThread: ((key: string) => void) | null;
  onNewThread: (() => void) | null;
  onDeleteThread: ((key: string) => void) | null;
}

interface ChatSidebarStore extends ChatSidebarState {
  register: (state: ChatSidebarState) => void;
  unregister: () => void;
}

export const useChatSidebarStore = create<ChatSidebarStore>((set) => ({
  threads: [],
  activeThreadKey: null,
  onSelectThread: null,
  onNewThread: null,
  onDeleteThread: null,
  register: (state) => set(state),
  unregister: () =>
    set({
      threads: [],
      activeThreadKey: null,
      onSelectThread: null,
      onNewThread: null,
      onDeleteThread: null,
    }),
}));
