// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/credits/page`
 * Purpose: Protected credits page showing balance, ledger history, and Resmic purchase CTA.
 * Scope: Client component using React Query to fetch billing data and trigger Resmic confirm flow; does not manage session auth or server-side billing logic.
 * Invariants: Billing account inferred from authenticated session; Resmic payments are crypto-only with no auto top-up.
 * Side-effects: IO (network requests to payments APIs); global (localStorage for idempotency keys).
 * Notes: Resmic widget runs client-side only; confirmation calls backend with UUID idempotency keys.
 * Links: docs/RESMIC_PAYMENTS.md
 * @public
 */

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ReactElement,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
// eslint-disable-next-line boundaries/entry-point
import { Chains, CryptoPayment, Tokens } from "resmic";

import { Button } from "@/components";
import type { ResmicConfirmInput } from "@/contracts/payments.resmic.confirm.v1.contract";
import type { ResmicSummaryOutput } from "@/contracts/payments.resmic.summary.v1.contract";
import { clientEnv } from "@/shared/env";
import {
  badge,
  card,
  cardContent,
  cardHeader,
  container,
  heading,
  paragraph,
  section,
  twoColumn,
} from "@/styles/ui";

const PAYMENT_AMOUNTS = [10, 25, 50, 100] as const;
const DEFAULT_LEDGER_LIMIT = 10;
const DEFAULT_CHAIN = Chains.Sepolia;
const DEFAULT_TOKEN = Tokens.USDT;
const ALLOWED_CHAINS = { Sepolia: DEFAULT_CHAIN };
const ALLOWED_TOKENS = [DEFAULT_TOKEN];

async function fetchSummary(): Promise<ResmicSummaryOutput> {
  const response = await fetch(
    "/api/v1/payments/resmic/summary?limit=" + DEFAULT_LEDGER_LIMIT
  );
  if (!response.ok) {
    throw new Error("Unable to load credits");
  }
  return (await response.json()) as ResmicSummaryOutput;
}

async function confirmPayment(payload: ResmicConfirmInput): Promise<{
  billingAccountId: string;
  balanceCredits: number;
}> {
  const response = await fetch("/api/v1/payments/resmic/confirm", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const message =
      typeof errorBody.error === "string"
        ? errorBody.error
        : "Unable to confirm payment";
    throw new Error(message);
  }

  return (await response.json()) as {
    billingAccountId: string;
    balanceCredits: number;
  };
}

function formatCredits(amount: number): string {
  return amount.toLocaleString("en-US");
}

function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleString();
}

