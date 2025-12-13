# Aragon DAO setup (current critical path) + Typescript drop-in parity plan

This document has two primary sections:

1. **Exactly what the current `make dao-setup` deployment does** for the Aragon OSx happy path (critical path + a precise component graph).
2. **How to achieve parity with a Typescript script** that performs the same Aragon OSx happy path **without any private key env var**, by having the person running the script **sign transactions in their wallet**.

---

## 1) Current critical path: what `make dao-setup` does (Aragon OSx happy path)

This exists in https://github.com/Cogni-DAO/cogni-signal-evm-contracts, or locally: /Users/derek/dev/cogni-gov-contracts/AGENTS.md

### 1.1 Entry point: Makefile

`make dao-setup` currently:

- Validates env vars exist:
  - `WALLET_PRIVATE_KEY`
  - `EVM_RPC_URL`
  - `ETHERSCAN_API_KEY`
  - `TOKEN_INITIAL_HOLDER`
- Runs Foundry:
  - `forge script script/SetupDevChain.s.sol:SetupDevChain --rpc-url $EVM_RPC_URL --broadcast --verify`

Note: `ETHERSCAN_API_KEY` is required here because `--verify` is enabled; it does not affect the on-chain governance wiring itself (it’s for contract verification on explorers).

The important consequence for “critical path parity”: **deployment is a single EOA broadcast flow**, not multisig, not relayed, and the deployer EOA is expected to have sufficient ETH.

### 1.2 `SetupDevChain.s.sol`: orchestration steps and invariants

At a high level, the script deploys:

1. Governance stack (via provider): **NonTransferableVotes → Aragon OSx DAO → TokenVoting plugin**
2. **CogniSignal** bound to the DAO (constructor arg)
3. **FaucetMinter** bound to the DAO and token (deployed but _unauthorized_)

Critical path (in order):

1. **Fork + config**
   - `vm.createSelectFork(EVM_RPC_URL)`
   - Reads deployer from `WALLET_PRIVATE_KEY`.
   - Reads:
     - `GOV_PROVIDER` (default `aragon-osx`)
     - `TOKEN_NAME`, `TOKEN_SYMBOL`, `TOKEN_SUPPLY` (note: **tokenSupply is not actually used in Aragon provider**)
     - `TOKEN_INITIAL_HOLDER`

2. **Create provider + deploy governance**
   - `GovProviderFactory.createProvider(ARAGON)` → new `AragonOSxProvider()`
   - Builds `IGovProvider.GovConfig` and calls `deployGovernance()`.
   - Provider-specific config for Aragon is constructed from chain id and hardcoded known OSx addresses:
     - `DAOFactory`
     - `PluginSetupProcessor`
     - `TokenVotingRepo`

3. **Deploy CogniSignal**
   - `new CogniSignal(govResult.daoAddress)`
   - Invariant: `CogniSignal.DAO` must equal the created DAO.

4. **Deploy FaucetMinter (unauthorized initially)**
   - `new FaucetMinter(dao, token, amountPerClaim, globalCap)`
   - Invariant: does not change governance wiring, but **is part of what `make dao-setup` currently does**.

5. **Write output**
   - Writes `.env.<TOKEN_SYMBOL>` containing addresses.
   - **Also writes `WALLET_PRIVATE_KEY=<…>` into that file**, which is exactly what the TS plan must remove.

### 1.3 `AragonOSxProvider.sol`: exact Aragon OSx creation path

The Aragon happy path is entirely driven by **a single call to** `DAOFactory.createDao(DAOSettings, PluginSettings[])` with exactly **one plugin**: TokenVoting.

#### A) External OSx components used (must exist on the network)

The provider is passed three on-chain OSx addresses (per chain) and validates each has deployed code:

- `DAOFactory` (Aragon OSx framework)
- `PluginSetupProcessor` (Aragon OSx framework)
- `TokenVotingRepo` (Aragon TokenVoting plugin repo)

**Exact address mapping currently used by this repo (hardcoded by chainId):**

| Network      |  chainId | DAOFactory                                   | PluginSetupProcessor                         | TokenVotingRepo                              |
| ------------ | -------: | -------------------------------------------- | -------------------------------------------- | -------------------------------------------- |
| Sepolia      | 11155111 | `0xB815791c233807D39b7430127975244B36C19C8e` | `0xC24188a73dc09aA7C721f96Ad8857B469C01dC9f` | `0x424F4cA6FA9c24C03f2396DF0E96057eD11CF7dF` |
| Base Mainnet |     8453 | `0xcc602EA573a42eBeC290f33F49D4A87177ebB8d2` | `0x91a851E9Ed7F2c6d41b15F76e4a88f5A37067cC9` | `0x2532570DcFb749A7F976136CC05648ef2a0f60b0` |
| Base Sepolia |    84532 | `0x016CBa9bd729C30b16849b2c52744447767E9dab` | `0xd97D409Ca645b108468c26d8506f3a4Bf9D0BE81` | `0xdEbcF8779495a62156c6d1416628F60525984e9d` |

