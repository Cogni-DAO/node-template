---
id: operator-wallet
type: spec
title: "Operator Wallet: Lifecycle, Signing & Access Control"
status: draft
spec_state: draft
trust: draft
summary: Server-side operator wallet that receives user USDC payments and executes outbound transfers — deterministic keystore-based signing, intent-only API surface, hot wallet safety constraints.
read_when: Working on wallet generation, WalletSignerPort, operator key management, or outbound payment flows.
implements: proj.ai-operator-wallet
owner: derekg1729
created: 2026-02-17
verified:
tags: [web3, wallet, security]
---

# Operator Wallet: Lifecycle, Signing & Access Control

> A server-side wallet that receives user USDC payments and executes outbound transfers — workflows submit typed intents, the signing port executes them. No generic signing surface.

### Key References

|              |                                                                           |                                         |
| ------------ | ------------------------------------------------------------------------- | --------------------------------------- |
| **Project**  | [proj.ai-operator-wallet](../../work/projects/proj.ai-operator-wallet.md) | Roadmap and planning                    |
| **Research** | [AI Operator Wallet](../research/ai-operator-wallet-budgeted-spending.md) | Custody options evaluation              |
| **Spec**     | [Web3 → OpenRouter Top-Up](./web3-openrouter-payments.md)                 | First outbound consumer of this wallet  |
| **Spec**     | [DAO Enforcement](./dao-enforcement.md)                                   | Chain + address governance in repo-spec |
| **Spec**     | [Payments Design](./payments-design.md)                                   | Inbound USDC payment flow               |

## Design

### Role: Inbound Receiver + Outbound Signer

The operator wallet serves two roles:

1. **Inbound:** Receives user USDC payments (replaces direct-to-DAO-wallet flow). The existing payment verification pipeline works unchanged — `receiving_address` in repo-spec points to the operator wallet.
2. **Outbound:** Executes two types of transfers after credit settlement:
   - Forward DAO's share (USDC) to treasury
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
│  Can: call WalletSignerPort with typed intents           │
│  Cannot: access raw key, construct arbitrary calldata    │
│  Validates: intent params, amount caps                   │
└────────────────────┬────────────────────────────────────┘
                     │ sendUsdcToTreasury(amount)
                     │ signTopUpTransaction(intent)
                     ▼
┌─────────────────────────────────────────────────────────┐
│              WalletSignerPort (signing layer)             │
│  Can: load keystore, sign whitelisted tx types            │
│  Cannot: be called with arbitrary calldata                │
│  Validates: destination allowlist, sender match           │
└────────────────────┬────────────────────────────────────┘
                     │ broadcast
                     ▼
                  Base (8453)
```

### Wallet Generation (DAO Formation Script)

A standalone script run once during DAO setup. Not part of the runtime application.

```
scripts/generate-operator-wallet.ts

Input:
  --passphrase-env  ENV_VAR_NAME   (reads passphrase from this env var, never from CLI arg)
  --out-keystore    PATH           (where to write the encrypted keystore JSON)
  --out-address     stdout         (prints the derived address for repo-spec)

Output:
  1. Encrypted keystore JSON file (AES-128-CTR + scrypt KDF)
     - Same format as MetaMask/Geth (Web3 Secret Storage v3)
     - ethers.Wallet.createRandom() → wallet.encrypt(passphrase)
  2. Public address printed to stdout

Post-generation (manual operator steps):
  1. Store keystore file in deployment secret store
  2. Store passphrase in deployment secret store
  3. Update .cogni/repo-spec.yaml:
     a. Set operator_wallet.address to the generated address
     b. Set payments_in.credits_topup.receiving_address to the same address
  4. Fund the address with initial USDC + small ETH balance on Base
```

### Keystore Loading (Runtime)

The wallet is loaded once at application startup and cached in memory for the process lifetime.

```typescript
// Env vars
OPERATOR_KEYSTORE_PATH     // absolute path to keystore JSON file
OPERATOR_WALLET_PASSPHRASE // scrypt passphrase — from deploy secret store only

// Loading flow (startup)
1. Read keystore JSON from OPERATOR_KEYSTORE_PATH
2. Decrypt with OPERATOR_WALLET_PASSPHRASE → in-memory ethers.Wallet
3. Verify derived address matches operator_wallet.address from repo-spec
4. If mismatch → fail fast (wrong keystore for this deployment)
5. Cache wallet instance — no re-reads during runtime
```

The passphrase is used once (decrypt), then the in-memory wallet holds the key for signing. The passphrase itself is not retained after decryption.

### WalletSignerPort Interface

The port is a narrow, typed interface — not a generic transaction signer.

```typescript
interface WalletSignerPort {
  /** Return the operator wallet's public address (checksummed) */
  getAddress(): string;

