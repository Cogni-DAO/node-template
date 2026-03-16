---
id: task.0167
type: task
title: "Node lifecycle: formation outputs payments_pending, add setup:payments activation entrypoint"
status: needs_implement
priority: 1
rank: 15
estimate: 2
summary: "Update formation repo-spec output to include payments_status: pending_activation. Add pnpm setup:payments entrypoint that wraps provision-operator-wallet + deploy-split + validation into one guided flow. Document the formation→activation boundary in node-formation spec."
outcome: "New nodes get a repo-spec with explicit pending_activation status. Fork owners run one command to activate payments. The formation→activation boundary is documented."
spec_refs: operator-wallet, node-formation
assignees: derekg1729
credit:
project: proj.ai-operator-wallet
branch: feat/setup-dao-script
pr:
reviewer:
revision: 4
blocked_by:
deploy_verified: false
created: 2026-03-15
updated: 2026-03-16
labels: [wallet, web3, tooling, setup]
external_refs:
---

# Node lifecycle: formation outputs payments_pending, add setup:payments activation entrypoint

## Context

Formation (shared operator UI) creates governance identity. Payment activation (Privy wallet + Split) belongs to the child node's own trust domain. Today these are scattered ad-hoc scripts with no clear entrypoint or status tracking.

## Design

### Two phases, two trust domains

**Formation** (operator repo UI at `/setup/dao`):

- Outputs `cogni_dao` section in repo-spec
- Adds `payments_status: pending_activation` so the child node knows it needs setup
- Does NOT create operator wallet or deploy Split

**Activation** (child node repo, after fork + infra setup):

- `pnpm setup:payments` — guided CLI entrypoint
- Step 1: verify Privy env configured
- Step 2: provision operator wallet (or skip if exists)
- Step 3: deploy Split (operator wallet + DAO treasury as recipients)
- Step 4: validate Split by simulating distribute
- Step 5: output repo-spec fragment with `operator_wallet` + `payments_in`
- Each step is idempotent (safe to re-run on failure)

### What constitutes "payments active"

All three must be present in repo-spec:

- `operator_wallet.address` — Privy-managed EOA
- `payments_in.credits_topup.receiving_address` — Split contract
- Both verified on-chain (Split has code, allocations match)

The app already handles missing fields gracefully — `getOperatorWalletConfig()` returns `undefined`, funding chain is skipped.

## Requirements

- **R1**: `buildRepoSpecYaml` outputs `payments_status: pending_activation` in formation output
- **R2**: `pnpm setup:payments` script wraps existing provision + deploy + validate steps
- **R3**: Each step checks preconditions and skips if already done
- **R4**: Script outputs the repo-spec fragment to paste
- **R5**: Document formation→activation boundary in node-formation spec
- **R6**: Update SETUP_DESIGN.md with payments activation section

## Allowed Changes

- `apps/web/src/app/api/setup/verify/route.ts` (update `buildRepoSpecYaml` output)
- `scripts/setup-payments.ts` (new — wraps provision + deploy + validate)
- `package.json` (add `setup:payments` script)
- `docs/spec/node-formation.md` (add activation boundary section)
- `scripts/setup/SETUP_DESIGN.md` (add payments activation docs)
- `docs/guides/operator-wallet-setup.md` (simplify to reference setup:payments)

## Plan

- [ ] Update `buildRepoSpecYaml` to include `payments_status: pending_activation`
- [ ] Create `scripts/setup-payments.ts` wrapping existing scripts
- [ ] Add `setup:payments` to package.json
- [ ] Update node-formation spec with activation boundary
- [ ] Update SETUP_DESIGN.md
- [ ] Simplify operator-wallet-setup guide
- [ ] Run `pnpm check`

## Validation

```bash
pnpm check
pnpm dotenv -e .env.local -- pnpm setup:payments --help
```

## Review Checklist

- [ ] **Work Item:** `task.0167` linked in PR body
- [ ] **Spec:** formation→activation boundary documented
- [ ] **Tests:** existing verify contract tests still pass
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Fixes: bug.0166 design gap (ad-hoc Split deployment)

## Attribution

-
