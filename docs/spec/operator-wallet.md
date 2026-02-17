---
id: operator-wallet
type: spec
title: "Operator Wallet: Lifecycle, Custody & Access Control"
status: draft
spec_state: draft
trust: draft
summary: Server-side operator wallet that receives user USDC payments and executes outbound transfers — Privy-managed custody with intent-only API surface, strict caps, and automatic sweep.
read_when: Working on OperatorWalletPort, operator wallet provisioning, key management, or outbound payment flows.
implements: proj.ai-operator-wallet
owner: derekg1729
created: 2026-02-17
verified:
tags: [web3, wallet, security]
---

# Operator Wallet: Lifecycle, Custody & Access Control

> A server-side wallet that receives user USDC payments and executes outbound transfers — Privy-managed custody, workflows submit typed intents, no raw signing in the app. No generic signing surface.

### Key References

|              |                                                                           |                                         |
| ------------ | ------------------------------------------------------------------------- | --------------------------------------- |
| **Project**  | [proj.ai-operator-wallet](../../work/projects/proj.ai-operator-wallet.md) | Roadmap and planning                    |
| **Research** | [AI Operator Wallet](../research/ai-operator-wallet-budgeted-spending.md) | Custody options evaluation              |
| **Spec**     | [Web3 → OpenRouter Top-Up](./web3-openrouter-payments.md)                 | First outbound consumer of this wallet  |
| **Spec**     | [DAO Enforcement](./dao-enforcement.md)                                   | Chain + address governance in repo-spec |
| **Spec**     | [Payments Design](./payments-design.md)                                   | Inbound USDC payment flow               |

## Requirements

1. **No DAO signing keys in the app.** DAO = cold treasury receiver only.
2. **No human governance/voting per purchase.** Payments must "just work" automatically.
3. **Immediate OpenRouter top-up after user payment.** No manual refills in the loop.
4. **No new smart contracts (for now).** Keep rails simple and ship fast.
5. **Programmatic setup.** No copy/paste private keys; secrets injected into deploy secret store.
6. **Chain-agnostic core.** Most logic should be ports, not Base/EVM-specific code.
7. **Hardened enough for MVP.** Privy-managed wallet with strict caps + scoped methods + sweep.

## Design

### Role: Inbound Receiver + Outbound Actuator

The operator wallet serves two roles:

1. **Inbound:** Receives user USDC payments (replaces direct-to-DAO-wallet flow). The existing payment verification pipeline works unchanged — `receiving_address` in repo-spec points to the operator wallet.
2. **Outbound:** Executes two types of transfers after credit settlement:
   - Sweep DAO's share (USDC) to treasury
   - Top up OpenRouter credits (ETH via Coinbase Commerce swap)

### Architecture: Three Access Layers

```
┌─────────────────────────────────────────────────────────┐
│                     UI (browser)                         │
│  Can: trigger payment (sends USDC to operator wallet)    │
│  Cannot: see key material, sign directly, choose dest    │
└────────────────────┬────────────────────────────────────┘
                     │ existing USDC transfer flow
                     ▼
┌─────────────────────────────────────────────────────────┐
│                  Workflow Layer                           │
│  Can: call OperatorWalletPort with typed intents         │
│  Cannot: access raw key, construct arbitrary calldata    │
│  Validates: intent params, amount caps                   │
└────────────────────┬────────────────────────────────────┘
                     │ sweepUsdcToTreasury(amount)
                     │ fundOpenRouterTopUp(intent)
                     ▼
┌─────────────────────────────────────────────────────────┐
│           OperatorWalletPort (custody layer)              │
│  Can: submit whitelisted tx types via Privy API          │
│  Cannot: be called with arbitrary calldata               │
│  Validates: destination allowlist, sender match           │
└────────────────────┬────────────────────────────────────┘
                     │ Privy signs + broadcasts
                     ▼
                  Base (8453)
```

### Wallet Provisioning (DAO Setup)

Wallet creation is programmatic via Privy API — no local key generation, no copy/paste secrets.

```
Setup flow (run once during DAO formation):

1. Create Privy app → obtain App ID + App Secret
2. Enable wallet policies:
   - Only Base (chain_id 8453)
   - Only allowed contracts (USDC, Coinbase Transfers)
   - Per-tx caps
3. Enable "Require signed requests" → obtain Signing Key
4. Programmatically create operator wallet via Privy API
   → Returns checksummed address (no private key ever leaves Privy)
5. Inject deploy secrets into secret store (GitHub Secrets / Vercel env / etc.):
   - PRIVY_APP_ID
   - PRIVY_APP_SECRET
   - PRIVY_SIGNING_KEY
6. Update .cogni/repo-spec.yaml:
   a. Set operator_wallet.address to the Privy-returned address
   b. Set payments_in.credits_topup.receiving_address to the same address
7. Fund the address with initial USDC + small ETH balance on Base
```

No keystore files. No passphrases. No local key material. Privy holds the signing key in its HSM infrastructure.

### OperatorWalletPort Interface

The port is a narrow, typed interface — a bounded payments actuator, not a generic signer.

