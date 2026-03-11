// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/financial-ledger/domain/accounts`
 * Purpose: Well-known TigerBeetle account IDs, ledger IDs, account codes, and transfer codes.
 * Scope: Pure constants — no I/O, no imports from adapters or app code. Does not contain runtime logic.
 * Invariants:
 *   - MULTI_INSTRUMENT: Separate ledger ID per asset type
 *   - ALL_MATH_BIGINT: All account IDs are bigint (u128)
 * Side-effects: none
 * Links: docs/spec/financial-ledger.md (Accounts Hierarchy, Ledger IDs)
 * @public
 */

// ─── Ledger IDs (Asset Types) ──────────────────────────────────────
// Per financial-ledger-spec: one ledger per asset type

export const LEDGER = {
  USD: 1,
  USDC: 2,
  EUR: 3,
  COGNI: 100,
  CREDIT: 200,
} as const;

// ─── Account Codes (Categories) ────────────────────────────────────

export const ACCOUNT_CODE = {
  ASSETS: 1,
  LIABILITY: 2,
  REVENUE: 3,
  EXPENSE: 4,
  CLEARING: 5,
} as const;

// ─── Transfer Codes ────────────────────────────────────────────────

export const TRANSFER_CODE = {
  CREDIT_DEPOSIT: 1,
  AI_USAGE: 2,
  OPERATOR_FUNDING: 3,
  PROVIDER_EXPENSE: 4,
  HOSTING_EXPENSE: 5,
  EPOCH_ACCRUAL: 6,
  CLAIM_SETTLEMENT: 7,
} as const;

// ─── Well-Known Account IDs ────────────────────────────────────────
// Per financial-ledger-spec: Accounts Hierarchy
// IDs use simple sequential bigints grouped by ledger:
//   1xxx = CREDIT ledger, 2xxx = USDC ledger,
//   3xxx = COGNI ledger,  4xxx = EUR ledger,  9xxx = Clearing

export const ACCOUNT = {
  // --- Ledger 200: CREDIT (internal AI credits, 10M per USD) ---
  ASSETS_USER_DEPOSITS_CREDIT: 1001n,
  LIABILITY_USER_CREDITS_CREDIT: 1002n,
  REVENUE_AI_USAGE_CREDIT: 1003n,
  REVENUE_X402_SETTLEMENTS_CREDIT: 1004n,

  // --- Ledger 2: USDC (on-chain stablecoin, scale=6) ---
  ASSETS_ONCHAIN_USDC: 2001n,
  ASSETS_TREASURY_USDC: 2002n,
  ASSETS_OPERATOR_FLOAT_USDC: 2003n,
  EXPENSE_AI_OPENROUTER_USDC: 2004n,
  EXPENSE_CONTRIBUTOR_REWARDS_USDC: 2005n,

  // --- Ledger 100: COGNI (governance token, scale=0) ---
  ASSETS_EMISSIONS_VAULT_COGNI: 3001n,
  ASSETS_DISTRIBUTOR_COGNI: 3002n,
  LIABILITY_UNCLAIMED_EQUITY_COGNI: 3003n,
  EXPENSE_CONTRIBUTOR_REWARDS_COGNI: 3004n,

  // --- Ledger 3: EUR (fiat for hosting costs, scale=2) ---
  ASSETS_TREASURY_EUR: 4001n,
  EXPENSE_INFRASTRUCTURE_HOSTING_EUR: 4002n,

  // --- Clearing accounts (cross-ledger bridges) ---
  CLEARING_USDC_TO_CREDIT_USDC: 9001n,
  CLEARING_USDC_TO_CREDIT_CREDIT: 9002n,
} as const;

// ─── Account Definitions (for idempotent creation) ─────────────────

export interface AccountDefinition {
  readonly id: bigint;
  readonly ledger: number;
  readonly code: number;
  readonly name: string;
}

