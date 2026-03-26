// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/cosmos-wallet`
 * Purpose: Cosmos SDK wallet abstraction for Akash Network deployments.
 * Scope: Public API surface — port types and schemas. Does NOT contain adapter implementations.
 * Invariants: Adapters imported via subpath exports, not from root.
 * Side-effects: none
 * Links: docs/spec/akash-deploy-service.md
 */

export type {
  AkashDepositMsg,
  CosmosBalance,
  CosmosTxResult,
  CosmosWalletConfig,
  CosmosWalletPort,
} from "./port/index.js";

export {
  akashDepositMsgSchema,
  cosmosBalanceSchema,
  cosmosTxResultSchema,
  cosmosWalletConfigSchema,
} from "./port/index.js";
