# Real Polygon `PayoutRedemption` log fixtures

Ground-truth for the B1 decode regression. The companion test
(`tests/unit/features/redeem/payout-redemption-decode.test.ts`) covers the
same contract with synthetic encoded logs; this fixture covers it with bytes
that actually appeared on Polygon mainnet, so any drift between viem's encode
path and a live RPC's wire format is also caught.

## `ctf-payout-redemption.json`

- Source tx: `0xd8cfc22a5dd1f2bc7809d2fd84df801dcd1795fbec5e62daddcf7031a63da551`
  (block 0x5215ef6 / 86,036,214) — the operator funder
  (`0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134`) calling `CTF.redeemPositions`
  on a neg-risk market (one of the v0.1 bleed cases).
- Address: `0x4d97dcd97ec945f40cf65f87097ace5ea0476045` (Polygon CTF).
- 4 topics = sig + 3 indexed args (redeemer, collateralToken, parentCollectionId).
  `conditionId` lives in `data[0:32]`. **`topics[4]` is undefined** — that is
  exactly the v0 bug shape, and the reason the synthetic test asserts the same.

Expected decoded values:

- `redeemer` = `0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134`
- `conditionId` = `0x18ec34d073083a5cc3c576e2cdf93fbbb162167ffc4f770dbfa15ba4c2a0927d`

## `negrisk-payout-redemption.json`

- Source tx: `0x57c980d7fab76cce5a53d68b96a0904f122fa59ef9f4e177b31624b329ffb097`
  (block 0x5216e5c / 86,040,668) — an external user calling
  `NegRiskAdapter.redeemPositions` (we don't yet emit any of these from our
  funder; that's the whole point of this task).
- Address: `0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296` (Polygon NegRiskAdapter).
- 3 topics = sig + 2 indexed args (redeemer, conditionId). `conditionId` IS
  in `topics[2]` — distinct from the CTF shape.

Expected decoded values:

- `redeemer` = `0x31e75c1b1f1885c578d2a5a5dcf8554d21140707`
- `conditionId` = `0x5e87ec054c39e4c497d0da54b509117b8ad410d46505429304a14d9f30fff000`

## How fixtures were collected

Public Polygon RPC `https://polygon-bor-rpc.publicnode.com` (no auth):

```sh
# CTF: receipt for a known funder redeem tx (sourced from Loki bleed_detected)
curl -X POST https://polygon-bor-rpc.publicnode.com \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":["0xd8cfc22a5dd1f2bc7809d2fd84df801dcd1795fbec5e62daddcf7031a63da551"]}'

# NegRisk: getLogs over a 200-block window filtered by the NegRiskAdapter
# PayoutRedemption topic-0 hash
curl -X POST https://polygon.drpc.org \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getLogs","params":[{"address":"0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296","topics":["0x9140a6a270ef945260c03894b3c6b3b2695e9d5101feef0ff24fec960cfd3224"],"fromBlock":"0x5216e5b","toBlock":"0x5216f23"}]}'
```

These are immutable historical logs, so the fixtures are stable indefinitely.
