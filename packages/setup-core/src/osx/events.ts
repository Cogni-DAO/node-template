// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@setup-core/osx/events`
 * Purpose: Aragon OSx event ABIs and topic constants for receipt decoding.
 * Scope: Pure constants; no RPC.
 * Invariants: Topics computed from keccak256 of canonical signatures.
 * Side-effects: none
 * @public
 */

/**
 * DAORegistered event emitted by DAORegistry when a DAO is registered.
 * Signature: DAORegistered(address indexed dao, address indexed creator, string subdomain)
 */
export const DAO_REGISTERED_EVENT = {
  abi: {
    type: "event",
    name: "DAORegistered",
    inputs: [
      { name: "dao", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "subdomain", type: "string", indexed: false },
    ],
  },
  // keccak256("DAORegistered(address,address,string)")
  topic:
    "0x5c0366e72f6d8608e72a1f50a8e61fdc9187b94c8c0cee349b2e879c03a9c6d9" as const,
} as const;

/**
 * InstallationApplied event emitted by PluginSetupProcessor when a plugin is installed.
 * Signature: InstallationApplied(address indexed dao, address indexed plugin, bytes32 preparedSetupId, bytes32 appliedSetupId)
 */
export const INSTALLATION_APPLIED_EVENT = {
  abi: {
    type: "event",
    name: "InstallationApplied",
    inputs: [
      { name: "dao", type: "address", indexed: true },
      { name: "plugin", type: "address", indexed: true },
      { name: "preparedSetupId", type: "bytes32", indexed: false },
      { name: "appliedSetupId", type: "bytes32", indexed: false },
    ],
  },
  // keccak256("InstallationApplied(address,address,bytes32,bytes32)")
  topic:
    "0x6fe58f3e17da33f74b44ff6a4bf7824e31c5b4b4e6c3cb7ac8c1a0c15d4b4f24" as const,
} as const;

/**
 * All OSx events as array for use with viem decodeEventLog.
 */
export const OSX_EVENT_ABIS = [
  DAO_REGISTERED_EVENT.abi,
  INSTALLATION_APPLIED_EVENT.abi,
] as const;