/** All well-known accounts with their ledger and code mappings. */
export const ACCOUNT_DEFINITIONS: readonly AccountDefinition[] = [
  // CREDIT ledger
  {
    id: ACCOUNT.ASSETS_USER_DEPOSITS_CREDIT,
    ledger: LEDGER.CREDIT,
    code: ACCOUNT_CODE.ASSETS,
    name: "Assets:UserDeposits:CREDIT",
  },
  {
    id: ACCOUNT.LIABILITY_USER_CREDITS_CREDIT,
    ledger: LEDGER.CREDIT,
    code: ACCOUNT_CODE.LIABILITY,
    name: "Liability:UserCredits:CREDIT",
  },
  {
    id: ACCOUNT.REVENUE_AI_USAGE_CREDIT,
    ledger: LEDGER.CREDIT,
    code: ACCOUNT_CODE.REVENUE,
    name: "Revenue:AIUsage:CREDIT",
  },
  {
    id: ACCOUNT.REVENUE_X402_SETTLEMENTS_CREDIT,
    ledger: LEDGER.CREDIT,
    code: ACCOUNT_CODE.REVENUE,
    name: "Revenue:x402Settlements:CREDIT",
  },
  // USDC ledger
  {
    id: ACCOUNT.ASSETS_ONCHAIN_USDC,
    ledger: LEDGER.USDC,
    code: ACCOUNT_CODE.ASSETS,
    name: "Assets:OnChain:USDC",
  },
  {
    id: ACCOUNT.ASSETS_TREASURY_USDC,
    ledger: LEDGER.USDC,
    code: ACCOUNT_CODE.ASSETS,
    name: "Assets:Treasury:USDC",
  },
  {
    id: ACCOUNT.ASSETS_OPERATOR_FLOAT_USDC,
    ledger: LEDGER.USDC,
    code: ACCOUNT_CODE.ASSETS,
    name: "Assets:OperatorFloat:USDC",
  },
  {
    id: ACCOUNT.EXPENSE_AI_OPENROUTER_USDC,
    ledger: LEDGER.USDC,
    code: ACCOUNT_CODE.EXPENSE,
    name: "Expense:AI:OpenRouter:USDC",
  },
  {
    id: ACCOUNT.EXPENSE_CONTRIBUTOR_REWARDS_USDC,
    ledger: LEDGER.USDC,
    code: ACCOUNT_CODE.EXPENSE,
    name: "Expense:ContributorRewards:USDC",
  },
  // COGNI ledger
  {
    id: ACCOUNT.ASSETS_EMISSIONS_VAULT_COGNI,
    ledger: LEDGER.COGNI,
    code: ACCOUNT_CODE.ASSETS,
    name: "Assets:EmissionsVault:COGNI",
  },
  {
    id: ACCOUNT.ASSETS_DISTRIBUTOR_COGNI,
    ledger: LEDGER.COGNI,
    code: ACCOUNT_CODE.ASSETS,
    name: "Assets:Distributor:COGNI",
  },
  {
    id: ACCOUNT.LIABILITY_UNCLAIMED_EQUITY_COGNI,
    ledger: LEDGER.COGNI,
    code: ACCOUNT_CODE.LIABILITY,
    name: "Liability:UnclaimedEquity:COGNI",
  },
  {
    id: ACCOUNT.EXPENSE_CONTRIBUTOR_REWARDS_COGNI,
    ledger: LEDGER.COGNI,
    code: ACCOUNT_CODE.EXPENSE,
    name: "Expense:ContributorRewards:COGNI",
  },
  // EUR ledger
  {
    id: ACCOUNT.ASSETS_TREASURY_EUR,
    ledger: LEDGER.EUR,
    code: ACCOUNT_CODE.ASSETS,
    name: "Assets:Treasury:EUR",
  },
  {
    id: ACCOUNT.EXPENSE_INFRASTRUCTURE_HOSTING_EUR,
    ledger: LEDGER.EUR,
    code: ACCOUNT_CODE.EXPENSE,
    name: "Expense:Infrastructure:Hosting:EUR",
  },
  // Clearing
  {
    id: ACCOUNT.CLEARING_USDC_TO_CREDIT_USDC,
    ledger: LEDGER.USDC,
    code: ACCOUNT_CODE.CLEARING,
    name: "Clearing:USDCtoCredit:USDC",
  },
  {
    id: ACCOUNT.CLEARING_USDC_TO_CREDIT_CREDIT,
    ledger: LEDGER.CREDIT,
    code: ACCOUNT_CODE.CLEARING,
    name: "Clearing:USDCtoCredit:CREDIT",
  },
];
