---
id: bug.0418
type: bug
title: 'Polymarket CLOB rejects 100% of placeOrder calls with reason="order_version_mismatch"'
status: done
priority: 0
rank: 1
estimate: 1
summary: 'Every `poly.clob.place` call on prod + candidate-a rejected by Polymarket CLOB with `reason="order_version_mismatch"`. Root cause: Polymarket rolled the V2 CTF Exchange contracts (`0xE111…996B` / `0xe2222d…0F59`) at ~11:00 UTC 2026-04-28; `@polymarket/clob-client@5.8.1` signed orders against V1 contracts only. Fix: migrate to `@polymarket/clob-client-v2@1.0.2` which auto-routes to V2.'
outcome: "PR #1118 swapped the SDK to `@polymarket/clob-client-v2`. Adapter constructor takes the new options-object shape; `SignatureType.EOA` → `SignatureTypeV2.EOA`; `placeOrder` arg order updated for v2 (postOnly/deferExec swap). Order envelope now V2 — `order_version_mismatch` rejections at zero. The downstream `balance: 0` symptom (V2 exchanges spend pUSD, not USDC.e) is bug.0419."
spec_refs:
  - poly-copy-trade-phase1
assignees: [derekg1729]
project: proj.poly-copy-trading
branch: fix/poly-clob-sell-fak-dust
created: 2026-04-28
updated: 2026-04-28
deploy_verified: true
labels: [poly, polymarket, clob, v2-migration, order-envelope, p0]
external_refs:
  - work/items/bug.0405.poly-clob-sell-fak-generates-dust.md
  - work/items/bug.0419.poly-v2-approval-contract-addresses.md
  - https://github.com/Cogni-DAO/node-template/pull/1118
---

# bug.0418 — CLOB `order_version_mismatch` (V1 → V2 SDK migration)

Polymarket V2 cutover went live 2026-04-28 ~11:00 UTC. V1 SDK signs against V1 exchange contracts; V2 CLOB rejects them. Symptoms, fix, and validation are bundled into PR #1118 alongside bug.0405 (FOK) and bug.0419 (pUSD/wrap approvals) — the three together restore end-to-end trading.

## Validation

- exercise: trigger a mirror BUY on candidate-a (real Polymarket target activity drives the pipeline)
- observability: `count_over_time({env="candidate-a", service="app"} | json | event="poly.clob.place" | reason="order_version_mismatch" [10m])` is `0`; at least one `phase="ok"` entry with non-empty `order_id` against the deployed SHA

Verified 2026-04-28 22:46 UTC — 4 successful BUYs, on-chain confirmed via Polymarket Data-API. PR #1118 [validation comment](https://github.com/Cogni-DAO/node-template/pull/1118#issuecomment-4339630885).
