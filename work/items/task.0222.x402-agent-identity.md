---
id: task.0222
type: task
title: "Agent-first identity: wallet → actor_id resolution for x402 and autonomous agents"
status: needs_design
priority: 1
rank: 5
estimate: 3
summary: "Design and implement the actor_id layer from identity-model.md so x402 wallet-bearing agents get proper economic identity — actor creation, wallet binding, billing account linking, and future human claim path."
outcome: "An autonomous agent paying via x402 gets an actor_id (kind=agent) with wallet binding. Billing, attribution, and charge_receipts reference actor_id. Humans can later link their user_id to claim the agent's activity."
spec_refs: [identity-model-spec, decentralized-user-identity]
assignees: []
credit:
project: proj.x402-e2e-migration
branch:
pr:
reviewer:
created: 2026-03-27
updated: 2026-03-27
labels: [identity, x402, web3, architecture]
external_refs: ["docs/spec/identity-model.md", "docs/spec/decentralized-user-identity.md"]
revision: 0
blocked_by: []
deploy_verified: false
---

## Context

The identity model spec (identity-model.md) defines `actor_id` as the economic subject — the entity that earns, spends, and gets attributed. Actor kinds include `user`, `agent`, `system`, and `org`. The `actors` table and `actor_bindings` table are specced but **not yet implemented**.

x402 introduces the first real consumer of agent identity: an autonomous AI agent with a USDC wallet calls our API, pays per-request, and needs to be tracked for billing and attribution. Today the system only knows `SessionUser` (human, logged in via SIWE/OAuth). There's no path for a wallet-only agent to get identity.

### The agent-first flow we need to support

```
1. Agent has a wallet (0xABC...)
2. Agent pays x402 → hits our public endpoint
3. System resolves wallet → actor_id (find or create, kind=agent)
4. Actor has billing_account (for charge_receipts)
5. Actor accumulates usage history
6. LATER: Human links their user_id → claims agent's actor_id
   (agent becomes "owned by" user, activity merges)
```

### What the identity spec already defines

- `actor_id` (UUID) — economic subject, supports `kind: agent`
- `actor_bindings` — links actor to wallets, external refs (like `user_bindings` for users)
- `parent_actor_id` — agent hierarchy (agent owned by user)
- Actors are orthogonal to `user_id` — an agent can exist without a user
- `billing_account_id` — 1:N per actor (multiple actors per tenant)

### What doesn't exist yet

- `actors` table (specced, not created)
- `actor_bindings` table (specced, not created)
- Resolution logic: wallet address → actor lookup → create if missing
- The `SessionUser` → facade coupling (facade assumes human session)
- Link/claim flow: user proves wallet ownership → takes ownership of agent actor

## Design Questions

1. **Facade decoupling**: `completion.server.ts` takes `SessionUser`. For x402, we have a wallet address, not a session. Options:
   - (a) Create synthetic `SessionUser` (hack, violates identity model)
   - (b) Refactor facade to accept generic `CallerIdentity` (wallet or session)
   - (c) Create separate x402 facade that bypasses `SessionUser` (duplication)
   - Recommendation: (b) is correct but may be too large. (a) as P0 shim with migration path to (b).

2. **Actor creation timing**: Create actor on first x402 payment? Or lazily on first charge_receipt?

3. **Billing account**: Does each wallet-agent get its own billing_account? Or share a "public x402" billing account?

4. **Human claim flow**: How does a human prove they own the wallet and claim the agent's history? SIWE is the existing wallet-auth mechanism — reuse it.

5. **charge_receipts FK**: Today charge_receipts FK to billing_account_id. Should they also FK to actor_id? The identity spec shows `actor_id` as "planned" in charge_receipts.

## Validation

- [ ] Wallet address → actor_id resolution works (find-or-create)
- [ ] Actor has kind=agent, wallet in actor_bindings
- [ ] Actor has associated billing_account
- [ ] charge_receipts can reference actor_id
- [ ] Human can link user_id to agent's actor_id via SIWE wallet proof
- [ ] Existing SessionUser flow unbroken
- [ ] facade accepts both session-based and wallet-based callers
