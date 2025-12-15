// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/setup/verify`
 * Purpose: Server-side verification of DAO formation transactions.
 * Scope: Derives addresses from tx receipts, verifies on-chain state, returns repo-spec YAML; does not modify blockchain state.
 * Invariants: NEVER trusts client-provided addresses; all addresses derived from receipts.
 * Side-effects: IO (RPC reads via viem)
 * Links: docs/NODE_FORMATION_SPEC.md
 * @public
 */

import {
  DAO_REGISTERED_EVENT,
  getAragonAddresses,
  INSTALLATION_APPLIED_EVENT,
  type SupportedChainId,
} from "@setup-core";
import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base, sepolia } from "viem/chains";

import {
  type SetupVerifyOutput,
  setupVerifyOperation,
} from "@/contracts/setup.verify.v1.contract";
import { serverEnv } from "@/shared/env";
import { CHAINS } from "@/shared/web3/chain";
import {
  GOVERNANCE_ERC20_ABI,
  TOKEN_VOTING_ABI,
} from "@/shared/web3/node-formation/aragon-abi";
import { COGNI_SIGNAL_ABI } from "@/shared/web3/node-formation/bytecode";

export const dynamic = "force-dynamic";

// Map chainId to viem chain object (only BASE and SEPOLIA supported)
const VIEM_CHAINS = {
  [CHAINS.BASE.chainId]: base,
  [CHAINS.SEPOLIA.chainId]: sepolia,
};

