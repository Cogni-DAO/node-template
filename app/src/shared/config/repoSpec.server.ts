// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@shared/config/repoSpec.server`
 * Purpose: Server-only thin wrapper — file I/O, caching, and CHAIN_ID validation for repo-spec accessors including DAO governance config.
 * Scope: Reads and caches repo-spec on first access; does not define schemas, validation logic, or perform network I/O.
 * Invariants: Chain ID must match CHAIN_ID; ledger config requires scope_id + scope_key; DaoConfig requires the four on-chain governance identity fields (base_url optional).
 * Side-effects: IO (reads repo-spec from disk) on first call only.
 * Links: packages/repo-spec/src/index.ts, .cogni/repo-spec.yaml
 * @public
 */

import fs from "node:fs";
import path from "node:path";
import { CHAIN_ID } from "@cogni/node-shared";
import {
	type DaoConfig,
	extractDaoConfig,
	extractDaoTreasuryAddress,
	extractGovernanceConfig,
	extractLedgerApprovers,
	extractNodeBrandColor,
	extractNodeBrandIcon,
	extractNodeHook,
	extractNodeMission,
	extractNodeName,
	extractNodeThumbnail,
	extractOperatorWalletConfig,
	extractPaymentConfig,
	extractStewardWalletConfig,
	type GovernanceConfig,
	type InboundPaymentConfig,
	type OperatorWalletSpec,
	parseRepoSpec,
	type RepoSpec,
	type StewardWalletSpec,
} from "@cogni/repo-spec";
import { serverEnv } from "@/shared/env";

export type {
	DaoConfig,
	GovernanceConfig,
	GovernanceSchedule,
	InboundPaymentConfig,
	LedgerConfig,
	LedgerPoolConfig,
} from "@cogni/repo-spec";

// ---------------------------------------------------------------------------
// File I/O + caching (server-only concerns)
// ---------------------------------------------------------------------------

let cachedSpec: RepoSpec | null = null;

function loadRepoSpec(): RepoSpec {
	if (cachedSpec) return cachedSpec;

	const repoRoot = serverEnv().COGNI_REPO_ROOT;
	if (!repoRoot) {
		throw new Error(
			"[repo-spec] COGNI_REPO_PATH not configured — repo-spec unavailable",
		);
	}
	const repoSpecPath = path.join(repoRoot, ".cogni", "repo-spec.yaml");

	if (!fs.existsSync(repoSpecPath)) {
		throw new Error(
			`[repo-spec] Missing configuration at ${repoSpecPath}; DAO wallet and chain settings must be committed`,
		);
	}

	const content = fs.readFileSync(repoSpecPath, "utf8");
	cachedSpec = parseRepoSpec(content);
	return cachedSpec;
}

// ---------------------------------------------------------------------------
// Cached accessors (delegate to @cogni/repo-spec pure functions)
// ---------------------------------------------------------------------------

let cachedPaymentConfig: InboundPaymentConfig | undefined | null = null;

export function getPaymentConfig(): InboundPaymentConfig | undefined {
	if (cachedPaymentConfig !== null) return cachedPaymentConfig;

	const spec = loadRepoSpec();
	cachedPaymentConfig = extractPaymentConfig(spec, CHAIN_ID);
	return cachedPaymentConfig;
}

let cachedNodeId: string | null = null;

/**
 * Node identity from repo-spec. Scopes all ledger tables.
 * Fails fast if repo-spec is missing or node_id is invalid.
 */
export function getNodeId(): string {
	if (cachedNodeId) return cachedNodeId;

	const spec = loadRepoSpec();
	cachedNodeId = spec.node_id;
	return cachedNodeId;
}

let cachedNodeName: string | null = null;

/** Human-facing node slug from repo-spec `intent.name` (falls back to node_id). */
export function getNodeName(): string {
	if (cachedNodeName) return cachedNodeName;
	cachedNodeName = extractNodeName(loadRepoSpec());
	return cachedNodeName;
}

