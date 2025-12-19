// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/ai/public.server`
 * Purpose: Server-only exports for AI feature.
 * Scope: Re-exports server-only services that depend on Node.js modules (prom-client, etc). Does not implement logic.
 * Invariants:
 *   - NEVER import this file from client components or "use client" files
 *   - Only import from .server.ts files or route handlers with runtime: "nodejs"
 * Side-effects: none
 * Notes: Split from public.ts to prevent prom-client from being bundled in client code.
 * Links: Part of hexagonal architecture boundary enforcement
 * @public
 */

// Activity validation (for app facade)
export { validateActivityRange } from "./services/activity";
// Non-streaming completion (for app facade)
export { execute, executeStream } from "./services/completion";
// Message mappers (for app facade DTO conversion)
export {
  fromCoreMessage,
  type MessageDto,
  toCoreMessages,
} from "./services/mappers";
// Streaming service (P1: single AI entrypoint for streaming)
export type {
  AiFacade,
  AiFacadeDeps,
  AiFacadeInput,
  AiFacadeResult,
  StreamingService,
} from "./services/streaming";
export {
  createAiFacade,
  createStreamingService,
} from "./services/streaming";
export type { EmitUiEvent, ToolExecOptions, ToolRunner } from "./tool-runner";
// Tool runner (for bootstrap wiring)
export { createToolRunner } from "./tool-runner";