  /**
   * Send USDC from operator wallet to DAO treasury.
   * Destination is hardcoded from repo-spec — caller cannot control it.
   *
   * @param amountRaw - USDC amount in raw units (6 decimals)
   * @param reference - Idempotency key (clientPaymentId)
   * @returns txHash on successful broadcast
   * @throws if simulation fails or balance insufficient
   */
  sendUsdcToTreasury(amountRaw: bigint, reference: string): Promise<string>;

  /**
   * Sign and broadcast a top-up transaction for the Coinbase Commerce protocol.
   * Encodes swapAndTransferUniswapV3Native internally — caller cannot control calldata.
   *
   * @param intent - TransferIntent from OpenRouter's /api/v1/credits/coinbase
   * @returns txHash on successful broadcast
   * @throws if simulation fails, contract not allowlisted, sender mismatch, or value exceeds cap
   */
  signTopUpTransaction(intent: TransferIntent): Promise<string>;
}
```

Future transaction types get their own named methods on the port — never a generic `signTransaction(calldata)`.

### P0 Adapter: Encrypted Keystore

```typescript
// src/adapters/server/wallet/keystore-signer.adapter.ts

class KeystoreSignerAdapter implements WalletSignerPort {
  private wallet: ethers.Wallet; // loaded at construction
  private publicClient: PublicClient; // viem client for simulation + broadcast
  private operatorAddress: string; // from repo-spec, verified against keystore
  private treasuryAddress: string; // cogni_dao.dao_contract from repo-spec

  async sendUsdcToTreasury(
    amountRaw: bigint,
    reference: string
  ): Promise<string> {
    // 1. Encode ERC20 transfer(treasuryAddress, amountRaw) on USDC contract
    // 2. simulateContract() — abort on revert
    // 3. Sign + broadcast
    // 4. Return txHash
  }

  async signTopUpTransaction(intent: TransferIntent): Promise<string> {
    // 1. Validate intent.metadata.sender === this.operatorAddress
    // 2. Validate intent.metadata.contract_address === TRANSFERS_CONTRACT
    // 3. Validate intent.metadata.chain_id === repo-spec chain_id
    // 4. Encode: swapAndTransferUniswapV3Native(intent, 500)
    // 5. Set value: recipient_amount + fee_amount + slippage buffer
    // 6. simulateContract() — abort on revert
    // 7. Sign + broadcast
    // 8. Return txHash
  }
}
```

### Hot Wallet Safety

| Constraint                | Enforcement                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Typed intents only**    | Port exposes `sendUsdcToTreasury` and `signTopUpTransaction` — no generic signing method.                                                                          |
| **Destination allowlist** | Treasury transfer goes to `dao_contract` from repo-spec. Top-up goes to Coinbase Transfers contract. No other destinations possible.                               |
| **Max per-tx**            | `OPERATOR_MAX_TOPUP_USD` env cap for top-ups. Port rejects any intent exceeding this.                                                                              |
| **Address in repo-spec**  | Operator wallet address is governance-in-git. Changing it requires a commit (auditable).                                                                           |
| **Key ≠ AI**              | The service process owns the signing key. The AI (OpenClaw, governance agents) submits intents through the workflow layer. The AI never loads or accesses the key. |
| **Simulate before sign**  | Every outbound transaction passes `simulateContract()` before signing.                                                                                             |

### repo-spec Configuration

```yaml
# .cogni/repo-spec.yaml additions

operator_wallet:
  address: "0x..." # checksummed, from generate-operator-wallet.ts output

payments_in:
  credits_topup:
    receiving_address: "0x..." # same as operator_wallet.address
