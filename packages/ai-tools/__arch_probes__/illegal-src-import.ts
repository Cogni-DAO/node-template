// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Arch probe: Verify packages/ai-tools cannot import from src/.
 * This file should FAIL dependency-cruiser if uncommented.
 * Per PACKAGES_NO_SRC_IMPORTS invariant.
 */

// Uncommenting the following line should trigger depcruise violation:
// import { something } from "../../../src/features/ai/types";

export {};
