// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/setup/daoFormation/txBuilders`
 * Purpose: Pure functions to build transaction arguments for DAO formation.
 * Scope: Argument construction only; does not perform RPC calls or transaction signing.
 * Invariants: Uses pinned OSx version constants.
 * Side-effects: none
 * Links: docs/NODE_FORMATION_SPEC.md
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
} from "@setup-core";
import { encodeAbiParameters, parseAbiParameters } from "viem";

import type { DAOFormationConfig } from "./formation.reducer";

// ============================================================================
// Types
// ============================================================================

export interface CreateDaoTxArgs {
  address: HexAddress;
  args: readonly [
    metadata: `0x${string}`,
    daoSettings: {
      subdomain: string;
      trustedForwarder: HexAddress;
      daoURI: string;
    },
    pluginSettings: readonly [
      {
        pluginSetupRef: {
          pluginSetupRepo: HexAddress;
          versionTag: { release: number; build: number };
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
 */
export function buildCreateDaoArgs(
  chainId: SupportedChainId,
  config: DAOFormationConfig
): CreateDaoTxArgs {
  const aragonAddresses = getAragonAddresses(chainId);

  // Encode TokenVoting setup data
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

  // Encode empty DAO metadata (contentAddressedURI = 0)
  const daoMetadata = encodeAbiParameters(
    parseAbiParameters("uint256 contentAddressedURI"),
    [0n]
  );

  return {
    address: aragonAddresses.daoFactory,
    args: [
      daoMetadata,
      {
        subdomain: "", // No ENS subdomain
        trustedForwarder: DEPLOY_NEW_TOKEN_ADDRESS,
        daoURI: "",
      },
      [
        {
          pluginSetupRef: {
            pluginSetupRepo: aragonAddresses.tokenVotingPluginRepo,
            versionTag: TOKEN_VOTING_VERSION_TAG,
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
