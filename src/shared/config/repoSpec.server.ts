// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@shared/config/repoSpec.server`
 * Purpose: Server-only accessors for governance-managed configuration from .cogni/repo-spec.yaml (node identity + payments + governance schedules).
 * Scope: Reads and caches repo-spec on first access; validates node_id UUID, chain alignment, and receiver address shape; exposes getNodeId(), getPaymentConfig(), and getGovernanceConfig(). Does not run in client bundles or accept env overrides.
 * Invariants: Chain ID must match CHAIN_ID; EVM address format required; governance schedules default to empty.
 * Side-effects: IO (reads repo-spec from disk) on first call only.
 * Links: .cogni/repo-spec.yaml, docs/spec/payments-design.md
 * @public
 */

import fs from "node:fs";
import path from "node:path";

import { parse } from "yaml";

import { CHAIN_ID } from "@/shared/web3/chain";

import { type RepoSpec, repoSpecSchema } from "./repoSpec.schema";

export interface GovernanceSchedule {
  charter: string;
  cron: string;
  timezone: string;
  entrypoint: string;
}

export interface GovernanceConfig {
  schedules: GovernanceSchedule[];
}

export interface InboundPaymentConfig {
  chainId: number;
  receivingAddress: string;
  provider: string;
}

let cachedPaymentConfig: InboundPaymentConfig | null = null;

function loadRepoSpec(): RepoSpec {
  const repoSpecPath = path.join(process.cwd(), ".cogni", "repo-spec.yaml");

  if (!fs.existsSync(repoSpecPath)) {
    throw new Error(
      `[repo-spec] Missing configuration at ${repoSpecPath}; DAO wallet and chain settings must be committed`
    );
  }

  const content = fs.readFileSync(repoSpecPath, "utf8");

  let parsed: unknown;
  try {
    parsed = parse(content);
  } catch (error) {
    throw new Error(
      `[repo-spec] Failed to parse .cogni/repo-spec.yaml; ensure valid YAML: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const result = repoSpecSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `[repo-spec] Invalid repo-spec.yaml structure: ${result.error.message}`
    );
  }

  return result.data;
}

function validateAndMap(spec: RepoSpec): InboundPaymentConfig {
  // Convert chain_id to number (supports both string and number from YAML)
  const chainId =
    typeof spec.cogni_dao.chain_id === "string"
      ? Number(spec.cogni_dao.chain_id)
      : spec.cogni_dao.chain_id;

  if (!Number.isFinite(chainId)) {
    throw new Error(
      "[repo-spec] Invalid cogni_dao.chain_id; expected numeric chain ID"
    );
  }

  // TODO: Remove Sepolia (11155111) support from RepoSpecChainName enum once DAO is deployed on Base mainnet
  if (chainId !== CHAIN_ID) {
    throw new Error(
      `[repo-spec] Chain mismatch: repo-spec declares ${chainId}, app requires ${CHAIN_ID}`
    );
  }

  const topup = spec.payments_in.credits_topup;

  return {
    chainId,
    receivingAddress: topup.receiving_address.trim(),
    provider: topup.provider.trim(),
  };
}

export function getPaymentConfig(): InboundPaymentConfig {
  if (cachedPaymentConfig) {
    return cachedPaymentConfig;
  }

  const spec = loadRepoSpec();
  cachedPaymentConfig = validateAndMap(spec);

  return cachedPaymentConfig;
}

let cachedNodeId: string | null = null;

/**
 * Node identity from repo-spec. Scopes all ledger tables.
 * Fails fast if repo-spec is missing or node_id is invalid.
 */
export function getNodeId(): string {
  if (cachedNodeId) {
    return cachedNodeId;
  }

  const spec = loadRepoSpec();
  cachedNodeId = spec.node_id;
  return cachedNodeId;
}

let cachedGovernanceConfig: GovernanceConfig | null = null;

function mapGovernanceConfig(spec: RepoSpec): GovernanceConfig {
  return {
    schedules: spec.governance?.schedules ?? [],
  };
}

export function getGovernanceConfig(): GovernanceConfig {
  if (cachedGovernanceConfig) {
    return cachedGovernanceConfig;
  }

  const spec = loadRepoSpec();
  cachedGovernanceConfig = mapGovernanceConfig(spec);

  return cachedGovernanceConfig;
}