/** One-line node mission from repo-spec `intent.mission`, or null when undeclared. */
export function getNodeMission(): string | null {
	return extractNodeMission(loadRepoSpec());
}

/** Punchy ~5-word gallery/heading hook from repo-spec `intent.hook`, or null. */
export function getNodeHook(): string | null {
	return extractNodeHook(loadRepoSpec());
}

/** Self-hosted brand thumbnail URL from repo-spec `intent.brand.thumbnail`, or null. */
export function getNodeThumbnail(): string | null {
	return extractNodeThumbnail(loadRepoSpec());
}

/** Monogram-tint brand color from repo-spec `intent.brand.color`, or null. */
export function getNodeBrandColor(): string | null {
	return extractNodeBrandColor(loadRepoSpec());
}

/** Lucide icon NAME (PascalCase) for the node's brand mark from repo-spec `intent.brand.icon`, or null. */
export function getNodeBrandIcon(): string | null {
	return extractNodeBrandIcon(loadRepoSpec());
}

/** The node's brand mark — slug + icon name + color — for the app header. */
export interface BrandMark {
	readonly slug: string;
	readonly icon: string | null;
	readonly color: string | null;
}

/**
 * Resolve the repo root WITHOUT `serverEnv()`. The app header renders in statically
 * prerendered `(public)` pages, where build-time prerender has no runtime env (no
 * DATABASE_URL etc.) — so `serverEnv()` would throw. The brand is static per
 * deployment and the `.cogni/repo-spec.yaml` file ships in the build, so we read it
 * directly: env path first (runtime), else walk up from cwd (build-time).
 */