```typescript
interface OperatorWalletPort {
  /** Return the operator wallet's public address (checksummed) */
  getAddress(): string;

  /**
   * Sweep USDC from operator wallet to DAO treasury.
   * Destination is hardcoded from repo-spec — caller cannot control it.
   *
   * @param amountRaw - USDC amount in raw units (6 decimals)
   * @param reference - Idempotency key (clientPaymentId)
   * @returns txHash on successful broadcast
   * @throws if balance insufficient or tx fails
   */
  sweepUsdcToTreasury(amountRaw: bigint, reference: string): Promise<string>;

  /**
   * Fund OpenRouter credits via Coinbase Commerce protocol.
   * Encodes swapAndTransferUniswapV3Native internally — caller cannot control calldata.
   *
   * @param intent - TransferIntent from OpenRouter's /api/v1/credits/coinbase
   * @returns txHash on successful broadcast
   * @throws if contract not allowlisted, sender mismatch, or value exceeds cap
   */
  fundOpenRouterTopUp(intent: TransferIntent): Promise<string>;
}
```

Future transaction types get their own named methods on the port — never a generic `signTransaction(calldata)`.

### P0 Adapter: Privy Server Wallet

```typescript
// src/adapters/server/wallet/privy-operator-wallet.adapter.ts

class PrivyOperatorWalletAdapter implements OperatorWalletPort {
  private privyClient: PrivyClient; // @privy-io/server-auth SDK
  private walletId: string; // Privy wallet ID (from provisioning)
  private operatorAddress: string; // from repo-spec, verified at startup
  private treasuryAddress: string; // cogni_dao.dao_contract from repo-spec

  async sweepUsdcToTreasury(
    amountRaw: bigint,
    reference: string
  ): Promise<string> {
    // 1. Encode ERC20 transfer(treasuryAddress, amountRaw) on USDC contract
    // 2. Submit via Privy API (Privy handles signing + broadcast)
    // 3. Return txHash
  }

  async fundOpenRouterTopUp(intent: TransferIntent): Promise<string> {
    // 1. Validate intent.metadata.sender === this.operatorAddress
    // 2. Validate intent.metadata.contract_address === TRANSFERS_CONTRACT
    // 3. Validate intent.metadata.chain_id === repo-spec chain_id
    // 4. Validate value <= OPERATOR_MAX_TOPUP_USD cap
    // 5. Encode: swapAndTransferUniswapV3Native(intent, 500)
    // 6. Submit via Privy API (Privy handles signing + broadcast)
    // 7. Return txHash
  }
}
```

### P1 Adapter (future): Keystore / Vault / KMS

The `OperatorWalletPort` abstraction makes the custody backend swappable. If the project moves to OSS-only custody later, a `KeystoreOperatorWalletAdapter` can implement the same port using local encrypted keystores + viem for broadcast. The port surface stays identical.

### Custody Safety

| Constraint                | Enforcement                                                                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Typed intents only**    | Port exposes `sweepUsdcToTreasury` and `fundOpenRouterTopUp` — no generic signing method.                                                                   |
| **Destination allowlist** | Treasury sweep goes to `dao_contract` from repo-spec. Top-up goes to Coinbase Transfers contract. No other destinations possible.                           |
| **Max per-tx**            | `OPERATOR_MAX_TOPUP_USD` env cap for top-ups. Port rejects any intent exceeding this.                                                                       |
| **Address in repo-spec**  | Operator wallet address is governance-in-git. Changing it requires a commit (auditable).                                                                    |
| **Key ≠ App**             | Privy HSM holds the signing key. The app never loads or accesses raw key material.                                                                          |
| **Key ≠ AI**              | The AI (OpenClaw, governance agents) submits intents through the workflow layer. The AI never accesses key material or Privy credentials.                   |
| **Privy wallet policies** | Privy-side policies restrict chain, contracts, and caps — defense in depth on top of app-side validation.                                                   |
| **Signed requests**       | All Privy API calls use "Require signed requests" — `PRIVY_SIGNING_KEY` authenticates the app to Privy. Leaked `APP_SECRET` alone cannot sign transactions. |
| **Sweep to cold**         | DAO treasury is cold (DAO multisig). Operator wallet is hot but auto-sweeps surplus to treasury.                                                            |

### repo-spec Configuration

```yaml
# .cogni/repo-spec.yaml additions

operator_wallet:
  address: "0x..." # checksummed, from Privy wallet creation API

payments_in:
  credits_topup:
    receiving_address: "0x..." # same as operator_wallet.address
```

The `receiving_address` update is the only change to the existing payment flow. The on-chain verifier, payment intent creation, and credit settlement all work as-is.

### Key Rotation

Key rotation creates a new wallet and decommissions the old one:

1. Create new wallet via Privy API (programmatic)
2. Update `operator_wallet.address` and `receiving_address` in `.cogni/repo-spec.yaml` (PR + governance approval)
3. Fund the new address (DAO governance proposal)
4. Update deploy secrets with new Privy wallet ID
5. Sweep remaining funds from old address to treasury via `sweepUsdcToTreasury`

