// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@components/markdown`
 * Purpose: Lightweight trusted-text renderer for work-item bodies and knowledge text entries.
 * Scope: Preserves line breaks without introducing a markdown parser dependency in node repos.
 * @public
 */

"use client";

import { cn } from "@cogni/node-ui-kit/util/cn";
import type { ReactElement } from "react";

interface MarkdownProps {
  readonly content: string;
  readonly className?: string;
}

export function Markdown({ content, className }: MarkdownProps): ReactElement {
  return (
    <div className={cn("whitespace-pre-wrap break-words text-sm leading-7", className)}>
      {content}
    </div>
  );
}
