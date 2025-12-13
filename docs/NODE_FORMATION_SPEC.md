# Node Formation Design

> [!CRITICAL]
> Node Formation is Node-owned tooling. No Operator dependencies. Wallet signs in browser; server verifies before persisting.

## Core Invariants

1. **Minimal User Input (P0)**: Form collects only:
   - `tokenName` (string) - e.g., "Cogni Governance"
   - `tokenSymbol` (string) - e.g., "COGNI"
   - `initialHolder` (address) - single founder, receives 1e18 tokens

   User wallet signs 2 transactions: `createDao` + `deployCogniSignal`. Multi-holder deferred to P1.

2. **Aragon-Minted Token**: Use Aragon's GovernanceERC20 minted during DAO creation. No custom NonTransferableVotes deployment. Tokens are transferable (anti-vote-buying is NOT a P0 invariant).

3. **No Private Key Env Vars**: All transactions signed via wallet UI (wagmi/rainbowkit), never by script-loaded secrets.

4. **Server Verification Boundary**: Browser is untrusted. Server derives ALL addresses from tx receipts. Request contains only `{ chainId, daoTxHash, signalTxHash, initialHolder }`.

5. **Package Isolation**: `setup-core` cannot import `src/`, `services/`, or browser/node-specific APIs.

6. **Fork Freedom**: Formation tooling works standalone without Cogni Operator accounts.

→ Ancestor analysis: [DAO Formation Script](DAO_FORMATION_SCRIPT.md)

---

## P0 Implementation Details

### Technology Stack

| Layer                   | Choice                                              | Rationale                                               |
| ----------------------- | --------------------------------------------------- | ------------------------------------------------------- |
| **ABI Encoding**        | viem `encodeAbiParameters`                          | Direct control over TokenVoting struct encoding         |
| **Wallet Connection**   | wagmi + RainbowKit (existing)                       | Already configured in `src/shared/web3/wagmi.config.ts` |
| **Tx Signing**          | `useWriteContract` + `useWaitForTransactionReceipt` | Proven pattern in `usePaymentFlow.ts`                   |
| **State Machine**       | `useReducer`                                        | Proven pattern for multi-step async flows               |
| **Contract Deployment** | wagmi `useDeployContract`                           | For CogniSignal only (no custom token)                  |
| **Server Verification** | viem `getTransactionReceipt` + `decodeEventLog`     | Server derives addresses from receipt events            |

**Why NOT Aragon SDK?**

- Adds abstraction over single `DAOFactory.createDao()` call
- We need exact control over TokenVoting encoding (MintSettings with initial holder)
- viem encoding matches Foundry script 1:1 (easier to audit parity)

### Contract ABIs Required

```
src/shared/web3/aragon-abi.ts
├── DAOFactory.createDao (write)
├── DAOFactory.pluginSetupProcessor (read)
├── TokenVoting.getVotingToken (read)
├── GovernanceERC20.balanceOf (read) - for verification
└── CogniSignal (full ABI for deployment)
```

**Source:** Extract minimal ABIs from OSx v1.4.0 contracts or Foundry artifacts.

### Contract Bytecode Source

For `useDeployContract`, we need bytecode for:

- `CogniSignal` only - from `cogni-gov-contracts` Foundry artifacts

**Decision:** Extract bytecode from `cogni-gov-contracts/out/CogniSignal.sol/CogniSignal.json` into `src/shared/web3/bytecode.ts`. No custom token bytecode needed (Aragon mints GovernanceERC20).

### Hook Architecture

```
src/features/setup/hooks/
├── useDAOFormation.ts        # Main orchestrator (like usePaymentFlow)
└── useAragonPreflight.ts     # getCode + PSP validation
```

**State Machine Phases (simplified - 2 wallet txs):**

```typescript
type FormationPhase =
  | { phase: "IDLE" }
  | { phase: "PREFLIGHT" }
  | { phase: "CREATING_DAO"; txHash?: string } // DAOFactory.createDao
  | { phase: "DEPLOYING_SIGNAL"; txHash?: string } // CogniSignal(dao)
  | { phase: "VERIFYING" } // Server verification
  | { phase: "SUCCESS"; addresses: VerifiedAddresses }
  | { phase: "ERROR"; message: string; recoverable: boolean };
```

### Page Structure

