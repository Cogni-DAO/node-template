// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@shared/observability/server/logEvent`
 * Purpose: App-local typed wrapper around the shared logEvent runtime so Poly
 *   routes can use the app's extended event registry.
 * Scope: Logging helper only.
 * Invariants: Event names come from `@/shared/observability/events`.
 * Side-effects: IO (structured logging).
 * @public
 */

import {
  logEvent as logSharedEvent,
  type EventName as SharedEventName,
} from "@cogni/node-shared";
import type { Logger } from "pino";
import type { EventBase, EventName } from "../events";

export function logEvent(
  logger: Logger,
  eventName: EventName,
  fields: EventBase & Record<string, unknown>,
  message?: string
): void {
  logSharedEvent(logger, eventName as SharedEventName, fields, message);
}