function resolveRepoRootBuildSafe(): string | null {
	const fromEnv = process.env.COGNI_REPO_PATH ?? process.env.COGNI_REPO_ROOT;
	if (
		fromEnv &&
		fs.existsSync(path.join(fromEnv, ".cogni", "repo-spec.yaml"))
	) {
		return fromEnv;
	}
	let dir = process.cwd();
	for (let depth = 0; depth < 10; depth++) {
		if (fs.existsSync(path.join(dir, ".cogni", "repo-spec.yaml"))) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

let cachedBrandMark: BrandMark | null = null;

/**
 * Brand mark for the app header: slug + `intent.brand.{icon,color}`. Build-safe
 * (never calls serverEnv) with a neutral fallback, so static prerender never breaks.
 */
export function getBrandMark(): BrandMark {
	if (cachedBrandMark) return cachedBrandMark;

	const root = resolveRepoRootBuildSafe();
	if (root) {
		try {
			const spec = parseRepoSpec(
				fs.readFileSync(path.join(root, ".cogni", "repo-spec.yaml"), "utf8"),
			);
			cachedBrandMark = {
				slug: extractNodeName(spec),
				icon: extractNodeBrandIcon(spec),
				color: extractNodeBrandColor(spec),
			};
			return cachedBrandMark;
		} catch {
			// fall through to neutral default
		}
	}
	cachedBrandMark = { slug: "cogni", icon: null, color: null };
	return cachedBrandMark;
}

let cachedScopeId: string | null = null;

/**
 * Scope identity from repo-spec. Used by DrizzleAttributionAdapter for SCOPE_GATED_QUERIES.
 * Fails fast if repo-spec is missing scope_id.
 */
export function getScopeId(): string {
	if (cachedScopeId) return cachedScopeId;

	const spec = loadRepoSpec();
	if (!spec.scope_id) {
		throw new Error(
			"repo-spec missing scope_id — required for ledger scope gating",
		);
	}
	cachedScopeId = spec.scope_id;
	return cachedScopeId;
}

let cachedGovernanceConfig: GovernanceConfig | null = null;

export function getGovernanceConfig(): GovernanceConfig {
	if (cachedGovernanceConfig) return cachedGovernanceConfig;

	const spec = loadRepoSpec();
	cachedGovernanceConfig = extractGovernanceConfig(spec);
	return cachedGovernanceConfig;
}

// ---------------------------------------------------------------------------
// DAO config — governance section (for governance signal execution + review deep links)
// ---------------------------------------------------------------------------

let cachedDaoConfig: DaoConfig | null | undefined;

/**
 * DAO governance configuration from repo-spec.
 * Returns null only when the on-chain identity (dao/plugin/signal contracts +
 * chain_id) is incomplete. `base_url` is the optional governance-UI deep-link
 * host and does not gate this read.
 */
export function getDaoConfig(): DaoConfig | null {
	if (cachedDaoConfig !== undefined) return cachedDaoConfig;

	const spec = loadRepoSpec();
	cachedDaoConfig = extractDaoConfig(spec);
	return cachedDaoConfig;
}

let cachedLedgerApprovers: string[] | null = null;

/**
 * Ledger approver allowlist from repo-spec.
 * Returns lowercased EVM addresses for case-insensitive comparison.
 * Returns empty array if ledger config not present (write routes will reject all).
 */
export function getLedgerApprovers(): string[] {
	if (cachedLedgerApprovers) return cachedLedgerApprovers;

	const spec = loadRepoSpec();
	cachedLedgerApprovers = extractLedgerApprovers(spec);
	return cachedLedgerApprovers;
}

/**
 * Whether a wallet is in the ledger approver allowlist.
 * Case-insensitive; returns false for null/empty wallets (fail-closed).
 * Single source of truth for the `(admin)/` gate, the session `isApprover`
 * hint, and write-route enforcement.
 */
export function isLedgerApprover(wallet: string | null | undefined): boolean {
	if (!wallet) return false;
	return getLedgerApprovers().includes(wallet.toLowerCase());
}

/**
 * DAO-admin gate. A wallet is an admin when it is a ledger approver
 * (activity_ledger.approvers) OR the configured steward wallet
 * (payments_out.steward_wallet). At MVP steward == approver == admin
 * (the same wallet), so a node whose admin tab is approver-gated already
 * lets the steward in; the steward clause keeps the two definitions aligned.
 */
export function isDaoAdmin(wallet: string | null | undefined): boolean {
	if (!wallet) return false;
	if (isLedgerApprover(wallet)) return true;
	const steward = getStewardWalletConfig();
	return !!steward && steward.address.toLowerCase() === wallet.toLowerCase();
}

let cachedOperatorWalletConfig: OperatorWalletSpec | undefined | null = null;

/**
 * Operator wallet configuration from repo-spec.
 * Returns undefined if operator_wallet section is not present.
 */
export function getOperatorWalletConfig(): OperatorWalletSpec | undefined {
	if (cachedOperatorWalletConfig !== null) return cachedOperatorWalletConfig;

	const spec = loadRepoSpec();
	cachedOperatorWalletConfig = extractOperatorWalletConfig(spec);
	return cachedOperatorWalletConfig;
}

let cachedDaoTreasuryAddress: string | undefined | null = null;

/**
 * DAO treasury address from repo-spec (governance.dao_contract).
 * Returns undefined if not present.
 */
export function getDaoTreasuryAddress(): string | undefined {
	if (cachedDaoTreasuryAddress !== null) return cachedDaoTreasuryAddress;

	const spec = loadRepoSpec();
	cachedDaoTreasuryAddress = extractDaoTreasuryAddress(spec);
	return cachedDaoTreasuryAddress;
}

let cachedStewardWalletConfig: StewardWalletSpec | undefined | null = null;

/**
 * Steward wallet configuration from repo-spec (payments_out.steward_wallet).
 * The human-custodied address the operator wallet funds via withdrawToSteward.
 * Returns undefined if payments_out is not present.
 */
export function getStewardWalletConfig(): StewardWalletSpec | undefined {
	if (cachedStewardWalletConfig !== null) return cachedStewardWalletConfig;

	const spec = loadRepoSpec();
	cachedStewardWalletConfig = extractStewardWalletConfig(spec);
	return cachedStewardWalletConfig;
}
