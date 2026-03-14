// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/external/money/openrouter-topup-e2e.external.money`
 * Purpose: End-to-end money test — sends real USDC on Base, triggers the full
 *   confirmCreditsPurchase chain via the running dev:stack, and asserts accounting
 *   in Postgres, TigerBeetle, and OpenRouter.
 * Scope: Black-box test against a running dev:stack. Authenticates via SIWE,
 *   calls HTTP APIs, queries DB directly for assertions only.
 * Invariants: ENABLE_MONEY_TESTS=true required. Spends ~$1.10 USDC per run.
 * Side-effects: Real on-chain USDC transfer, real OpenRouter charge, real DB writes.
 * Links: docs/spec/web3-openrouter-payments.md, docs/spec/financial-ledger.md
 * @internal
 */

import { randomUUID } from "node:crypto";
import { createServiceDbClient } from "@cogni/db-client/service";
import { users } from "@cogni/db-schema";
import { providerFundingAttempts } from "@cogni/db-schema/billing";
import { ACCOUNT } from "@cogni/financial-ledger";
import { createTigerBeetleAdapter } from "@cogni/financial-ledger/adapters";
import {
  type NextAuthSessionCookie,
  siweLogin,
} from "@tests/_fixtures/auth/nextauth-http-helpers";
import { eq } from "drizzle-orm";
import { createPublicClient, createWalletClient, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHAIN_ID } from "@/shared/web3/chain";

// ── Constants ─────────────────────────────────────────────────────────

const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const SPLIT_ADDRESS = "0xd92EEc51C471CcF76996f0163Fd3cB6A61798f9C" as const;
const AMOUNT_USD_CENTS = 110; // $1.10 — minimum viable amount for OpenRouter top-up

const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

// ── Env ───────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for money tests`);
  return value;
}

const TEST_BASE_URL = (
  process.env.TEST_BASE_URL ?? "http://localhost:3000"
).replace(/\/$/, "");
const DATABASE_SERVICE_URL = requireEnv("DATABASE_SERVICE_URL");
const TIGERBEETLE_ADDRESS = requireEnv("TIGERBEETLE_ADDRESS");
const OPENROUTER_API_KEY = requireEnv("OPENROUTER_API_KEY");
const TEST_WALLET_PRIVATE_KEY = requireEnv(
  "TEST_WALLET_PRIVATE_KEY"
) as `0x${string}`;

// ── Helpers ───────────────────────────────────────────────────────────

async function getOpenRouterCredits(apiKey: string): Promise<number> {
  const res = await fetch("https://openrouter.ai/api/v1/credits", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok)
    throw new Error(`OpenRouter credits fetch failed: ${res.status}`);
  const data = (await res.json()) as {
    data: { total_credits: number; total_usage: number };
  };
  return data.data.total_credits;
}

// ── Test ──────────────────────────────────────────────────────────────