It also checks an invariant:

- `DAOFactory(daoFactory).pluginSetupProcessor() == psp`

This matters because it guarantees `DAOFactory.createDao()` will use the expected PSP.

#### B) Governance token: `NonTransferableVotes`

The provider **deploys a custom token** and uses it as the TokenVoting voting token:

- Deploy: `new NonTransferableVotes(tokenName, tokenSymbol)`
- Mint exactly **one unit** (`1e18`) to `TOKEN_INITIAL_HOLDER`
- Later: `customToken.transferOwnership(dao)`

Important invariants from `NonTransferableVotes`:

- **No user-to-user transfers** (only mint/burn are allowed)
- `mint(to, amount)` only allows:
  - caller = `owner()` or an authorized minter
  - `amount` must be **exactly** `1e18`
  - each address can only receive once (`balanceOf(to) == 0`)
  - auto-delegates on mint (`_delegate(to, to)`)

So the “token supply” concept is effectively “membership count” (1 token per member), not `TOKEN_SUPPLY`.

#### C) TokenVoting plugin configuration

The provider uses these exact TokenVoting voting settings:

- **Mode**: `EarlyExecution`
- **supportThreshold**: `500_000` (50% in 1e6 precision)
- **minParticipation**: `500_000` (50% in 1e6 precision)
- **minDuration**: `3600` seconds
- **minProposerVotingPower**: `1e18` (1 token)

The provider then encodes TokenVoting setup data **with exactly 7 parameters** (this is critical for TS parity):

1. `MajorityVotingBase.VotingSettings votingSettings`
2. `TokenVotingSetup.TokenSettings tokenSettings` where `addr = <NonTransferableVotes address>`
3. `GovernanceERC20.MintSettings mintSettings` (explicitly empty to avoid plugin-side minting)
4. `IPlugin.TargetConfig targetConfig` (target left `0x0`; plugin sets it to DAO)
5. `uint256 minApprovals` (0)
6. `bytes pluginMetadata` (empty)
7. `address[] excludedAccounts` (empty)

#### D) DAO creation: the single critical call

The DAO is created by calling:

- `DAOFactory.createDao(DAOSettings daoSettings, PluginSettings[] pluginSettings)`

with:

- `daoSettings`:
  - `trustedForwarder = address(0)`
  - `daoURI = ""`
  - `subdomain = ""`
  - `metadata = abi.encode(string("CogniSignal DAO - <tokenName>"))`
- `pluginSettings[0].pluginSetupRef`:
  - `versionTag.release = 1`
  - `versionTag.build = 3`
  - `pluginSetupRepo = TokenVotingRepo`
- `pluginSettings[0].data = tokenVotingData` (the 7-tuple encoded above)

The return value includes:

- `createdDao`
- `installedPlugins[]`

The provider uses:

- `tokenVotingPlugin = installedPlugins[0].plugin`
- `governanceToken = TokenVoting(tokenVotingPlugin).getVotingToken()`

Finally:

- `customToken.transferOwnership(createdDao)`

### 1.4 Precise OSx component graph (what exists + how it is connected)

Below is the **critical-path graph** of components and their on-chain wiring for the Aragon OSx happy path.

```mermaid
flowchart LR
  %% Actors
  EOA[Deployer EOA
(broadcast signer)]

  %% Aragon OSx predeployed components
  DF[Aragon OSx
DAOFactory]
  PSP[Aragon OSx
PluginSetupProcessor]
  TVR[Aragon
TokenVotingRepo
(PluginRepo)]

  %% Installed / created per run
  DAO[Created Aragon DAO]
  TVS[TokenVotingSetup
(implementation resolved via repo+tag)]
  TV[TokenVoting Plugin
(instance installed into DAO)]
  GOV[NonTransferableVotes
(custom ERC20Votes token)]
  CS[CogniSignal
(DAO-bound)]
  FM[FaucetMinter
(DAO-controlled,
unauthorized initially)]

  %% Calls / relations
  EOA -->|deploy| GOV
  EOA -->|calls createDao| DF
  DF -->|uses| PSP
  DF -->|resolves setup from| TVR
  PSP -->|prepare/apply installation| TVS
  TVS -->|deploy/configure| TV
  DF -->|returns created DAO| DAO

  %% Governance wiring
  TV -->|getVotingToken() ==| GOV
  GOV -->|transferOwnership| DAO

  %% Execution path for CogniSignal
  EOA -->|deploy(DAO)| CS
  EOA -->|deploy(DAO, GOV)| FM

  TV -->|proposal executes| DAO
  DAO -->|onlyDAO: signal()| CS
```

