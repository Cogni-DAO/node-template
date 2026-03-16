// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/setup/daoFormation/txBuilders`
 * Purpose: Pure functions to build transaction arguments for DAO formation.
 * Scope: Argument construction only; does not perform RPC calls or transaction signing.
 * Invariants: Uses pinned OSx version constants.
 * Side-effects: none
 * Links: docs/spec/node-formation.md
 * @public
 */

import {
  DEFAULT_VOTING_SETTINGS,
  DEPLOY_NEW_TOKEN_ADDRESS,
  encodeTokenVotingSetup,
  getAragonAddresses,
  type HexAddress,
  INITIAL_TOKEN_AMOUNT,
  MINT_SETTINGS_VERSION,
  type SupportedChainId,
  TOKEN_VOTING_VERSION_TAG,
} from "@cogni/aragon-osx";
import {
  calculateSplitAllocations,
  OPENROUTER_CRYPTO_FEE_PPM,
  SPLIT_TOTAL_ALLOCATION,
} from "@cogni/operator-wallet";
import type { Address } from "viem";
import { encodeAbiParameters, getAddress, parseAbiParameters } from "viem";

import type { DAOFormationConfig } from "./formation.reducer";

// ============================================================================
// Types
// ============================================================================

/**
 * Type for createDao transaction args.
 *
 * CRITICAL: Struct field order must match OSx v1.4.0 exactly.
 * - DAOSettings: trustedForwarder, daoURI, subdomain, metadata
 * - PluginSetupRef: versionTag BEFORE pluginSetupRepo
 */
export interface CreateDaoTxArgs {
  address: HexAddress;
  args: readonly [
    daoSettings: {
      trustedForwarder: HexAddress;
      daoURI: string;
      subdomain: string;
      metadata: `0x${string}`;
    },
    pluginSettings: readonly [
      {
        pluginSetupRef: {
          versionTag: { release: number; build: number };
          pluginSetupRepo: HexAddress;
        };
        data: `0x${string}`;
      },
    ],
  ];
}

export interface DeploySignalTxArgs {
  args: readonly [daoAddress: HexAddress];
}

// ============================================================================
// Builders
// ============================================================================

/**
 * Build arguments for DAOFactory.createDao transaction.
 *
 * CRITICAL: This must produce args matching the OSx v1.4.0 createDao signature:
 *   createDao(DAOSettings, PluginSettings[])
 *
 * DAOSettings field order: trustedForwarder, daoURI, subdomain, metadata
 * PluginSetupRef field order: versionTag, pluginSetupRepo
 */
export function buildCreateDaoArgs(
  chainId: SupportedChainId,
  config: DAOFormationConfig
): CreateDaoTxArgs {
  const aragonAddresses = getAragonAddresses(chainId);

  // Encode TokenVoting setup data (7-param struct)
  const tokenVotingSetupData = encodeTokenVotingSetup({
    votingSettings: DEFAULT_VOTING_SETTINGS,
    tokenSettings: {
      addr: DEPLOY_NEW_TOKEN_ADDRESS,
      name: config.tokenName,
      symbol: config.tokenSymbol,
    },
    mintSettings: {
      receivers: [config.initialHolder],
      amounts: [INITIAL_TOKEN_AMOUNT],
    },
    targetConfig: {
      target: DEPLOY_NEW_TOKEN_ADDRESS,
      operation: 0,
    },
    minApprovals: 0n,
    pluginMetadata: "0x",
    excludedAccounts: [],
    mintSettingsVersion: MINT_SETTINGS_VERSION,
  });

  // Encode DAO metadata: matches Foundry's abi.encode(string(...))
  // The Foundry script encodes a human-readable name string
  const daoMetadata = encodeAbiParameters(parseAbiParameters("string"), [
    `CogniSignal DAO - ${config.tokenName}`,
  ]);

  return {
    address: aragonAddresses.daoFactory,
    args: [
      // DAOSettings: trustedForwarder, daoURI, subdomain, metadata
      {
        trustedForwarder: DEPLOY_NEW_TOKEN_ADDRESS,
        daoURI: "",
        subdomain: "", // No ENS subdomain
        metadata: daoMetadata,
      },
      // PluginSettings array
      [
        {
          pluginSetupRef: {
            // CRITICAL: versionTag BEFORE pluginSetupRepo
            versionTag: TOKEN_VOTING_VERSION_TAG,
            pluginSetupRepo: aragonAddresses.tokenVotingPluginRepo,
          },
          data: tokenVotingSetupData,
        },
      ],
    ] as const,
  };
}

/**
 * Build arguments for CogniSignal deployment.
 */
export function buildDeploySignalArgs(
  daoAddress: HexAddress
): DeploySignalTxArgs {
  return {
    args: [daoAddress] as const,
  };
}

// ============================================================================
// Split Deployment
// ============================================================================

/** 0xSplits Push Split V2o2 factory on Base. */
export const SPLIT_FACTORY_ADDRESS: Address =
  "0x8E8eB0cC6AE34A38B67D5Cf91ACa38f60bc3Ecf4";

/** Default billing constants (PPM). Override via env in production. */
const DEFAULT_MARKUP_PPM = 2_000_000n; // 2.0x
const DEFAULT_REVENUE_SHARE_PPM = 750_000n; // 75%

export interface DeploySplitTxArgs {
  address: Address;
  args: readonly [
    splitParams: {
      recipients: readonly Address[];
      allocations: readonly bigint[];
      totalAllocation: bigint;
      distributionIncentive: number;
    },
    owner: Address,
    creator: Address,
  ];
}

/**
 * Build arguments for splitV2o2Factory.createSplit().
 * Recipients: operator wallet (from Privy) + DAO treasury (just deployed).
 * Allocations derived from billing constants via calculateSplitAllocations.
 * Owner: operator wallet (can update allocations if pricing changes).
 */
export function buildDeploySplitArgs(
  operatorWalletAddress: HexAddress,
  daoTreasuryAddress: HexAddress
): DeploySplitTxArgs {
  const { operatorAllocation, treasuryAllocation } = calculateSplitAllocations(
    DEFAULT_MARKUP_PPM,
    DEFAULT_REVENUE_SHARE_PPM,
    OPENROUTER_CRYPTO_FEE_PPM
  );

  // 0xSplits requires recipients sorted ascending by address
  const entries = [
    {
      address: getAddress(operatorWalletAddress) as Address,
      allocation: operatorAllocation,
    },
    {
      address: getAddress(daoTreasuryAddress) as Address,
      allocation: treasuryAllocation,
    },
  ].sort((a, b) =>
    a.address.toLowerCase().localeCompare(b.address.toLowerCase())
  );

  const operatorAddress = getAddress(operatorWalletAddress) as Address;

  return {
    address: SPLIT_FACTORY_ADDRESS,
    args: [
      {
        recipients: entries.map((e) => e.address),
        allocations: entries.map((e) => e.allocation),
        totalAllocation: SPLIT_TOTAL_ALLOCATION,
        distributionIncentive: 0,
      },
      operatorAddress, // owner
      operatorAddress, // creator
    ] as const,
  };
}