function getPublicClient(chainId: SupportedChainId) {
  const chain = VIEM_CHAINS[chainId];
  if (!chain) {
    throw new Error(`Unsupported chainId: ${chainId}`);
  }

  const rpcUrl = serverEnv().EVM_RPC_URL;
  return createPublicClient({
    chain,
    transport: http(rpcUrl || undefined),
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json();
    const parseResult = setupVerifyOperation.input.safeParse(body);

    if (!parseResult.success) {
      const response: SetupVerifyOutput = {
        verified: false,
        errors: parseResult.error.issues.map((i) => i.message),
      };
      return NextResponse.json(response, { status: 400 });
    }

    const { chainId, daoTxHash, signalTxHash, initialHolder } =
      parseResult.data;
    const errors: string[] = [];

    const client = getPublicClient(chainId as SupportedChainId);
    const aragonAddresses = getAragonAddresses(chainId);

    // 1. Get DAO creation receipt
    let daoAddress: `0x${string}` | null = null;
    let pluginAddress: `0x${string}` | null = null;

    try {
      const daoReceipt = await client.getTransactionReceipt({
        hash: daoTxHash as `0x${string}`,
      });

      if (daoReceipt.status !== "success") {
        errors.push("DAO creation transaction failed");
      } else {
        // Extract DAO address from DAORegistered event
        // DAORegistered(address indexed dao, address indexed creator, string subdomain)
        for (const log of daoReceipt.logs) {
          if (log.topics[0] === DAO_REGISTERED_EVENT.topic) {
            daoAddress = `0x${log.topics[1]?.slice(26)}` as `0x${string}`;
          }
        }

        // Extract plugin address from InstallationApplied event
        // InstallationApplied(address indexed dao, address indexed plugin, bytes32 preparedSetupId, bytes32 appliedSetupId)
        for (const log of daoReceipt.logs) {
          if (log.topics[0] === INSTALLATION_APPLIED_EVENT.topic) {
            pluginAddress = `0x${log.topics[2]?.slice(26)}` as `0x${string}`;
          }
        }

        // Fallback: find plugin by iterating logs
        if (!pluginAddress && daoReceipt.logs.length > 0) {
          // Plugin is typically emitted in PluginInstalled or similar
          // Use heuristic: address that isn't factory, PSP, or DAO
          for (const log of daoReceipt.logs) {
            const addr = log.address.toLowerCase();
            if (
              addr !== aragonAddresses.daoFactory.toLowerCase() &&
              addr !== aragonAddresses.pluginSetupProcessor.toLowerCase() &&
              addr !== daoAddress?.toLowerCase()
            ) {
              // Verify it's the TokenVoting plugin by checking getVotingToken
              try {
                await client.readContract({
                  address: log.address,
                  abi: TOKEN_VOTING_ABI,
                  functionName: "getVotingToken",
                });
                pluginAddress = log.address;
                break;
              } catch {
                // Not the plugin, continue
              }
            }
          }
        }

        if (!daoAddress) {
          errors.push("Could not extract DAO address from receipt");
        }
        if (!pluginAddress) {
          errors.push("Could not extract plugin address from receipt");
        }
      }
    } catch (err) {
      errors.push(
        `Failed to fetch DAO receipt: ${err instanceof Error ? err.message : "unknown"}`
      );
    }

    // 2. Get token address from plugin
    let tokenAddress: `0x${string}` | null = null;

    if (pluginAddress) {
      try {
        tokenAddress = await client.readContract({
          address: pluginAddress,
          abi: TOKEN_VOTING_ABI,
          functionName: "getVotingToken",
        });
      } catch (err) {
        errors.push(
          `Failed to get voting token: ${err instanceof Error ? err.message : "unknown"}`
        );
      }
    }

    // 3. Verify initial holder balance
    if (tokenAddress) {
      try {
        const balance = await client.readContract({
          address: tokenAddress,
          abi: GOVERNANCE_ERC20_ABI,
          functionName: "balanceOf",
          args: [initialHolder as `0x${string}`],
        });

        if (balance !== 10n ** 18n) {
          errors.push(
            `Initial holder balance mismatch: expected 1e18, got ${balance.toString()}`
          );
        }
      } catch (err) {
        errors.push(
          `Failed to check balance: ${err instanceof Error ? err.message : "unknown"}`
        );
      }
    }

    // 4. Get CogniSignal deployment receipt
    let signalAddress: `0x${string}` | null = null;

    try {
      const signalReceipt = await client.getTransactionReceipt({
        hash: signalTxHash as `0x${string}`,
      });

      if (signalReceipt.status !== "success") {
        errors.push("CogniSignal deployment transaction failed");
      } else if (signalReceipt.contractAddress) {
        signalAddress = signalReceipt.contractAddress;
      } else {
        errors.push("CogniSignal deployment did not create contract");
      }
    } catch (err) {
      errors.push(
        `Failed to fetch signal receipt: ${err instanceof Error ? err.message : "unknown"}`
      );
    }

    // 5. Verify CogniSignal.DAO() == daoAddress
    if (signalAddress && daoAddress) {
      try {
        const signalDao = await client.readContract({
          address: signalAddress,
          abi: COGNI_SIGNAL_ABI,
          functionName: "DAO",
        });

        if (signalDao.toLowerCase() !== daoAddress.toLowerCase()) {
          errors.push(
            `CogniSignal.DAO() mismatch: expected ${daoAddress}, got ${signalDao}`
          );
        }
      } catch (err) {
        errors.push(
          `Failed to verify CogniSignal.DAO(): ${err instanceof Error ? err.message : "unknown"}`
        );
      }
    }

    // 6. Build response
    if (
      errors.length === 0 &&
      daoAddress &&
      tokenAddress &&
      pluginAddress &&
      signalAddress
    ) {
      const repoSpecYaml = buildRepoSpecYaml({
        chainId,
        daoAddress,
        pluginAddress,
        signalAddress,
      });

      const response: SetupVerifyOutput = {
        verified: true,
        addresses: {
          dao: daoAddress,
          token: tokenAddress,
          plugin: pluginAddress,
          signal: signalAddress,
        },
        repoSpecYaml,
      };

      return NextResponse.json(response);
    }

    const response: SetupVerifyOutput = {
      verified: false,
      errors: errors.length > 0 ? errors : ["Verification incomplete"],
    };

    return NextResponse.json(response, { status: 400 });
  } catch (err) {
    const response: SetupVerifyOutput = {
      verified: false,
      errors: [err instanceof Error ? err.message : "Internal server error"],
    };
    return NextResponse.json(response, { status: 500 });
  }
}

function buildRepoSpecYaml(params: {
  chainId: number;
  daoAddress: string;
  pluginAddress: string;
  signalAddress: string;
}): string {
  return `# Generated by Node Formation
# Copy this to .cogni/repo-spec.yaml

cogni_dao:
  dao_contract: "${params.daoAddress}"
  plugin_contract: "${params.pluginAddress}"
  signal_contract: "${params.signalAddress}"
  chain_id: "${params.chainId}"
`;
}