Key “connection facts” this repo relies on:

- **CogniSignal is connected to the DAO purely by constructor binding** (`CogniSignal.DAO = createdDao`).
- **TokenVoting is the governance mechanism**: proposals created in TokenVoting execute actions via the DAO, so the DAO becomes the effective caller that can call `CogniSignal.signal()`.
- The DAO becomes the **owner of NonTransferableVotes** (via `transferOwnership`), making token mint-role governance possible by DAO proposal execution.

---

## 2) Typescript drop-in replacement plan (Aragon OSx happy path, wallet-signed, no secrets)

### 2.1 Goal and non-goals

**Goal (parity with current happy path):**

- [ ] Create an Aragon OSx DAO (same mechanism: `DAOFactory.createDao` + TokenVoting plugin).
- [ ] Install TokenVoting configured identically (7-parameter setup encoding + same thresholds).
- [ ] Use `NonTransferableVotes` as the voting token, mint initial membership token(s), and transfer ownership to the DAO.
- [ ] Deploy `CogniSignal(dao)`.
- [ ] Do **not** require a private key env var; the operator signs tx(s) in their wallet.

**Non-goals (optional extras):**

- Contract verification (Etherscan) can remain optional.
- Faucet deployment can be optional, but for a true drop-in replacement it should be supported.

### 2.2 Proposed technologies

- **Node.js + Typescript** CLI script (drop-in for `make dao-setup`).
- **viem** (recommended) for:
  - ABI encoding (especially nested structs)
  - public client (reads)
  - wallet client (writes)
- **Wallet signing without private keys**:
  - Use an EIP-1193 provider in Node via **WalletConnect v2** (QR code flow) _or_
  - Support a local signer RPC that exposes `eth_sendTransaction` from a wallet app (Frame / MetaMask “RPC” setups), but WalletConnect is the most portable.

Why this matches the requirement:

- The script never sees a raw private key.
- Transactions are signed by the user in their wallet UI.

### 2.3 Inputs / configuration (no secrets)

Required inputs (public / non-secret):

- `EVM_RPC_URL`: JSON-RPC endpoint to read chain state and wait for receipts.
- `CHAIN_ID`: used to select Aragon OSx addresses and protect against wrong-network signing.

Required user interaction:

- User connects wallet (WalletConnect QR) and approves:
  - deployment tx(s)
  - contract calls (mint, createDao, transferOwnership)

Provider addresses:

- Keep the same chain-id keyed address mapping currently embedded in `SetupDevChain.s.sol`:
  - `DAOFactory`
  - `PluginSetupProcessor`
  - `TokenVotingRepo`

Token initial holders:

- **Parity (current)**: `TOKEN_INITIAL_HOLDER` (single address)
- **Lesser requirement**: allow multiple initial holders:
  - `INITIAL_HOLDERS=0xabc...,0xdef...` (CSV)
  - Each receives exactly `1e18` minted once.

Token metadata:

- `TOKEN_NAME`, `TOKEN_SYMBOL` (same defaults as current)

### 2.4 Critical on-chain workflow in TS (exact parity steps)

Below is the TS flow that should mirror the Foundry scripts.

#### Step 0: connect wallet + validate chain

- Connect to wallet (WalletConnect/EIP-1193)
- Read `chainId` from wallet and RPC
- Require `walletChainId == rpcChainId == expected CHAIN_ID`

Invariant: **never sign on the wrong chain**.

#### Step 1: preflight OSx addresses

- Select OSx addresses by `CHAIN_ID` (same as current script).
- For each of:
  - DAOFactory
  - PSP
  - TokenVotingRepo

Read `eth_getCode` and require non-empty.

Then confirm:

- `DAOFactory.pluginSetupProcessor()` equals the configured PSP address.

Invariant: **factory/PSP wiring matches**.

#### Step 2: deploy `NonTransferableVotes`

- Send `deploy NonTransferableVotes(TOKEN_NAME, TOKEN_SYMBOL)`

Invariant: deployed bytecode exists, address nonzero.

#### Step 3: mint initial holders

- For each initial holder address (1 or many):
  - call `mint(holder, 1e18)`

Invariants:

- each address only minted once
- `balanceOf(holder) == 1e18`
- (optional) `delegates(holder) == holder` if checking votes/delegation

#### Step 4: call `DAOFactory.createDao()` with TokenVoting plugin settings

You must replicate the exact struct construction and ABI encoding.

- Build `DAOSettings`:
  - `trustedForwarder = 0x000…000`
  - `daoURI = ""`
  - `subdomain = ""`
  - `metadata = abi.encode(string("CogniSignal DAO - <TOKEN_NAME>"))`

