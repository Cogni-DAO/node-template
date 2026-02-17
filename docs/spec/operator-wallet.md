---
id: operator-wallet
type: spec
title: "Operator Wallet: Lifecycle, Signing & Access Control"
status: draft
spec_state: draft
trust: draft
summary: Server-side operator wallet for autonomous on-chain payments — deterministic keystore-based signing, intent-only API surface for workflows and UI, hot wallet safety constraints.
read_when: Working on wallet generation, WalletSignerPort, operator key management, or UI-triggered on-chain actions.
implements: proj.ai-operator-wallet
owner: derekg1729
created: 2026-02-17
verified:
tags: [web3, wallet, security]
---

# Operator Wallet: Lifecycle, Signing & Access Control

> A server-side wallet the platform uses to sign on-chain transactions — workflows submit intents, the signing port executes them, and the UI can trigger actions without ever touching key material.

### Key References

|              |                                                                           |                                         |
| ------------ | ------------------------------------------------------------------------- | --------------------------------------- |
| **Project**  | [proj.ai-operator-wallet](../../work/projects/proj.ai-operator-wallet.md) | Roadmap and planning                    |
| **Research** | [AI Operator Wallet](../research/ai-operator-wallet-budgeted-spending.md) | Custody options evaluation              |
| **Spec**     | [Web3 → OpenRouter Top-Up](./web3-openrouter-payments.md)                 | First consumer of this wallet           |
| **Spec**     | [DAO Enforcement](./dao-enforcement.md)                                   | Chain + address governance in repo-spec |

## Design

### Architecture: Three Access Layers

```
┌─────────────────────────────────────────────────────────┐
│                     UI (browser)                         │
│  Can: submit top-up request via API                      │
│  Cannot: see key material, sign directly, choose dest    │
└────────────────────┬────────────────────────────────────┘
                     │ POST /api/v1/operator/topup {amount}
                     ▼
┌─────────────────────────────────────────────────────────┐
│                  Workflow Layer                           │
│  Can: call WalletSignerPort with typed intents           │
│  Cannot: access raw key, construct arbitrary calldata    │
│  Validates: intent params, amount caps, circuit breaker  │
└────────────────────┬────────────────────────────────────┘
                     │ signTopUpTransaction(intent)
                     ▼
┌─────────────────────────────────────────────────────────┐
│              WalletSignerPort (signing layer)             │
│  Can: load keystore, sign whitelisted tx types            │
│  Cannot: be called with arbitrary calldata                │
│  Validates: contract allowlist, sender match, simulation  │
└────────────────────┬────────────────────────────────────┘
                     │ broadcast
                     ▼
                  Base (8453)
```

The key principle: **callers submit intents, the signing port controls execution.** No layer above the signing port ever sees the private key or constructs raw transaction bytes.

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
  3. Add address to .cogni/repo-spec.yaml as operator_wallet
  4. Fund the address with a small ETH balance on Base via DAO governance proposal
```

The script is idempotent in the sense that running it again produces a _new_ keypair (not the same one). There is exactly one operator wallet per deployment. Key rotation means generating a new wallet and updating repo-spec via governance.

### Keystore Loading (Runtime)

The wallet is loaded once at application startup and cached in memory for the process lifetime.

```typescript
// Env vars
OPERATOR_KEYSTORE_PATH     // absolute path to keystore JSON file
OPERATOR_WALLET_PASSPHRASE // scrypt passphrase — from deploy secret store only

// Loading flow (startup)
1. Read keystore JSON from OPERATOR_KEYSTORE_PATH
2. Decrypt with OPERATOR_WALLET_PASSPHRASE → in-memory ethers.Wallet
3. Verify derived address matches operator_wallet from repo-spec
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

Future transaction types (e.g., ERC-20 approve, DAO proposal execution) get their own named methods on the port — never a generic `signTransaction(calldata)`.

### P0 Adapter: Encrypted Keystore

```typescript
// src/adapters/server/wallet/keystore-signer.adapter.ts

class KeystoreSignerAdapter implements WalletSignerPort {
  private wallet: ethers.Wallet; // loaded at construction
  private publicClient: PublicClient; // viem client for simulation + broadcast
  private operatorAddress: string; // from repo-spec, verified against keystore

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

| Constraint               | Enforcement                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Small balance**        | Operator wallet holds only enough ETH for near-term top-ups. DAO governance refills.                                                                               |
| **Max per-tx**           | `OPERATOR_MAX_TOPUP_USD` env cap. Port rejects any intent exceeding this.                                                                                          |
| **No drain path**        | Port only signs `swapAndTransferUniswapV3Native` to the allowlisted contract. No transfers to arbitrary addresses.                                                 |
| **Address in repo-spec** | Operator wallet address is governance-in-git. Changing it requires a commit (auditable).                                                                           |
| **Key ≠ AI**             | The service process owns the signing key. The AI (OpenClaw, governance agents) submits intents through the workflow layer. The AI never loads or accesses the key. |

### UI Access (Future)

The UI triggers top-ups without key access:

```
Browser → POST /api/v1/operator/topup { amountUsd }
  → Server: SIWE session auth (admin-only or DAO-governed)
  → Server: validate amount ≤ OPERATOR_MAX_TOPUP_USD
  → Server: create outbound_topups row (CHARGE_PENDING)
  → Server: dispatch top-up workflow
  → Response: { topupId, status: "CHARGE_PENDING" }

