// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/ai/chat/components/ChatThreadsSidebarGroup`
 * Purpose: Sidebar group rendering chat thread history with new/select/delete actions.
 * Scope: Renders thread list as SidebarGroup sub-components. Does not manage thread state or fetch data.
 * Invariants: Uses ThreadSummary from ai.threads.v1 contract; all callbacks required.
 * Side-effects: none
 * Links: src/features/ai/chat/components/ChatSidebarContext.tsx, src/contracts/ai.threads.v1.contract.ts
 * @public
 */

"use client";

import { Plus, Trash2 } from "lucide-react";
import type { ReactElement } from "react";

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components";
import type { ThreadSummary } from "@/contracts/ai.threads.v1.contract";
import { cn } from "@/shared/util/cn";

interface ChatThreadsSidebarGroupProps {
  threads: ThreadSummary[];
  activeThreadKey: string | null;
  onSelectThread: (key: string) => void;
  onNewThread: () => void;
  onDeleteThread: (key: string) => void;
}

export function ChatThreadsSidebarGroup({
  threads,
  activeThreadKey,
  onSelectThread,
  onNewThread,
  onDeleteThread,
}: ChatThreadsSidebarGroupProps): ReactElement {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>
        <span className="flex-1">Threads</span>
        <button
          type="button"
          onClick={onNewThread}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs hover:bg-accent"
        >
          <Plus className="size-3" />
          New
        </button>
      </SidebarGroupLabel>
      <SidebarMenu>
        {threads.map((thread) => {
          const isActive = activeThreadKey === thread.stateKey;
          return (
            <SidebarMenuItem key={thread.stateKey}>
              <SidebarMenuButton
                isActive={isActive}
                onClick={() => onSelectThread(thread.stateKey)}
                tooltip={thread.title ?? "Untitled"}
                className={cn("text-xs", isActive && "bg-accent")}
              >
                <span className="truncate">{thread.title ?? "Untitled"}</span>
              </SidebarMenuButton>
              <SidebarMenuAction
                showOnHover
                onClick={() => onDeleteThread(thread.stateKey)}
                aria-label="Delete thread"
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 />
              </SidebarMenuAction>
            </SidebarMenuItem>
          );
        })}
        {threads.length === 0 && (
          <div className="px-3 py-4 text-center text-muted-foreground text-xs">
            No conversations yet
          </div>
        )}
      </SidebarMenu>
    </SidebarGroup>
  );
}