## Goal

Provide a secure, narrow payments actuator for the platform's outbound on-chain payments — wallet provisioned programmatically via Privy, accessible only through typed intent methods. The same wallet receives inbound user payments, unifying inbound and outbound flows. No raw signing in the application.

## Non-Goals

- Custom smart contracts (PaymentRouter, etc.) — plain EOA is sufficient for P0
- Multi-wallet per service (single operator wallet for P0)
- Account abstraction / ERC-4337 (plain EOA for P0)
- Local keystore / HSM / Vault custody (Privy for P0; keystore adapter is P1 fallback)
- AI-initiated signing (AI submits intents; service signs via Privy)
- Automated key rotation
- Atomic on-chain split (app handles split in two separate transactions)
- DAO voting per purchase (fully automatic)

## Invariants

| Rule                        | Constraint                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| KEY_NEVER_IN_APP            | No raw private key material in the application process. Privy HSM holds the signing key.                                                         |
| SECRETS_NEVER_IN_SOURCE     | `PRIVY_APP_SECRET`, `PRIVY_SIGNING_KEY` MUST NOT be checked into source control.                                                                 |
| SECRETS_FROM_SECRET_STORE   | All Privy credentials MUST be sourced from the deployment's secret store, not `.env` files.                                                      |
| ADDRESS_VERIFIED_AT_STARTUP | Privy-reported wallet address MUST match `operator_wallet.address` from `.cogni/repo-spec.yaml`. Mismatch → fail fast.                           |
| NO_GENERIC_SIGNING          | `OperatorWalletPort` MUST NOT expose a generic `signTransaction(calldata)` method. Each tx type gets a named method.                             |
| DESTINATION_ALLOWLIST       | The adapter MUST reject any transaction where `to` is not in the hardcoded allowlist (USDC contract for sweeps, Coinbase Transfers for top-ups). |
| SIMULATE_BEFORE_BROADCAST   | Every transaction SHOULD be simulated before broadcast where the custody provider supports it.                                                   |
| INTENT_ONLY_CALLERS         | Workflow and UI layers submit typed intents. They MUST NOT construct calldata or access Privy credentials.                                       |
| SINGLE_OPERATOR_WALLET      | Exactly one operator wallet per deployment. Address recorded in repo-spec (governance-in-git).                                                   |
| RECEIVING_ADDRESS_MATCH     | `payments_in.credits_topup.receiving_address` MUST equal `operator_wallet.address`. Startup validation.                                          |
| PRIVY_SIGNED_REQUESTS       | All Privy API calls MUST use signed requests (`PRIVY_SIGNING_KEY`). App Secret alone is insufficient for signing.                                |

### Schema

No new tables for the wallet itself. Outbound transfer state is tracked in:

- `outbound_transfers` — DAO treasury USDC sweep (new, see PR 2)
- `outbound_topups` — OpenRouter top-ups (new, see [web3-openrouter-payments spec](./web3-openrouter-payments.md))

### File Pointers

| File                                                          | Purpose                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------- |
| `scripts/provision-operator-wallet.ts`                        | Programmatic wallet creation via Privy API (new)        |
| `src/ports/operator-wallet.port.ts`                           | `OperatorWalletPort` interface (new)                    |
| `src/adapters/server/wallet/privy-operator-wallet.adapter.ts` | P0 adapter: Privy server wallet (new)                   |
| `src/shared/config/repoSpec.server.ts`                        | `getOperatorWalletConfig()` from repo-spec              |
| `.cogni/repo-spec.yaml`                                       | `operator_wallet.address` + `receiving_address`         |
| `src/shared/env/server-env.ts`                                | `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_SIGNING_KEY` |

### Env Vars

| Variable                 | Required | Purpose                                          |
| ------------------------ | -------- | ------------------------------------------------ |
| `PRIVY_APP_ID`           | Yes\*    | Privy application identifier                     |
| `PRIVY_APP_SECRET`       | Yes\*    | Privy application secret (API auth)              |
| `PRIVY_SIGNING_KEY`      | Yes\*    | Privy signed-requests key (tx auth)              |
| `OPERATOR_MAX_TOPUP_USD` | No       | Per-tx cap for OpenRouter top-ups (default: 500) |

\*Required when operator wallet features are enabled. Optional in schema so existing deployments don't break.

## Open Questions

- [x] ~~Should the keystore be loaded lazily or eagerly?~~ N/A — Privy is API-based, no local loading.
- [ ] What is the right hot wallet balance target? Enough for N top-ups? Need operational data on typical purchase frequency.
- [ ] Privy wallet policies: exact allowlist configuration (which contracts, which function selectors) — define during provisioning.

## Related

- [Web3 → OpenRouter Top-Up](./web3-openrouter-payments.md) — Outbound top-up flow (payment math + state machine)
- [Payments Design](./payments-design.md) — Inbound USDC payment flow
- [DAO Enforcement](./dao-enforcement.md) — Governance-in-git rails
- [proj.ai-operator-wallet](../../work/projects/proj.ai-operator-wallet.md) — Project roadmap