```
src/app/setup/dao/
├── page.tsx                  # Main wizard page
├── _components/
│   ├── FormationWizard.tsx   # Multi-step form container
│   ├── ConfigStep.tsx        # Token name, symbol, initial holders
│   ├── PreflightStep.tsx     # Chain validation + OSx check
│   ├── DeployStep.tsx        # Transaction signing UI
│   ├── VerifyStep.tsx        # Server verification status
│   └── SuccessStep.tsx       # Download addresses + repo-spec
└── _hooks/
    └── useDAOFormation.ts    # Orchestrator hook
```

### Server Verification Endpoint

```
POST /api/setup/verify
Request:
{
  chainId: number,          // Must be in SUPPORTED_CHAIN_IDS
  daoTxHash: string,        // DAOFactory.createDao tx
  signalTxHash: string,     // CogniSignal deployment tx
  initialHolder: string     // Expected token recipient
}

Response (success):
{
  verified: true,
  addresses: {
    dao: "0x...",           // Derived from daoTxHash receipt
    token: "0x...",         // Derived from TokenVoting.getVotingToken()
    plugin: "0x...",        // Derived from daoTxHash receipt
    signal: "0x..."         // Derived from signalTxHash receipt
  },
  repoSpecYaml: string      // Ready to write to .cogni/repo-spec.yaml
}

Response (failure):
{
  verified: false,
  errors: string[]
}
```

**Server derives addresses from receipts (never trusts client):**

1. Decode `daoTxHash` receipt → extract DAO address from event logs
2. Decode `daoTxHash` receipt → extract plugin address from event logs
3. Call `TokenVoting(plugin).getVotingToken()` → token address
4. Decode `signalTxHash` receipt → extract deployed CogniSignal address

**Server verifies:**

1. `chainId in SUPPORTED_CHAIN_IDS`
2. Both txHashes exist and succeeded
3. `GovernanceERC20(token).balanceOf(initialHolder) == 1e18`
4. `CogniSignal(signal).DAO() == dao`

### viem Encoding (TokenVoting Setup with Mint)

```typescript
// packages/setup-core/src/encoding.ts
import { encodeAbiParameters, parseAbiParameters } from "viem";

export function encodeTokenVotingSetup(params: {
  tokenName: string;
  tokenSymbol: string;
  initialHolder: `0x${string}`;
}): `0x${string}` {
  // TokenSettings.addr = 0x0 tells Aragon to deploy new GovernanceERC20
  const DEPLOY_NEW_TOKEN = "0x0000000000000000000000000000000000000000";

  // Exact struct encoding - MUST match OSx v1.4.0 ABI
  // TODO: Verify exact fields from OSx contracts (MintSettings may have additional fields)
  return encodeAbiParameters(
    parseAbiParameters([
      // 1. VotingSettings
      "(uint8 votingMode, uint32 supportThreshold, uint32 minParticipation, uint64 minDuration, uint256 minProposerVotingPower)",
      // 2. TokenSettings (addr=0x0 to deploy new token)
      "(address addr, string name, string symbol)",
      // 3. MintSettings (initial holder + amount)
      "(address[] receivers, uint256[] amounts)",
      // 4. TargetConfig
      "(address target, uint8 operation)",
      // 5. minApprovals
      "uint256",
      // 6. pluginMetadata
      "bytes",
      // 7. excludedAccounts
      "address[]",
    ]),
    [
      // VotingSettings
      {
        votingMode: 1,
        supportThreshold: 500_000,
        minParticipation: 500_000,
        minDuration: 3600n,
        minProposerVotingPower: 10n ** 18n,
      },
      // TokenSettings (deploy new GovernanceERC20)
      {
        addr: DEPLOY_NEW_TOKEN,
        name: params.tokenName,
        symbol: params.tokenSymbol,
      },
      // MintSettings (mint 1e18 to initial holder)
      { receivers: [params.initialHolder], amounts: [10n ** 18n] },
      // TargetConfig (zero = plugin sets to DAO)
      { target: "0x0000000000000000000000000000000000000000", operation: 0 },
      // minApprovals
      0n,
      // pluginMetadata
      "0x",
      // excludedAccounts
      [],
    ]
  );
}
```

**Critical:** Verify exact MintSettings struct from OSx v1.4.0 ABI before implementation. Some versions include `ensureDelegationOnMint` field.

---

## Implementation Checklist

### P0: Web DAO Formation (MVP)

