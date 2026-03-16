---
id: task.0167
type: task
title: "DAO formation — add Split deployment step + operator wallet to repo-spec output"
status: needs_implement
priority: 1
rank: 15
estimate: 2
summary: "Add Split contract deployment as a step in the existing DAO formation flow. Update buildRepoSpecYaml to include operator_wallet and payments_in sections. The formation UI already handles DAO + Signal deployment — this adds the financial rails."
outcome: "DAO formation outputs a complete repo-spec with cogni_dao + operator_wallet + payments_in sections. Split contract deployed and validated as part of the formation flow."
spec_refs: operator-wallet, node-formation
assignees: derekg1729
credit:
project: proj.ai-operator-wallet
branch: feat/setup-dao-script
pr:
reviewer:
revision: 2
blocked_by:
deploy_verified: false
created: 2026-03-15
updated: 2026-03-15
labels: [wallet, web3, tooling, setup]
external_refs:
---

# DAO formation — add Split deployment step + operator wallet to repo-spec output

## Context

The DAO formation flow (`apps/web/src/features/setup/daoFormation/`) deploys an Aragon DAO + CogniSignal contract and outputs a repo-spec YAML snippet. It is missing the financial rails: operator wallet address and Split contract deployment. Bug.0166 proved that deploying the Split separately with manual env vars leads to address mismatches.

## Existing Formation Flow

```
IDLE → PREFLIGHT → CREATING_DAO → AWAITING_DAO_CONFIRMATION
  → DEPLOYING_SIGNAL → AWAITING_SIGNAL_CONFIRMATION → VERIFYING → SUCCESS
```

State machine: `apps/web/src/features/setup/daoFormation/formation.reducer.ts`
Tx builders: `apps/web/src/features/setup/daoFormation/txBuilders.ts`
Verification: `apps/web/src/app/api/setup/verify/route.ts` (includes `buildRepoSpecYaml`)
UI: `apps/web/src/features/setup/components/FormationFlowDialog.tsx`
Hook: `apps/web/src/features/setup/hooks/useDAOFormation.ts`

## Requirements

- **R1**: Add `DEPLOYING_SPLIT` phase to formation state machine (after SIGNAL, before VERIFY)
- **R2**: Build Split deploy tx using `@cogni/operator-wallet` allocation math (same as `deploy-split.ts`)
- **R3**: Operator wallet address is a required input to the formation flow (provisioned separately via `provision-operator-wallet.ts`)
- **R4**: Validate Split deployment by simulating `distribute` against the new contract
- **R5**: Update `buildRepoSpecYaml` to include `operator_wallet` and `payments_in.credits_topup` sections
- **R6**: Delete `scripts/deploy-split.ts` (superseded by formation flow)

## Allowed Changes

- `apps/web/src/features/setup/daoFormation/formation.reducer.ts` (add DEPLOYING_SPLIT phase)
- `apps/web/src/features/setup/daoFormation/txBuilders.ts` (add `buildDeploySplitArgs`)
- `apps/web/src/features/setup/hooks/useDAOFormation.ts` (wire Split deploy step)
- `apps/web/src/features/setup/components/FormationFlowDialog.tsx` (UI for Split step)
- `apps/web/src/app/api/setup/verify/route.ts` (update `buildRepoSpecYaml`, add Split validation)
- `apps/web/src/contracts/setup.verify.v1.contract.ts` (add Split address to contract)
- `scripts/deploy-split.ts` (delete)

## Plan

- [ ] Add `DEPLOYING_SPLIT` / `AWAITING_SPLIT_CONFIRMATION` phases to reducer
- [ ] Add `operatorWalletAddress` to `DAOFormationConfig`
- [ ] Add `buildDeploySplitArgs` to txBuilders (reuse `calculateSplitAllocations`)
- [ ] Wire Split deployment step in `useDAOFormation` hook
- [ ] Update `FormationFlowDialog` UI to show Split deployment progress
- [ ] Update verify route: validate Split `distribute` simulation, add to `buildRepoSpecYaml`
- [ ] Update verify contract with Split address fields
- [ ] Delete `scripts/deploy-split.ts`
- [ ] Run `pnpm check`

## Validation

```bash
pnpm check
pnpm vitest run --config apps/web/vitest.config.mts apps/web/tests/unit/features/setup
```

**Expected:** Formation flow deploys DAO + Signal + Split. Repo-spec output includes all three sections.

## Review Checklist

- [ ] **Work Item:** `task.0167` linked in PR body
- [ ] **Spec:** RECEIVING_ADDRESS_IS_SPLIT, node-formation invariants upheld
- [ ] **Tests:** formation reducer tests cover DEPLOYING_SPLIT phase
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Fixes: bug.0166 (stale Split contract mismatch)
- Extends: existing DAO formation flow

## Attribution

-