describe("OpenRouter top-up e2e (live money)", () => {
  // Shared state
  const db = createServiceDbClient(DATABASE_SERVICE_URL);
  const testWallet = privateKeyToAccount(TEST_WALLET_PRIVATE_KEY);
  const testUserId = randomUUID();
  let sessionCookie: NextAuthSessionCookie | null = null;
  function cookie(): string {
    if (!sessionCookie) throw new Error("SIWE login did not complete");
    return `${sessionCookie.name}=${sessionCookie.value}`;
  }

  const publicClient = createPublicClient({
    chain: base,
    transport: http(process.env.EVM_RPC_URL),
  });
  const walletClient = createWalletClient({
    account: testWallet,
    chain: base,
    transport: http(process.env.EVM_RPC_URL),
  });

  // ── Setup: seed user + SIWE login ──────────────────────────────────

  beforeAll(async () => {
    // Seed test user with the test wallet address
    await db.insert(users).values({
      id: testUserId,
      walletAddress: testWallet.address,
      name: "Money Test User",
    });

    // SIWE login to get session cookie
    const domain = new URL(TEST_BASE_URL).host;
    const loginResult = await siweLogin({
      baseUrl: TEST_BASE_URL,
      wallet: { account: testWallet, privateKey: TEST_WALLET_PRIVATE_KEY },
      domain,
      chainId: CHAIN_ID,
    });

    if (!loginResult.success || !loginResult.sessionCookie) {
      throw new Error(
        `SIWE login failed: ${loginResult.error ?? "no session cookie returned"}`
      );
    }
    sessionCookie = loginResult.sessionCookie;
  }, 30_000);

  // ── Cleanup ────────────────────────────────────────────────────────

  afterAll(async () => {
    // FK cascades delete billing_accounts, credit_ledger, etc.
    await db.delete(users).where(eq(users.id, testUserId));
  });

  // ── The test ───────────────────────────────────────────────────────

  it("sends USDC → confirms credits → asserts TB + Postgres + OpenRouter", async () => {
    // 1. Record OpenRouter credits BEFORE
    const creditsBefore = await getOpenRouterCredits(OPENROUTER_API_KEY);
    console.log(`OpenRouter credits before: ${creditsBefore}`);

    // 2. Send USDC to Split address (simulates user payment)
    const usdcAmount = parseUnits((AMOUNT_USD_CENTS / 100).toFixed(6), 6);
    const transferHash = await walletClient.writeContract({
      address: USDC_ADDRESS,
      abi: ERC20_TRANSFER_ABI,
      functionName: "transfer",
      args: [SPLIT_ADDRESS, usdcAmount],
    });
    console.log(`USDC transfer to Split: ${transferHash}`);

    const transferReceipt = await publicClient.waitForTransactionReceipt({
      hash: transferHash,
    });
    expect(transferReceipt.status).toBe("success");

    // 3. Confirm credit purchase via the running app's HTTP API
    const clientPaymentId = `money-test-${randomUUID()}`;
    const confirmResponse = await fetch(
      `${TEST_BASE_URL}/api/v1/payments/credits/confirm`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie(),
        },
        body: JSON.stringify({
          amountUsdCents: AMOUNT_USD_CENTS,
          clientPaymentId,
        }),
      }
    );

    expect(confirmResponse.ok).toBe(true);
    const confirmData = (await confirmResponse.json()) as {
      billingAccountId: string;
      balanceCredits: number;
    };
    console.log(
      `Credits confirmed: balance=${confirmData.balanceCredits}, account=${confirmData.billingAccountId}`
    );
    expect(confirmData.balanceCredits).toBeGreaterThan(0);

    // 4. Wait a moment for async settlement steps to complete
    // Steps 3-6 (settlement, TB, funding) are non-blocking fire-and-forget
    await new Promise((resolve) => setTimeout(resolve, 15_000));

    // 5. Assert Postgres: provider_funding_attempts row
    const fundingRows = await db
      .select()
      .from(providerFundingAttempts)
      .where(eq(providerFundingAttempts.paymentIntentId, clientPaymentId));

    expect(fundingRows).toHaveLength(1);
    const fundingRow = fundingRows[0];
    console.log(
      `Funding row: status=${fundingRow.status}, chargeId=${fundingRow.chargeId}, txHash=${fundingRow.fundingTxHash}`
    );
    expect(fundingRow.status).toBe("funded");
    expect(fundingRow.fundingTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    // 6. Assert TigerBeetle: account balances changed
    const tb = createTigerBeetleAdapter(TIGERBEETLE_ADDRESS);
    const [treasury, operatorFloat, providerFloat] = await Promise.all([
      tb.getAccountBalance(ACCOUNT.ASSETS_TREASURY),
      tb.getAccountBalance(ACCOUNT.ASSETS_OPERATOR_FLOAT),
      tb.getAccountBalance(ACCOUNT.ASSETS_PROVIDER_FLOAT),
    ]);

    // Treasury was debited (SPLIT_DISTRIBUTE)
    expect(treasury.debitsPosted).toBeGreaterThan(0n);
    console.log(
      `TB Treasury: debits=${treasury.debitsPosted}, credits=${treasury.creditsPosted}`
    );

    // OperatorFloat was credited (SPLIT_DISTRIBUTE) and debited (PROVIDER_TOPUP)
    expect(operatorFloat.creditsPosted).toBeGreaterThan(0n);
    expect(operatorFloat.debitsPosted).toBeGreaterThan(0n);
    console.log(
      `TB OperatorFloat: debits=${operatorFloat.debitsPosted}, credits=${operatorFloat.creditsPosted}`
    );

    // ProviderFloat was credited (PROVIDER_TOPUP)
    expect(providerFloat.creditsPosted).toBeGreaterThan(0n);
    console.log(
      `TB ProviderFloat: debits=${providerFloat.debitsPosted}, credits=${providerFloat.creditsPosted}`
    );

    // 7. Assert OpenRouter: credit balance increased
    const creditsAfter = await getOpenRouterCredits(OPENROUTER_API_KEY);
    console.log(
      `OpenRouter credits after: ${creditsAfter} (delta: ${creditsAfter - creditsBefore})`
    );
    // OpenRouter minimum charge is $1.00, with 5% fee the net increase should be ~$1.00
    expect(creditsAfter).toBeGreaterThan(creditsBefore);

    // 8. Idempotency: second call should not double-charge
    const creditsBeforeRetry = creditsAfter;
    const retryResponse = await fetch(
      `${TEST_BASE_URL}/api/v1/payments/credits/confirm`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie(),
        },
        body: JSON.stringify({
          amountUsdCents: AMOUNT_USD_CENTS,
          clientPaymentId, // same ID
        }),
      }
    );
    expect(retryResponse.ok).toBe(true);
    const retryData = (await retryResponse.json()) as {
      balanceCredits: number;
    };
    // Balance should not increase on duplicate
    expect(retryData.balanceCredits).toBe(confirmData.balanceCredits);

    // Funding row unchanged
    const retryFundingRows = await db
      .select()
      .from(providerFundingAttempts)
      .where(eq(providerFundingAttempts.paymentIntentId, clientPaymentId));
    expect(retryFundingRows).toHaveLength(1);
    expect(retryFundingRows[0]?.status).toBe("funded");

    // OpenRouter credits should not increase again
    // (small delay to let any async work settle)
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const creditsAfterRetry = await getOpenRouterCredits(OPENROUTER_API_KEY);
    expect(creditsAfterRetry).toBe(creditsBeforeRetry);
    console.log("Idempotency verified: no duplicate charge on retry");
  }, 60_000);
});
