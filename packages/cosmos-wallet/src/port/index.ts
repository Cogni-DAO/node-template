// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/cosmos-wallet/port/index`
 * Purpose: Barrel export for Cosmos wallet port types and schemas.
 * Scope: Re-exports only. Does NOT implement logic.
 * Invariants: none
 * Side-effects: none
 * Links: docs/spec/akash-deploy-service.md
 * @public
 */

export type {
  CosmosBalance,
  CosmosTxResult,
  CosmosWalletConfig,
  CosmosWalletPort,
} from "./cosmos-wallet.port.js";
export type { AkashDepositMsg } from "./cosmos-wallet.schemas.js";
export {
  akashDepositMsgSchema,
  cosmosBalanceSchema,
  cosmosTxResultSchema,
  cosmosWalletConfigSchema,
} from "./cosmos-wallet.schemas.js";
