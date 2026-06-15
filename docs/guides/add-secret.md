---
id: guide.add-secret
type: guide
title: Add a Node Secret
status: draft
trust: draft
summary: Node-repo half of adding a node-specific secret without touching operator deploy plumbing.
read_when: Adding a credential or API key that this node's app code consumes.
owner: derekg1729
created: 2026-06-05
verified: null
tags: [secrets, nodes]
---

# Add a Node Secret

A node developer owns the secret declaration and typed consumption. The value is written through the operator — a node-owner can now self-serve it with only an API key (no kubectl, no OpenBao token).

## Secret or Plain Config

Use this guide only for credentials: API keys, tokens, webhook secrets, private signing material, and passwords.

Plain non-sensitive config belongs in typed app config and the operator-owned deployment overlay, not in a secrets catalog.

## 1. Declare the Shape

If `.cogni/secrets-catalog.yaml` does not exist, create it (a commented stub ships in this template). Add one entry for the node-owned key:

```yaml
- name: MY_NEW_KEY
  tier: A2
  appliesTo: web
  shared: false
  source: human
  required: true
  category: "Vendor Name"
  description: One line describing what consumes this key.
  steps:
    - "Create the key in the vendor dashboard."
```

Use `source: agent` only for values that automation can generate safely. Use `source: human` for vendor credentials.

## 2. Consume It in Code

Read `process.env.MY_NEW_KEY` through the node's typed env boundary. Required secrets must fail fast at startup if missing. Do not silently continue with `undefined`.

Do not log secret values, request headers, tokens, cookies, or full vendor payloads.

## 3. Set the Value

The value never enters git, PR comments, chat, or committed YAML. Two paths write it to OpenBao:

**Self-serve via the operator (you, the node owner — recommended).** Granted OpenFGA
`secrets_manager` on this node, you set the value through the operator with only your
**API key** — no kubeconfig, no OpenBao writer token:

```
POST https://<operator-host>/api/v1/nodes/<node-id>/secrets
Authorization: Bearer <your-api-key>
content-type: application/json

{ "key": "MY_NEW_KEY", "value": "…", "op": "set" }     # op:"rotate" to rotate

→ 200 { "written": true, "version": <n>, "path": "cogni/<env>/<node>/MY_NEW_KEY" }
```

The operator authorizes the write per-node (`can_manage_secrets`), confirms `MY_NEW_KEY`
is declared in this node's catalog (step 1), and writes it with its **own** in-cluster
OpenBao identity — your key never carries cluster custody. ESO + Stakater Reloader then
carry the value into the running pod. Confirm with the `version` in the response (no
`kubectl` needed).

**Ops / deploy-env owner (fallback).** Whoever holds the env's OpenBao writer role can
also write it directly:

```bash
pnpm secrets:set <env> <node-slug> MY_NEW_KEY
```

Either way, the operator side owns ExternalSecret wiring, pod `envFrom`, DB/DNS
provisioning, and rollout. A node PR should not edit those surfaces.

## What Not to Touch

- Do not commit a Kubernetes `Secret`.
- Do not add a per-key `valueFrom` line to a pod spec.
- Do not create a per-key ExternalSecret YAML.
- Do not paste the value into a PR, issue, chat, or shell history.
- Do not edit operator `infra/catalog`, Argo, or environment overlays from this node repo.

## PR Proof

- `.cogni/secrets-catalog.yaml` declares the key shape.
- The typed env boundary validates the key if code requires it.
- Tests or startup checks prove missing required config fails loudly.
- `pnpm check` passes.
