"use client";

// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(public)/propose/merge/merge-proposal.client`
 * Purpose: Client component for creating a DAO governance proposal to merge a PR.
 * Scope: Reads URL params, connects wallet, encodes CogniSignal.signal() action, submits createProposal() tx.
 * Invariants: All contract addresses from URL params; no server-side config dependency.
 * Side-effects: Blockchain write (createProposal tx via wallet signing)
 * Links: cogni-proposal-launcher/src/pages/merge-change.tsx
 * @public
 */

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { encodeFunctionData } from "viem";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/kit/feedback/Alert";
import { Button } from "@/components/kit/inputs/Button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/kit/layout/Card";
import {
  COGNI_SIGNAL_ABI,
  TOKEN_VOTING_ABI,
} from "@/features/governance/lib/proposal-abis";
import {
  estimateProposalGas,
  generateProposalTimestamps,
  getChainName,
  type MergeParams,
  validateDeeplinkParams,
} from "@/features/governance/lib/proposal-utils";

export function MergeProposal() {
  const searchParams = useSearchParams();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { writeContract, isPending, isSuccess, error, data } =
    useWriteContract();
  const client = usePublicClient();
  const { switchChain } = useSwitchChain();

  const params = useMemo(
    () => validateDeeplinkParams(searchParams),
    [searchParams]
  );

  if (!params) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Missing Required Parameters</AlertTitle>
        <AlertDescription>
          This page requires valid URL parameters. Please check the link and try
          again.
        </AlertDescription>
      </Alert>
    );
  }

  const requiredChainId = parseInt(params.chainId, 10);
  const isCorrectChain = chainId === requiredChainId;
  const decodedRepoUrl = decodeURIComponent(params.repoUrl);
  const repoName = decodedRepoUrl.split("/").pop() ?? "";
  const prUrl = `${decodedRepoUrl}/pull/${params.pr}`;

  const createProposal = async () => {
    if (!client || !address || !isCorrectChain) return;

    try {
      const signalCallData = encodeFunctionData({
        abi: COGNI_SIGNAL_ABI,
        functionName: "signal",
        args: [
          "github",
          decodedRepoUrl,
          params.action,
          params.target,
          params.pr,
          "0x",
        ],
      });

      const actions = [
        {
          to: params.signal as `0x${string}`,
          value: 0n,
          data: signalCallData,
        },
      ];

      const { startDate, endDate } = generateProposalTimestamps();

      const gasLimit = await estimateProposalGas(client, {
        address: params.plugin as `0x${string}`,
        abi: TOKEN_VOTING_ABI,
        functionName: "createProposal",
        args: [
          "0x" as `0x${string}`,
          actions,
          0n,
          startDate,
          endDate,
          0,
          false,
        ],
        account: address,
      });

      await writeContract({
        address: params.plugin as `0x${string}`,
        abi: TOKEN_VOTING_ABI,
        functionName: "createProposal",
        args: [
          "0x" as `0x${string}`,
          actions,
          0n,
          startDate,
          endDate,
          0,
          false,
        ],
        gas: gasLimit,
        account: address,
      });
    } catch {
      // Error surfaced via useWriteContract error state
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="font-bold text-2xl">Create Merge Proposal</h1>

      <div>
        <ConnectButton />
      </div>

      <NetworkStatus
        isConnected={isConnected}
        currentChainId={chainId}
        requiredChainId={requiredChainId}
        isCorrectChain={isCorrectChain}
        onSwitch={() => switchChain?.({ chainId: requiredChainId })}
      />

      <ProposalSummary params={params} decodedRepoUrl={decodedRepoUrl} />

      {isConnected && (
        <ProposalAction
          params={params}
          repoName={repoName}
          prUrl={prUrl}
          isCorrectChain={isCorrectChain}
          isPending={isPending}
          isSuccess={isSuccess}
          error={error}
          txHash={data}
          onSubmit={createProposal}
        />
      )}

      {!isConnected && (
        <p className="text-muted-foreground">
          Please connect your wallet to continue.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function NetworkStatus({
  isConnected,
  currentChainId,
  requiredChainId,
  isCorrectChain,
  onSwitch,
}: {
  isConnected: boolean;
  currentChainId: number;
  requiredChainId: number;
  isCorrectChain: boolean;
  onSwitch: () => void;
}) {
  if (!isConnected) return null;

  if (!isCorrectChain) {
    return (
      <Alert>
        <AlertTitle>Wrong Network</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>
            Connected to {getChainName(currentChainId)} but this proposal
            requires {getChainName(requiredChainId)}.
          </p>
          <Button variant="outline" size="sm" onClick={onSwitch}>
            Switch to {getChainName(requiredChainId)}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="success">
      <AlertTitle>Connected to {getChainName(requiredChainId)}</AlertTitle>
    </Alert>
  );
}

function ProposalSummary({
  params,
  decodedRepoUrl,
}: {
  params: MergeParams;
  decodedRepoUrl: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Proposal Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        <p>
          <span className="font-medium">Repository:</span> {decodedRepoUrl}
        </p>
        <p>
          <span className="font-medium">Pull Request:</span> #{params.pr}
        </p>
        <p>
          <span className="font-medium">Action:</span> {params.action}
        </p>
        <p>
          <span className="font-medium">Target:</span> {params.target}
        </p>
        <p>
          <span className="font-medium">Network:</span>{" "}
          {getChainName(params.chainId)} (Chain ID: {params.chainId})
        </p>
        <hr className="my-2 border-border" />
        <p className="font-mono text-muted-foreground text-xs">
          DAO: {params.dao}
        </p>
        <p className="font-mono text-muted-foreground text-xs">
          Plugin: {params.plugin}
        </p>
        <p className="font-mono text-muted-foreground text-xs">
          Signal: {params.signal}
        </p>
      </CardContent>
    </Card>
  );
}

function ProposalAction({
  params,
  repoName,
  prUrl,
  isCorrectChain,
  isPending,
  isSuccess,
  error,
  txHash,
  onSubmit,
}: {
  params: MergeParams;
  repoName: string;
  prUrl: string;
  isCorrectChain: boolean;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  txHash: string | undefined;
  onSubmit: () => void;
}) {
  if (isSuccess && txHash) {
    return (
      <Alert variant="success">
        <AlertTitle>Proposal Created Successfully</AlertTitle>
        <AlertDescription className="space-y-2">
          <p className="break-all font-mono text-xs">
            Transaction Hash: {txHash}
          </p>
          <p className="text-sm">
            <a
              href={`https://app.aragon.org/dao/base/${params.dao}/proposals`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              View on Aragon App
            </a>
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Proposal Action</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <span className="font-medium">Call:</span> CogniSignal.signal()
          </p>
          <p>
            <span className="font-medium">Target:</span>{" "}
            <span className="font-mono text-xs">{params.signal}</span>
          </p>
          <p>
            <span className="font-medium">Title:</span> {repoName}-
            {params.action}-PR#{params.pr}
          </p>
          <p>
            <span className="font-medium">PR:</span>{" "}
            <a
              href={prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              {prUrl}
            </a>
          </p>
        </CardContent>
      </Card>

      <Button
        onClick={onSubmit}
        disabled={isPending || !isCorrectChain}
        variant={isCorrectChain && !isPending ? "default" : "secondary"}
      >
        {isPending ? "Creating Proposal..." : "Create Proposal"}
      </Button>

      {!isCorrectChain && (
        <p className="text-muted-foreground text-sm">
          Switch to {getChainName(params.chainId)} to enable proposal creation.
        </p>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Proposal Creation Failed</AlertTitle>
          <AlertDescription>
            {error.message?.includes("User rejected")
              ? "Transaction was cancelled by user"
              : error.message?.includes("insufficient funds")
                ? "Insufficient funds for transaction"
                : (error.message ?? "Unknown error occurred")}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
