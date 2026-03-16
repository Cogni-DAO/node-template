---
id: task.0167
type: task
title: "DAO formation — add Split deployment step + operator wallet to repo-spec output"
status: needs_implement
priority: 1
rank: 15
estimate: 2
summary: "Add Split contract deployment as a wagmi step in the existing DAO formation flow. User's connected wallet deploys the Split (same pattern as DAO + Signal). Operator wallet address is a form input. repo-spec output includes all addresses."
outcome: "DAO formation deploys DAO + Signal + Split in one UI flow. repo-spec output includes cogni_dao + operator_wallet + payments_in sections. No env secrets required — user signs all txs via connected wallet."
spec_refs: operator-wallet, node-formation
assignees: derekg1729
credit:
project: proj.ai-operator-wallet
branch: feat/setup-dao-script
pr:
reviewer:
revision: 3
blocked_by:
deploy_verified: false
created: 2026-03-15
updated: 2026-03-15
labels: [wallet, web3, tooling, setup]
external_refs:
---

# DAO formation — add Split deployment step + operator wallet to repo-spec output

## Context

The DAO formation UI flow deploys an Aragon DAO + CogniSignal contract via the user's connected wallet (wagmi). It outputs a repo-spec YAML snippet missing the financial rails: `operator_wallet` and `payments_in` sections.

Split deployment uses the same pattern — `writeContract` via wagmi to call the 0xSplits factory. The user's connected wallet pays gas and becomes the Split controller. Recipients are the Privy-managed operator wallet (form input) + the DAO treasury (derived from the just-deployed DAO contract). No private keys or env secrets needed.

## Existing Formation Flow

```
IDLE → PREFLIGHT → CREATING_DAO → AWAITING_DAO_CONFIRMATION
  → DEPLOYING_SIGNAL → AWAITING_SIGNAL_CONFIRMATION → VERIFYING → SUCCESS
```

Key files:

- State machine: `apps/web/src/features/setup/daoFormation/formation.reducer.ts`
- Tx builders: `apps/web/src/features/setup/daoFormation/txBuilders.ts`
- Hook: `apps/web/src/features/setup/hooks/useDAOFormation.ts`
- Verify route: `apps/web/src/app/api/setup/verify/route.ts` (`buildRepoSpecYaml`)
- UI: `apps/web/src/features/setup/components/FormationFlowDialog.tsx`

## Design

Add `DEPLOYING_SPLIT → AWAITING_SPLIT_CONFIRMATION` between Signal and Verify:

```
... → DEPLOYING_SIGNAL → AWAITING_SIGNAL_CONFIRMATION
  → DEPLOYING_SPLIT → AWAITING_SPLIT_CONFIRMATION → VERIFYING → SUCCESS
```

- User's connected wallet calls `splitV2o2Factory.createSplit()` via wagmi `writeContract`
- Recipients: operator wallet address (form input) + DAO contract address (from step 1)
- Allocations: derived from `calculateSplitAllocations` (same math as `deploy-split.ts`)
- Controller/owner: operator wallet address (can update allocations later)
- Split address extracted from `SplitCreated` event in tx receipt

`DAOFormationConfig` gains `operatorWalletAddress: HexAddress` field.

`buildRepoSpecYaml` gains `operatorWalletAddress` and `splitAddress` params:

```yaml
operator_wallet:
  address: "0x..."

payments_in:
  credits_topup:
    provider: cogni-usdc-backend-v1
    receiving_address: "0x..." # Split address
    allowed_chains:
      - Base
    allowed_tokens:
      - USDC
```

## Requirements

- **R1**: Add `operatorWalletAddress` to `DAOFormationConfig` (form input)
- **R2**: Add `DEPLOYING_SPLIT` / `AWAITING_SPLIT_CONFIRMATION` phases to reducer
- **R3**: `buildDeploySplitArgs` in txBuilders — calls `calculateSplitAllocations`, returns factory call args
- **R4**: Wire Split deploy step in `useDAOFormation` hook (same wagmi pattern as DAO + Signal)
- **R5**: Update `buildRepoSpecYaml` to include `operator_wallet` and `payments_in` sections
- **R6**: Update verify route to accept + validate Split address
- **R7**: Delete `scripts/deploy-split.ts` (superseded by UI flow)

## Allowed Changes

- `apps/web/src/features/setup/daoFormation/formation.reducer.ts`
- `apps/web/src/features/setup/daoFormation/txBuilders.ts`
- `apps/web/src/features/setup/hooks/useDAOFormation.ts`
- `apps/web/src/features/setup/components/FormationFlowDialog.tsx`
- `apps/web/src/app/api/setup/verify/route.ts`
- `apps/web/src/contracts/setup.verify.v1.contract.ts`
- `scripts/deploy-split.ts` (delete)

## Plan

- [ ] Add `operatorWalletAddress` to `DAOFormationConfig`
- [ ] Add `DEPLOYING_SPLIT` / `AWAITING_SPLIT_CONFIRMATION` / `SPLIT_TX_SENT` / `SPLIT_TX_CONFIRMED` / `SPLIT_TX_FAILED` to reducer
- [ ] Add `buildDeploySplitArgs` to txBuilders
- [ ] Wire Split deployment in `useDAOFormation` hook (auto-deploy after signal confirmed)
- [ ] Update `FormationFlowDialog` UI to show Split deployment progress + operator wallet input
- [ ] Update verify contract + route with Split address
- [ ] Update `buildRepoSpecYaml` with operator_wallet + payments_in sections
- [ ] Delete `scripts/deploy-split.ts`
- [ ] Run `pnpm check`

## Validation

```bash
pnpm check
pnpm vitest run --config apps/web/vitest.config.mts apps/web/tests/unit/features/setup
```

**Expected:** Formation flow deploys DAO + Signal + Split. Repo-spec output includes all sections.

## Review Checklist

- [ ] **Work Item:** `task.0167` linked in PR body
- [ ] **Spec:** RECEIVING_ADDRESS_IS_SPLIT invariant upheld
- [ ] **Tests:** formation reducer tests cover DEPLOYING_SPLIT phase
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Fixes: bug.0166 (stale Split contract mismatch — structural fix, not just redeploy)

## Attribution

-
