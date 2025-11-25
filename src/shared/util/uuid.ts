// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@shared/util/uuid`
 * Purpose: UUID validation utility.
 * Scope: Provides a pure function to validate if a string is a valid UUID v4 using the `uuid` library.
 * @public
 */

import { validate as isUuid, version as uuidVersion } from "uuid";

/**
 * Checks if a string is a valid UUID v4.
 * @param uuid - The string to validate.
 * @returns True if the string is a valid UUID v4, false otherwise.
 */
export function isValidUuid(uuid: string): boolean {
  return isUuid(uuid) && uuidVersion(uuid) === 4;
}