- Build TokenVoting setup data (`tokenVotingData`) as ABI-encoded 7-tuple:
  - VotingSettings
  - TokenSettings { addr = NonTransferableVotes address, name, symbol }
  - MintSettings { receivers=[], amounts=[], ensureDelegationOnMint=false }
  - TargetConfig { target=0x0, operation=Call }
  - minApprovals = 0
  - pluginMetadata = 0x
  - excludedAccounts = []

- Build `PluginSettings[0]`:
  - `pluginSetupRef.versionTag.release = 1`
  - `pluginSetupRef.versionTag.build = 3`
  - `pluginSetupRef.pluginSetupRepo = TokenVotingRepo`
  - `data = tokenVotingData`

- Send transaction: `DAOFactory.createDao(daoSettings, pluginSettings)`

Parse the return value (or decode logs if needed):

- `createdDao`
- `installedPlugins[0].plugin` (TokenVoting plugin address)

Invariants:

- DAO has code
- TokenVoting plugin has code

#### Step 5: validate the voting token linkage

- Call `TokenVoting.getVotingToken()` at the plugin address.

Invariant:

- returned voting token equals the `NonTransferableVotes` address (or at least is nonzero + has code).

#### Step 6: transfer token ownership to DAO

- Call `NonTransferableVotes.transferOwnership(createdDao)`

Invariant:

- `owner()` equals DAO

#### Step 7: deploy `CogniSignal(dao)`

- Deploy `CogniSignal(createdDao)`

Invariant:

- `CogniSignal.DAO == createdDao`

#### Step 8 (optional parity): deploy `FaucetMinter`

If parity with current `make dao-setup` output is desired:

- Deploy `FaucetMinter(dao, token, amountPerClaim, globalCap)`

Invariant:

- Deployed successfully and code exists
- It is still “unauthorized” until a TokenVoting proposal grants mint/config/pause permissions (same as today)

### 2.5 Output behavior (no secrets)

The TS script should still produce a “copy/paste friendly” output file, but must never include secrets.

Proposed:

- Write `.env.<TOKEN_SYMBOL>` (or `.env.<TOKEN_SYMBOL>.public`) containing:
  - `EVM_RPC_URL` (optional, user-provided)
  - `CHAIN_ID`
  - `DAO_ADDRESS`
  - `ARAGON_VOTING_PLUGIN_CONTRACT`
  - `GOVERNANCE_TOKEN`
  - `SIGNAL_CONTRACT`
  - `UNAUTHORIZED_GOVTOKEN_FAUCET` (if deployed)
  - `DEPLOYER_ADDRESS`

Explicitly do **not** write:

- `WALLET_PRIVATE_KEY`

### 2.6 Auth model

- **All writes are authorized by wallet UI signatures**, not by a private key loaded into the script.
- The script must work with:
  - WalletConnect (QR), or
  - Any EIP-1193 provider that can sign and broadcast transactions.

### 2.7 Invariants to uphold (must not regress)

- DAO is created via `DAOFactory.createDao` with TokenVoting plugin installed.
- TokenVoting plugin is configured with the same parameters:
  - EarlyExecution
  - 50% support
  - 50% participation
  - 3600s duration
  - 1 token proposer threshold
- The voting token is `NonTransferableVotes` and ends owned by the DAO.
- CogniSignal is immutable-bound to the DAO and only callable by the DAO.
- No secrets (private keys) are required, stored, or emitted.

### 2.8 TODO checklist (implementation work plan)

- [ ] Create `script/dao-setup.ts` (Node TS CLI) as the new orchestrator.
- [ ] Add a wallet connection layer (WalletConnect v2 EIP-1193 provider).
- [ ] Add chain-id keyed OSx address mapping (copy from `SetupDevChain.s.sol`).
- [ ] Implement preflight checks (`eth_getCode`, `DAOFactory.pluginSetupProcessor()`).
- [ ] Import ABIs (recommended: generate from Foundry artifacts or maintain minimal ABI JSONs matching `AragonInterfaces.sol` + our contracts).
- [ ] Implement deployments:
  - [ ] `NonTransferableVotes`
  - [ ] mint to initial holder(s)
  - [ ] `DAOFactory.createDao` call (structs + exact 7-param tokenVotingData encoding)
  - [ ] `TokenVoting.getVotingToken()` validation
  - [ ] `NonTransferableVotes.transferOwnership(dao)`
  - [ ] `CogniSignal(dao)`
  - [ ] optional: `FaucetMinter(dao, token, …)`
- [ ] Implement output:
  - [ ] console summary
  - [ ] write `.env.<TOKEN_SYMBOL>.public` (no secrets)
- [ ] Add safety rails:
  - [ ] abort on wrong chain id
  - [ ] abort if TokenVoting repo/factory/psp code missing
  - [ ] abort if plugin address or DAO address returns no code
  - [ ] enforce unique initial holders + mint exactly 1e18
- [ ] (Optional) Add contract verification hooks (Etherscan API key), but keep this optional and separate from critical path.
