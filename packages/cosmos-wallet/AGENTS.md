# cosmos-wallet · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

Cosmos SDK wallet abstraction for AKT funding on Akash Network. Port + adapters pattern matching operator-wallet. Privy doesn't support Cosmos chains, so this is a standalone wallet module.

## Pointers

- [Akash Deploy Service Spec](../../docs/spec/akash-deploy-service.md): Architecture and design
- [Operator Wallet](../operator-wallet/): EVM wallet — same port/adapter pattern

## Boundaries

```json
{
  "layer": "packages",
  "may_import": ["packages"],
  "must_not_import": [
    "app",
    "features",
    "ports",
    "core",
    "adapters",
    "shared",
    "services"
  ]
}
```

## Public Surface

- **Exports:** `CosmosWalletPort` (port interface), `cosmosBalanceSchema`, `cosmosTxResultSchema`, `cosmosWalletConfigSchema` (Zod schemas)
- **Subpath `./adapters/direct`:** `DirectCosmosWalletAdapter` (mnemonic-based, dev/testing)
- **Env/Config keys:** `COSMOS_MNEMONIC`, `COSMOS_RPC_ENDPOINT`

## Responsibilities

- This directory **does**: Define the Cosmos wallet interface and provide a mnemonic-based adapter for dev/testing
- This directory **does not**: Handle EVM chains, implement browser wallet signing (Keplr scaffold only)

## Notes

- `KeplrBridgeCosmosWalletAdapter` is a scaffold — not yet implemented
- `DirectCosmosWalletAdapter` uses dynamic imports for `@cosmjs/*` to keep them as peer dependencies
