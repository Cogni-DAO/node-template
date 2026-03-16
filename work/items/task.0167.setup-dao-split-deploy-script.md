---
id: task.0167
type: task
title: "setup-dao script — deploy Split contract + output repo-spec snippet"
status: needs_implement
priority: 1
rank: 15
estimate: 2
summary: "Unified setup-dao script that provisions an operator wallet (Privy), deploys a Split contract with correct allocations, validates the deployment on-chain, and outputs the repo-spec YAML snippet for a fresh node."
outcome: "A new operator node can run `pnpm setup:dao` and get a working Split contract + repo-spec snippet in one command. No manual address copying, no mismatch bugs."
spec_refs: operator-wallet
assignees: derekg1729
credit:
project: proj.ai-operator-wallet
branch: feat/setup-dao-script
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-15
updated: 2026-03-15
labels: [wallet, web3, tooling]
external_refs:
---

# setup-dao script — deploy Split contract + output repo-spec snippet

## Context

Bug.0166 proved that deploying the Split contract manually with env vars leads to address mismatches. The existing scripts (`provision-operator-wallet.ts`, `deploy-split.ts`) are separate, require manual repo-spec updates, and have no validation step. This task combines them into a single `setup:dao` command that deploys everything and outputs the correct repo-spec YAML.

## Requirements

- **R1**: Single `pnpm setup:dao` command that runs the full DAO financial rails setup
- **R2**: Step 1 — provision operator wallet via Privy (reuse `provision-operator-wallet.ts` logic), or skip if wallet already exists
- **R3**: Step 2 — deploy Split contract with operator wallet address + DAO treasury address as recipients (reuse `deploy-split.ts` logic)
- **R4**: Step 3 — validate the deployment by simulating a `distribute` call against the new Split contract (must not revert with `InvalidSplit`)
- **R5**: Output a copy-pasteable repo-spec YAML snippet with all addresses filled in
- **R6**: Read `DAO_TREASURY_ADDRESS` from env (the DAO contract address — governance input, not derived)
- **R7**: Read Privy credentials from env (`PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_SIGNING_KEY`)
- **R8**: Read deployer key from env (`DEPLOYER_PRIVATE_KEY`) — separate from operator wallet (Privy holds operator keys)
- **R9**: Idempotent — if operator wallet already exists in Privy, skip provisioning and use existing address

## Allowed Changes

- `scripts/setup-dao.ts` (new — the unified script)
- `package.json` (add `setup:dao` script)
- `scripts/setup/SETUP_DESIGN.md` (add DAO setup section reference)

## Plan

- [ ] Create `scripts/setup-dao.ts` combining provision + deploy + validate + output
- [ ] Step 1: Check Privy for existing wallet matching env, provision if missing
- [ ] Step 2: Deploy Split with operator address + DAO treasury
- [ ] Step 3: Simulate `distribute` on new Split to validate params match
- [ ] Step 4: Print repo-spec YAML snippet to stdout
- [ ] Add `setup:dao` script to root `package.json`
- [ ] Run `pnpm check`

## Validation

```bash
# Dry run (prints what it would do without deploying)
pnpm setup:dao --dry-run

# Full run (deploys on Base mainnet)
pnpm dotenv -e .env.local -- pnpm setup:dao
```

**Expected:** Script outputs repo-spec YAML snippet with valid addresses. Simulate step passes without `InvalidSplit`.

## Review Checklist

- [ ] **Work Item:** `task.0167` linked in PR body
- [ ] **Spec:** RECEIVING_ADDRESS_IS_SPLIT, ADDRESS_VERIFIED_AT_STARTUP invariants upheld
- [ ] **Tests:** validation step proves Split params match on-chain
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Fixes: bug.0166 (stale Split contract mismatch)
- Reuses: `scripts/provision-operator-wallet.ts`, `scripts/deploy-split.ts`

## Attribution

-
