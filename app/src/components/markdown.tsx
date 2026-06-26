// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@components/markdown`
 * Purpose: Renders trusted text - work-item bodies and knowledge text entries - as
 *   GitHub-flavored markdown (headings, bold/italic, lists, tables, links, code).
 *   Content is authored as markdown everywhere, so it renders as markdown everywhere,
 *   with no per-entry "is this markdown?" flag.
 * Scope: Pure presentation. Uses `remark-gfm` for tables/strikethrough/task-lists.
 *   `rehype-raw` is intentionally NOT enabled here - text entries are markdown, and the
 *   dedicated `entryType === 'html'` path (HtmlRenderer) sandboxes raw HTML separately.
 * @public
 */

"use client";

import { cn } from "@cogni/node-ui-kit/util/cn";
import type { ComponentPropsWithoutRef, JSX, ReactElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownProps {
  readonly content: string;
  readonly className?: string;
}

type ElProps<T extends keyof JSX.IntrinsicElements> =
  ComponentPropsWithoutRef<T>;

const components = {
  h1: ({ className, ...props }: ElProps<"h1">) => (
    <h1
      className={cn("mt-6 mb-3 font-semibold text-xl first:mt-0", className)}
      {...props}
    />
  ),
  h2: ({ className, ...props }: ElProps<"h2">) => (
    <h2
      className={cn("mt-6 mb-3 font-semibold text-lg first:mt-0", className)}
      {...props}
    />
  ),
  h3: ({ className, ...props }: ElProps<"h3">) => (
    <h3
      className={cn("mt-5 mb-2 font-semibold text-base first:mt-0", className)}
      {...props}
    />
  ),
  p: ({ className, ...props }: ElProps<"p">) => (
    <p className={cn("my-3 first:mt-0 last:mb-0", className)} {...props} />
  ),
  a: ({ className, ...props }: ElProps<"a">) => (
    <a
      className={cn(
        "font-medium text-primary underline underline-offset-4",
        className
      )}
      target="_blank"
      rel="noreferrer"
      {...props}
    />
  ),
  ul: ({ className, ...props }: ElProps<"ul">) => (
    <ul
      className={cn("my-3 ml-5 list-disc [&>li]:mt-1", className)}
      {...props}
    />
  ),
  ol: ({ className, ...props }: ElProps<"ol">) => (
    <ol
      className={cn("my-3 ml-5 list-decimal [&>li]:mt-1", className)}
      {...props}
    />
  ),
  blockquote: ({ className, ...props }: ElProps<"blockquote">) => (
    <blockquote
      className={cn(
        "my-3 border-border border-l-2 pl-4 text-muted-foreground italic",
        className
      )}
      {...props}
    />
  ),
  hr: ({ className, ...props }: ElProps<"hr">) => (
    <hr className={cn("my-4 border-border border-b", className)} {...props} />
  ),
  table: ({ className, ...props }: ElProps<"table">) => (
    <div className="my-3 overflow-x-auto">
      <table
        className={cn("w-full border-collapse text-sm", className)}
        {...props}
      />
    </div>
  ),
  th: ({ className, ...props }: ElProps<"th">) => (
    <th
      className={cn(
        "border border-border bg-muted px-3 py-1.5 text-left font-semibold",
        className
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }: ElProps<"td">) => (
    <td
      className={cn("border border-border px-3 py-1.5", className)}
      {...props}
    />
  ),
  code: ({ className, ...props }: ElProps<"code">) => (
    <code
      className={cn(
        "rounded border border-border bg-muted px-1 py-0.5 font-mono text-xs",
        className
      )}
      {...props}
    />
  ),
  pre: ({ className, ...props }: ElProps<"pre">) => (
    <pre
      className={cn(
        "my-3 overflow-x-auto rounded-md border border-border bg-muted p-3 text-xs [&>code]:border-0 [&>code]:bg-transparent [&>code]:p-0",
        className
      )}
      {...props}
    />
  ),
};

export function Markdown({ content, className }: MarkdownProps): ReactElement {
  return (
    <div className={cn("break-words text-sm leading-7", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
