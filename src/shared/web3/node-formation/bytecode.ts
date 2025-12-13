// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@shared/web3/bytecode`
 * Purpose: Bytecode constants for client-side deployments.
 * Scope: Constants only; does not fetch or compile bytecode at runtime.
 * Invariants: Bytecode must be a 0x-prefixed hex string.
 * Side-effects: none
 * Links: docs/NODE_FORMATION_SPEC.md
 * @public
 */

/**
 * CogniSignal deployment bytecode.
 *
 * IMPORTANT: This repo does not currently vendor the compiled artifact.
 * To enable deployments, replace this with the actual compiled bytecode.
 */
export const COGNI_SIGNAL_BYTECODE = "0x" as const;