- [ ] Create `packages/setup-core/` with encoding + address constants
- [ ] Verify TokenVoting MintSettings struct against OSx v1.4.0 ABI
- [ ] Add Foundry-vs-viem encoding parity test fixture
- [ ] Implement Aragon OSx preflight (getCode + factory→PSP invariant)
- [ ] Implement `DAOFactory.createDao` call with TokenVoting + MintSettings
- [ ] Implement `CogniSignal(dao)` deployment
- [ ] Server endpoint: derive addresses from receipt events (pin exact event signatures)
- [ ] Server endpoint: verify balanceOf + CogniSignal.DAO()
- [ ] Export repo-spec YAML with `chain_id` as string

#### Chores

- [ ] Observability instrumentation [observability.md](../.agent/workflows/observability.md)
- [ ] Documentation updates [document.md](../.agent/workflows/document.md)

### P1: Multi-Holder + CLI Setup Tools

- [ ] Multi-holder support (multiple initial token recipients)
- [ ] Create `packages/setup-cli/` with Node adapters (fs, shell, gh, tofu)
- [ ] Implement `pnpm setup local` for contributor workflow
- [ ] Implement `pnpm setup infra --env preview|production`
- [ ] Implement `pnpm setup github --env preview|production`
- [ ] Add WalletConnect adapter (CLI wallet signing if proven needed)

### P2: Full npx End-to-End (Deferred)

- [ ] Evaluate after P1 adoption
- [ ] npx-based repo clone + init + DAO formation flow
- [ ] **Do NOT build preemptively**

---

## File Pointers (P0 Scope)

| File                                                        | Change                                                   |
| ----------------------------------------------------------- | -------------------------------------------------------- |
| `packages/setup-core/src/aragon.ts`                         | OSx address constants (chainId → addresses)              |
| `packages/setup-core/src/encoding.ts`                       | TokenVoting struct encoding (viem)                       |
| `packages/setup-core/src/__tests__/encoding.parity.test.ts` | Foundry-vs-viem parity test                              |
| `src/shared/web3/aragon-abi.ts`                             | Minimal ABIs: DAOFactory, TokenVoting, GovernanceERC20   |
| `src/shared/web3/bytecode.ts`                               | CogniSignal bytecode constant                            |
| `src/features/setup/hooks/useDAOFormation.ts`               | Main orchestrator hook (2-tx state machine)              |
| `src/app/setup/dao/page.tsx`                                | Wizard page (config → createDao → deploySignal → verify) |
| `src/app/api/setup/verify/route.ts`                         | Server derives addresses from receipts, verifies state   |
| `src/contracts/setup.contract.ts`                           | Zod schemas for verify request/response                  |

---

## Schema

**User Input (P0 form - 3 fields):**

- `tokenName` (string, required) - e.g., "Cogni Governance"
- `tokenSymbol` (string, required) - e.g., "COGNI"
- `initialHolder` (address, required) - Single founder, receives 1e18 tokens

**Derived (not user input):**

- `chainId` - From connected wallet (must be in `SUPPORTED_CHAIN_IDS`)

**Verify Request (to server):**

- `chainId`, `daoTxHash`, `signalTxHash`, `initialHolder`
- No addresses - server derives all from receipts

**Verify Response (from server):**

- `addresses.dao`, `addresses.token`, `addresses.plugin`, `addresses.signal`
- `repoSpecYaml` - Ready to write, `chain_id` as string per existing schema

**Forbidden:**

- `privateKey`, `mnemonic`, `seed`
- Client-provided addresses (server derives from receipts)

---

## Design Decisions

### 1. Aragon OSx Address Mapping

Hardcoded per chainId. Server enforces `chainId in SUPPORTED_CHAIN_IDS` before any verification.