```

The `receiving_address` update is the only change to the existing payment flow. The on-chain verifier, payment intent creation, and credit settlement all work as-is.

### Key Rotation

Key rotation creates a new wallet and decommissions the old one:

1. Generate new keypair (`scripts/generate-operator-wallet.ts`)
2. Update `operator_wallet.address` and `receiving_address` in `.cogni/repo-spec.yaml` (PR + governance approval)
3. Fund the new address (DAO governance proposal)
4. Deploy with new keystore + passphrase
5. Drain remaining funds from old address to new address or DAO treasury (manual, one-time)

## Goal

Provide a secure, narrow signing capability for the platform's outbound on-chain payments — wallet generated at DAO formation, loaded deterministically at runtime, accessible only through typed intent methods. The same wallet receives inbound user payments, unifying inbound and outbound flows.

## Non-Goals

- Custom smart contracts (PaymentRouter, etc.) — plain EOA is sufficient for P0
- Multi-wallet per service (single operator wallet for P0)
- Account abstraction / ERC-4337 (plain EOA for P0)
- HSM / Vault / KMS integration (encrypted keystore for P0; Vault is P1)
- AI-initiated signing (AI submits intents; service signs)
- Automated key rotation
- Atomic on-chain split (app handles split in two separate transactions)

## Invariants

| Rule                         | Constraint                                                                                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KEY_NEVER_LOGGED             | Private key and passphrase MUST NOT appear in logs, error messages, telemetry, or API responses.                                                                              |
| KEY_NEVER_IN_SOURCE          | Keystore file and passphrase MUST NOT be checked into source control.                                                                                                         |
| PASSPHRASE_FROM_SECRET_STORE | `OPERATOR_WALLET_PASSPHRASE` MUST be sourced from the deployment's secret store, not `.env` files.                                                                            |
| ADDRESS_VERIFIED_AT_STARTUP  | Derived address from keystore MUST match `operator_wallet.address` from `.cogni/repo-spec.yaml`. Mismatch → fail fast.                                                        |
| NO_GENERIC_SIGNING           | `WalletSignerPort` MUST NOT expose a generic `signTransaction(calldata)` method. Each tx type gets a named method.                                                            |
| DESTINATION_ALLOWLIST        | The signing adapter MUST reject any transaction where `to` is not in the hardcoded allowlist (USDC contract for treasury transfers, Coinbase Transfers contract for top-ups). |
| SIMULATE_BEFORE_SIGN         | Every transaction MUST pass `simulateContract()` before signing. Simulation failure → abort.                                                                                  |
| INTENT_ONLY_CALLERS          | Workflow and UI layers submit typed intents. They MUST NOT construct calldata or access key material.                                                                         |
| SINGLE_OPERATOR_WALLET       | Exactly one operator wallet per deployment. Address recorded in repo-spec (governance-in-git).                                                                                |
| RECEIVING_ADDRESS_MATCH      | `payments_in.credits_topup.receiving_address` MUST equal `operator_wallet.address`. Startup validation.                                                                       |

### Schema

No new tables for the wallet itself. Outbound transfer state is tracked in:

- `outbound_transfers` — DAO treasury USDC forwarding (new, see PR 2)
- `outbound_topups` — OpenRouter top-ups (new, see [web3-openrouter-payments spec](./web3-openrouter-payments.md))

### File Pointers

| File                                                    | Purpose                                                                          |
| ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `scripts/generate-operator-wallet.ts`                   | One-time keypair generation (new)                                                |
| `src/ports/wallet-signer.port.ts`                       | `WalletSignerPort` interface (new)                                               |
| `src/adapters/server/wallet/keystore-signer.adapter.ts` | P0 adapter: encrypted keystore + viem (new)                                      |
| `src/shared/config/repoSpec.server.ts`                  | `getOperatorWalletConfig()` from repo-spec                                       |
| `.cogni/repo-spec.yaml`                                 | `operator_wallet.address` + `receiving_address` (governance-in-git)              |
| `src/shared/env/server-env.ts`                          | `OPERATOR_KEYSTORE_PATH`, `OPERATOR_WALLET_PASSPHRASE`, `OPERATOR_MAX_TOPUP_USD` |

## Open Questions

- [ ] Should the keystore be loaded lazily (first signing call) or eagerly (startup)? Eager catches misconfig early but slows startup if wallet isn't needed.
- [ ] What is the right hot wallet balance target? Enough for N top-ups? Need operational data on typical purchase frequency.

## Related

- [Web3 → OpenRouter Top-Up](./web3-openrouter-payments.md) — Outbound top-up flow (payment math + state machine)
- [Payments Design](./payments-design.md) — Inbound USDC payment flow
- [DAO Enforcement](./dao-enforcement.md) — Governance-in-git rails
- [proj.ai-operator-wallet](../../work/projects/proj.ai-operator-wallet.md) — Project roadmap