Browser → GET /api/v1/operator/topup/:id
  → Response: { status, txHash?, chargeId?, error? }
```

The UI can poll status but never signs or sees key material. Authorization for who can trigger top-ups is handled by session roles — initially admin-only, later DAO-governed.

### Key Rotation

Key rotation creates a new wallet and decommissions the old one:

1. Generate new keypair (`scripts/generate-operator-wallet.ts`)
2. Update `operator_wallet` in `.cogni/repo-spec.yaml` (PR + governance approval)
3. Fund the new address (DAO governance proposal)
4. Deploy with new keystore + passphrase
5. Drain remaining ETH from old address to DAO treasury (manual, one-time)

There is no automatic rotation. Rotation is a governance event triggered by: suspected compromise, periodic security policy, or infrastructure migration.

## Goal

Provide a secure, narrow signing capability for the platform's on-chain payments — wallet generated at DAO formation, loaded deterministically at runtime, accessible only through typed intent methods, and eventually triggerable from the UI without exposing key material.

## Non-Goals

- Multi-wallet per service (single operator wallet for P0)
- Account abstraction / ERC-4337 (plain EOA for P0)
- HSM / Vault / KMS integration (encrypted keystore for P0; Vault is P1)
- AI-initiated signing (AI submits intents; service signs)
- Automated key rotation
- USDC spending (ETH only for P0 — OpenRouter accepts native ETH on Base)

## Invariants

| Rule                         | Constraint                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| KEY_NEVER_LOGGED             | Private key and passphrase MUST NOT appear in logs, error messages, telemetry, or API responses.                   |
| KEY_NEVER_IN_SOURCE          | Keystore file and passphrase MUST NOT be checked into source control.                                              |
| PASSPHRASE_FROM_SECRET_STORE | `OPERATOR_WALLET_PASSPHRASE` MUST be sourced from the deployment's secret store, not `.env` files.                 |
| ADDRESS_VERIFIED_AT_STARTUP  | Derived address from keystore MUST match `operator_wallet` from `.cogni/repo-spec.yaml`. Mismatch → fail fast.     |
| NO_GENERIC_SIGNING           | `WalletSignerPort` MUST NOT expose a generic `signTransaction(calldata)` method. Each tx type gets a named method. |
| CONTRACT_ALLOWLIST           | The signing adapter MUST reject any transaction where `to` is not in the hardcoded contract allowlist.             |
| SIMULATE_BEFORE_SIGN         | Every transaction MUST pass `simulateContract()` before signing. Simulation failure → abort.                       |
| INTENT_ONLY_CALLERS          | Workflow and UI layers submit typed intents. They MUST NOT construct calldata or access key material.              |
| SINGLE_OPERATOR_WALLET       | Exactly one operator wallet per deployment. Address recorded in repo-spec (governance-in-git).                     |

### Schema

No new tables for the wallet itself. The `outbound_topups` table (see [web3-openrouter-payments spec](./web3-openrouter-payments.md)) tracks transaction state. The wallet is stateless infrastructure — a key and a signing function.

**repo-spec.yaml addition:**

```yaml
operator_wallet:
  address: "0x..." # checksummed, from generate-operator-wallet.ts output
  chain_id: 8453 # must match cogni_dao.chain_id
```

### File Pointers

| File                                                    | Purpose                                                                          |
| ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `scripts/generate-operator-wallet.ts`                   | One-time keypair generation (new)                                                |
| `src/ports/wallet-signer.port.ts`                       | `WalletSignerPort` interface (new)                                               |
| `src/adapters/server/wallet/keystore-signer.adapter.ts` | P0 adapter: encrypted keystore + viem (new)                                      |
| `src/shared/web3/coinbase-transfers.ts`                 | Contract ABI, address, tx encoding (new)                                         |
| `src/shared/config/repoSpec.server.ts`                  | `getOperatorWalletConfig()` from repo-spec                                       |
| `.cogni/repo-spec.yaml`                                 | `operator_wallet.address` (governance-in-git)                                    |
| `src/shared/env/server-env.ts`                          | `OPERATOR_KEYSTORE_PATH`, `OPERATOR_WALLET_PASSPHRASE`, `OPERATOR_MAX_TOPUP_USD` |

## Open Questions

- [ ] Should `operator_wallet.address` live in `.cogni/repo-spec.yaml` (governance-in-git, consistent with `receiving_address`) or remain env-only for P0?
- [ ] What is the right hot wallet balance target? Enough for N top-ups? Need operational data on typical purchase frequency.
- [ ] Should the UI top-up endpoint be admin-only (RBAC) or require a DAO vote? For P0 admin-only seems sufficient.
- [ ] Should the keystore be loaded lazily (first signing call) or eagerly (startup)? Eager catches misconfig early but slows startup.

## Related

- [Web3 → OpenRouter Top-Up](./web3-openrouter-payments.md) — First consumer (payment math + state machine)
- [Payments Design](./payments-design.md) — Inbound USDC payment flow
- [DAO Enforcement](./dao-enforcement.md) — Governance-in-git rails
- [proj.ai-operator-wallet](../../work/projects/proj.ai-operator-wallet.md) — Project roadmap