→ See: [Appendix: Aragon OSx Addresses](#appendix-aragon-osx-addresses)

**Rule:** Addresses are hardcoded constants (not user-provided). Preflight validates getCode + factory→PSP invariant.

---

### 2. Formation Transaction Flow (2 Wallet Txs)

```
┌─────────────────────────────────────────────────────────────────────┐
│ PREFLIGHT (client-side, blocking)                                   │
│ ─────────────────────────────────                                   │
│ 1. Wallet connects, chainId validated against SUPPORTED_CHAIN_IDS   │
│ 2. eth_getCode for DAOFactory, PSP, TokenVotingRepo                 │
│ 3. DAOFactory.pluginSetupProcessor() == PSP                         │
│ 4. Result: PROCEED or ABORT                                         │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (if preflight passed)
┌─────────────────────────────────────────────────────────────────────┐
│ TX 1: CREATE DAO (wallet-signed)                                    │
│ ────────────────────────────────                                    │
│ - DAOFactory.createDao(daoSettings, pluginSettings)                 │
│ - TokenVoting plugin + GovernanceERC20 deployed by Aragon           │
│ - MintSettings mints 1e18 to initialHolder                          │
│ - Capture daoTxHash                                                 │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ TX 2: DEPLOY SIGNAL (wallet-signed)                                 │
│ ───────────────────────────────────                                 │
│ - Deploy CogniSignal(daoAddress)                                    │
│ - daoAddress derived client-side from TX 1 receipt                  │
│ - Capture signalTxHash                                              │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ SERVER VERIFICATION (server-side)                                   │
│ ─────────────────────────────────                                   │
│ - POST { chainId, daoTxHash, signalTxHash, initialHolder }          │
│ - Server derives ALL addresses from receipts (never trusts client)  │
│ - Server verifies balanceOf + CogniSignal.DAO()                     │
│ - Returns addresses + repo-spec YAML                                │
└─────────────────────────────────────────────────────────────────────┘
```

**Why 2 txs?** Aragon mints GovernanceERC20 in createDao. No custom token deployment needed.

---

### 3. TokenVoting Configuration (Exact Parity)

| Setting                | Value          | Meaning                                  |
| ---------------------- | -------------- | ---------------------------------------- |
| Mode                   | EarlyExecution | Proposals can execute once threshold met |
| supportThreshold       | 500_000        | 50% (1e6 precision)                      |
| minParticipation       | 500_000        | 50% (1e6 precision)                      |
| minDuration            | 3600           | 1 hour minimum voting                    |
| minProposerVotingPower | 1e18           | 1 token to propose                       |

**Never** deviate from these values in P0 without explicit governance decision.

---

### 4. Server-Side Address Derivation (Security Boundary)

**Critical:** Server MUST derive `daoAddress` and `pluginAddress` from tx receipt logs. Never trust client-provided addresses.

```typescript
// Server derives addresses from DAOFactory.createDao receipt
async function deriveAddressesFromReceipt(
  chainId: SupportedChainId,
  daoTxHash: `0x${string}`
): Promise<{ daoAddress: `0x${string}`; pluginAddress: `0x${string}` }> {
  const receipt = await publicClient.getTransactionReceipt({ hash: daoTxHash });

  // TODO: Pin exact event signatures from OSx v1.4.0 ABI
  // Do NOT assume event names - verify from:
  // - https://github.com/aragon/osx/tree/v1.4.0/packages/contracts/src
  // - DAORegistry emits event when DAO registered
  // - PluginSetupProcessor emits event when plugin installed
}
```

**Server verification flow:**

1. Enforce `chainId in SUPPORTED_CHAIN_IDS`
2. Re-verify OSx addresses have code using server's RPC (not client's)
3. Derive daoAddress + pluginAddress from receipt logs (exact event signatures TBD)
4. Use derived addresses for all subsequent state checks

**Before implementation:** Audit OSx v1.4.0 contracts to pin exact event signatures for DAO creation and plugin installation.

