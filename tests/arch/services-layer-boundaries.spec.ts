// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/arch/services-layer-boundaries`
 * Purpose: Validates services/ isolation from src/ (Next.js app).
 * Scope: Tests services cannot import src/, src cannot import services/. Does not test packages/ boundaries.
 * Invariants: services/ and src/ are completely isolated; both can import packages/.
 * Side-effects: IO (spawns depcruise subprocess)
 * Notes: Uses arch probes in services/__arch_probes__/.
 * Links: .dependency-cruiser.cjs (no-services-to-src, no-src-to-services rules)
 * @public
 */

import { describe } from "vitest";

describe.skip("Services layer isolation", () => {
  // No service with __arch_probes__ in node-template; add a service-specific
  // describe block here when one exists.
});
