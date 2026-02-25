// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/db-schema/profile`
 * Purpose: User profile table — user-controlled display preferences.
 * Scope: Defines user_profiles (display identity). Does not contain queries or business logic.
 * Invariants:
 * - PROFILE_1_TO_1: user_profiles.user_id is PK and FK to users.id (exactly one profile per user).
 * - DISPLAY_NAME_FALLBACK: display_name is nullable; display logic applies fallback chain (profile → binding → wallet truncation).
 * Side-effects: none (schema definitions only)
 * Links: src/contracts/users.profile.v1.contract.ts
 * @public
 */

import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { users } from "./refs";

/**
 * User profiles — user-controlled display identity.
 * 1:1 with users table. Canonical source for display name and avatar color.
 */
export const userProfiles = pgTable("user_profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id),
  displayName: text("display_name"),
  avatarColor: text("avatar_color"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