→ Reference implementation: [cogni-signal-evm-contracts](https://github.com/Cogni-DAO/cogni-signal-evm-contracts)

---

### 5. Encoding Parity Test

TokenVoting setup encoding must match Foundry exactly. Add a parity test:

```typescript
// packages/setup-core/src/__tests__/encoding.parity.test.ts
import { encodeTokenVotingSetup } from "../encoding";
import { FOUNDRY_EXPECTED_BYTES } from "./fixtures/foundry-output.json";

test("viem encoding matches Foundry output", () => {
  const viemEncoded = encodeTokenVotingSetup({
    tokenAddress: "0x...",
    tokenName: "Test",
    tokenSymbol: "TST",
  });
  expect(viemEncoded).toBe(FOUNDRY_EXPECTED_BYTES);
});
```

**Why:** The 7-param struct includes nested tuples. Any field mismatch (e.g., `MintSettings.ensureDelegationOnMint`) causes silent failure.

**Fixture generation:** Run Foundry script with known inputs, capture encoded bytes, commit as test fixture.

---

### 6. Import Boundary Enforcement

**Allowed:**

- `src/app/setup/*` → `packages/setup-core`
- `packages/setup-cli` → `packages/setup-core`

**Forbidden:**

- `packages/setup-core` → `src/*`, `services/*`, `node:fs`, `window`
- `packages/setup-cli` → `src/*`, `services/*`

**Why:** Enables future repo split. setup-core is pure; runners inject adapters.

---

### 8. Repo-Spec Output

Formation wizard populates existing `.cogni/repo-spec.yaml` fields. No new schema fields for MVP.

**Fields populated by formation:**

```yaml
# Existing schema (schema_version: "0.1.4")
cogni_dao:
  dao_contract: "0x..." # ← server-derived from daoTxHash receipt
  plugin_contract: "0x..." # ← server-derived from daoTxHash receipt
  signal_contract: "0x..." # ← server-derived from signalTxHash receipt
  chain_id: "8453" # ← STRING, not number (matches existing schema)
```

**Invariants:**

- Server derives addresses from receipts, not client input
- `chain_id` is a string (e.g., `"8453"` not `8453`) per existing schema
- Canonical path: `.cogni/repo-spec.yaml` (not `.yml`)

→ Current schema: [.cogni/repo-spec.yaml](../.cogni/repo-spec.yaml)

---

## Explicit Non-Goals (P0)

| Item                                | Reason                                   |
| ----------------------------------- | ---------------------------------------- |
| Multiple initial holders            | P1 scope (reduces P0 to 2 wallet txs)    |
| Custom NonTransferableVotes token   | Aragon GovernanceERC20 sufficient for P0 |
| Anti-vote-buying (non-transferable) | Not a P0 invariant; revisit if needed    |
| Terraform provisioning              | CLI scope (P1)                           |
| GitHub secrets automation           | CLI scope (P1)                           |
| Repo clone/patch/write              | CLI scope (P1)                           |
| CLI wallet signing                  | Web is simpler; add if proven needed     |
| Contract verification (Etherscan)   | Nice-to-have, not blocking               |

---

## Related Docs

| Doc                                                       | Purpose                                |
| --------------------------------------------------------- | -------------------------------------- |
| [DAO Formation Script](DAO_FORMATION_SCRIPT.md)           | Ancestor: detailed Aragon OSx analysis |
| [Node vs Operator Contract](NODE_VS_OPERATOR_CONTRACT.md) | Formation is Node-owned                |
| [MVP Deliverables](MVP_DELIVERABLES.md)                   | Scope lock                             |
| [ROADMAP](../ROADMAP.md)                                  | Phase overview                         |

---

## Appendix: Aragon OSx Addresses

Hardcoded addresses from [cogni-signal-evm-contracts](https://github.com/Cogni-DAO/cogni-signal-evm-contracts).

```typescript
// packages/setup-core/src/aragon.ts
export const ARAGON_OSX_ADDRESSES = {
  // Base Mainnet (8453) - v1.4.0
  8453: {
    daoFactory: "0xcc602EA573a42eBeC290f33F49D4A87177ebB8d2",
    pluginSetupProcessor: "0x91a851E9Ed7F2c6d41b15F76e4a88f5A37067cC9",
    tokenVotingRepo: "0x2532570DcFb749A7F976136CC05648ef2a0f60b0",
    adminPluginRepo: "0x212eF339C77B3390599caB4D46222D79fAabcb5c",
  },
  // Base Sepolia (84532) - v1.4.0
  84532: {
    daoFactory: "0x016CBa9bd729C30b16849b2c52744447767E9dab",
    pluginSetupProcessor: "0xd97D409Ca645b108468c26d8506f3a4Bf9D0BE81",
    tokenVotingRepo: "0xdEbcF8779495a62156c6d1416628F60525984e9d",
    adminPluginRepo: "0x685FAE22Ad532ab642eBb85ae1517BC4F8db6804",
  },
  // Sepolia (11155111)
  11155111: {
    daoFactory: "0xB815791c233807D39b7430127975244B36C19C8e",
    pluginSetupProcessor: "0xC24188a73dc09aA7C721f96Ad8857B469C01dC9f",
    tokenVotingRepo: "0x424F4cA6FA9c24C03f2396DF0E96057eD11CF7dF",
    adminPluginRepo: "0x152c9E28995E418870b85cbbc0AEE4e53020edb2",
  },
} as const;

export const SUPPORTED_CHAIN_IDS = [8453, 84532, 11155111] as const;
export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

export function getAragonAddresses(chainId: number) {
  if (!(chainId in ARAGON_OSX_ADDRESSES)) {
    throw new Error(`Unsupported chainId: ${chainId}`);
  }
  return ARAGON_OSX_ADDRESSES[chainId as SupportedChainId];
}
```

---

**Last Updated**: 2025-12-13
**Status**: Draft