export default function CreditsPage(): ReactElement {
  const [selectedAmount, setSelectedAmount] = useState<number>(
    PAYMENT_AMOUNTS[1]
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const lastPaymentIdRef = useRef<string | null>(null);

  const summaryQuery = useQuery({
    queryKey: ["resmic-summary"],
    queryFn: fetchSummary,
  });

  const confirmMutation = useMutation({
    mutationFn: confirmPayment,
    onSuccess: async () => {
      setStatusMessage("Credits added successfully");
      await queryClient.invalidateQueries({ queryKey: ["resmic-summary"] });
    },
    onError: (error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Unable to confirm payment";
      setStatusMessage(message);
    },
  });

  const walletAddress = useMemo(
    () => clientEnv().NEXT_PUBLIC_DAO_WALLET_ADDRESS ?? "",
    []
  );
  const resmicReady = walletAddress.length > 0;

  const handlePaymentStatus = useCallback(
    (paymentStatus: boolean) => {
      if (!paymentStatus || confirmMutation.isPending) return;
      const clientPaymentId = crypto.randomUUID();
      lastPaymentIdRef.current = clientPaymentId;

      try {
        localStorage.setItem("resmic:lastPaymentId", clientPaymentId);
      } catch {
        // Non-blocking if storage is unavailable
      }

      const payload: ResmicConfirmInput = {
        amountUsdCents: selectedAmount * 100,
        clientPaymentId,
        metadata: {
          chainId: DEFAULT_CHAIN.id,
          tokenSymbol: DEFAULT_TOKEN.name,
          timestamp: new Date().toISOString(),
        },
      };

      setStatusMessage(null);
      confirmMutation.mutate(payload);
    },
    [confirmMutation, selectedAmount]
  );

  const ledgerEntries = summaryQuery.data?.ledger ?? [];

  return (
    <div className={section()}>
      <div className={container({ size: "lg", spacing: "xl" })}>
        <div className={twoColumn({})}>
          <div className={card({ variant: "elevated" })}>
            <div className={cardHeader()}>
              <div className="flex items-start justify-between gap-[var(--spacing-md)]">
                <div className="space-y-[var(--spacing-xs)]">
                  <div className={heading({ level: "h2" })}>Credits</div>
                  <div
                    className={paragraph({
                      size: "md",
                      tone: "subdued",
                      spacing: "xs",
                    })}
                  >
                    Crypto-only credit purchases. No auto top-up.
                  </div>
                </div>
                <span className={badge({ intent: "secondary" })}>Resmic</span>
              </div>
              <div className="mt-[var(--spacing-sm)] grid gap-[var(--spacing-xs)] lg:grid-cols-2">
                <div className="bg-muted rounded-lg p-[var(--spacing-md)]">
                  <div
                    className={paragraph({
                      size: "sm",
                      tone: "subdued",
                      spacing: "none",
                    })}
                  >
                    Balance
                  </div>
                  <div className={heading({ level: "h3" })}>
                    {summaryQuery.isLoading
                      ? "Loading..."
                      : `${formatCredits(summaryQuery.data?.balanceCredits ?? 0)} credits`}
                  </div>
                </div>
                <div className="bg-muted rounded-lg p-[var(--spacing-md)]">
                  <div
                    className={paragraph({
                      size: "sm",
                      tone: "subdued",
                      spacing: "none",
                    })}
                  >
                    Conversion
                  </div>
                  <div className={heading({ level: "h3" })}>
                    1¢ = 10 credits
                  </div>
                </div>
              </div>
              {statusMessage ? (
                <div className="border-border bg-accent/30 text-accent-foreground rounded-md border p-[var(--spacing-sm)] text-[var(--text-sm)]">
                  {statusMessage}
                </div>
              ) : null}
            </div>
            <div className={cardContent()}>
              {summaryQuery.isLoading ? (
                <div className={paragraph({})}>Loading recent activity...</div>
              ) : summaryQuery.isError ? (
                <div className={paragraph({ tone: "default" })}>
                  Unable to load ledger entries. Please refresh or try again.
                </div>
              ) : ledgerEntries.length === 0 ? (
                <div className={paragraph({ tone: "default" })}>
                  No ledger entries yet.
                </div>
              ) : (
                <div className="space-y-[var(--spacing-sm)]">
                  {ledgerEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className="border-border flex flex-col gap-[var(--spacing-2xs)] rounded-md border p-[var(--spacing-md)]"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-[var(--spacing-sm)]">
                          <span
                            className={badge({
                              intent:
                                entry.reason === "resmic_payment"
                                  ? "secondary"
                                  : "outline",
                            })}
                          >
                            {entry.reason}
                          </span>
                          <span
                            className={paragraph({
                              size: "sm",
                              tone: "default",
                              spacing: "none",
                            })}
                          >
                            {entry.reference ?? "No reference"}
                          </span>
                        </div>
                        <div className={heading({ level: "h4" })}>
                          {entry.amount >= 0 ? "+" : ""}
                          {formatCredits(entry.amount)}
                        </div>
                      </div>
                      <div className="text-muted-foreground flex flex-wrap items-center gap-[var(--spacing-sm)] text-[var(--text-sm)]">
                        <span>
                          Balance after: {formatCredits(entry.balanceAfter)}
                        </span>
                        <span>•</span>
                        <span>{formatTimestamp(entry.createdAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className={card({ variant: "default" })}>
            <div className={cardHeader()}>
              <div className="flex items-center justify-between">
                <div className={heading({ level: "h3" })}>
                  Buy credits with Resmic
                </div>
                <span className={badge({ intent: "default" })}>
                  Crypto only
                </span>
              </div>
              <div
                className={paragraph({
                  size: "sm",
                  tone: "subdued",
                  spacing: "xs",
                })}
              >
                Choose an amount, complete the crypto payment, and we will
                credit your balance once Resmic reports success.
              </div>
            </div>
            <div className={cardContent()}>
              <div className="flex flex-wrap gap-[var(--spacing-sm)]">
                {PAYMENT_AMOUNTS.map((amount) => (
                  <Button
                    key={amount}
                    variant={amount === selectedAmount ? "default" : "outline"}
                    onClick={() => setSelectedAmount(amount)}
                  >
                    ${amount} / {formatCredits(amount * 1000)} credits
                  </Button>
                ))}
              </div>
              <div className="mt-[var(--spacing-lg)] space-y-[var(--spacing-sm)]">
                {!resmicReady ? (
                  <div className={paragraph({ tone: "default" })}>
                    Configure NEXT_PUBLIC_DAO_WALLET_ADDRESS to enable Resmic
                    purchases.
                  </div>
                ) : (
                  <CryptoPayment
                    Address={walletAddress}
                    Tokens={ALLOWED_TOKENS}
                    Chains={ALLOWED_CHAINS}
                    Amount={selectedAmount}
                    noOfBlockConformation={3}
                    setPaymentStatus={handlePaymentStatus}
                    Style={{
                      displayName: "Purchase with Resmic",
                      backgroundColor: "var(--color-primary)",
                      color: "var(--color-white)",
                      borderRadius: "12px",
                      padding: "12px 16px",
                      fontSize: "16px",
                      border: "1px solid var(--color-primary)",
                    }}
                  />
                )}
                <div className={paragraph({ size: "sm", tone: "subdued" })}>
                  After payment completes, we call the confirm endpoint with
                  your amount and an idempotent payment ID. Repeat submissions
                  with the same ID will not double credit your balance.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
