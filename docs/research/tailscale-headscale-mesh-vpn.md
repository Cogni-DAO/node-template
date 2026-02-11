---
id: tailscale-headscale-mesh-vpn
type: research
title: Tailscale / Headscale Mesh VPN for Cogni Infrastructure
status: active
trust: draft
summary: Evaluation of Tailscale (via Headscale OSS) for secure inter-node networking — timing recommendation and future project layout
read_when: Planning multi-VM deployment, evaluating mesh VPN options, or designing cross-node communication
owner: cogni-dev
created: 2026-02-12
verified: 2026-02-12
tags: [networking, security, infrastructure, research]
---

# Research: Tailscale / Headscale Mesh VPN for Cogni Infrastructure

> spike: spike.0037 | date: 2026-02-12

## Question

Should Cogni adopt Tailscale (via Headscale, the OSS coordination server) for secure inter-node networking? If so, when in the roadmap is it valuable — now, or a future phase? What problems does it solve that our current architecture doesn't, and what does it cost?

## Context

### What We Have Today

**Authentication & Identity:**

- SIWE (Sign-In with Ethereum) via Auth.js Credentials provider → JWT session cookies
- Wallet address is the canonical user identity (`user:{walletAddress}`)
- `src/proxy.ts` enforces session auth on `/api/v1/*` routes
- No programmatic API keys yet (target state in `security-auth-spec`)

**Authorization (Designed, Not Yet Implemented):**

- OpenFGA-based RBAC/ReBAC with actor/subject model (`rbac-spec`)
- Dual-check for delegated execution (agent acting on behalf of user)
- connectionId-based credential brokering for tools (`tenant-connections` spec)
- Database Row-Level Security keyed on `app.current_user_id`

**Network Topology (Current Production):**

- Single Cherry Servers bare-metal VM per environment (preview, production)
- Three Docker networks:
  - `cogni-edge` — external, shared with Caddy for TLS termination
  - `internal` — app stack services (postgres, litellm, temporal, alloy)
  - `sandbox-internal` — isolated (`internal: true`) for OpenClaw sandbox containers
- All services communicate via Docker DNS within the same VM
- SSH key-based deployment from GitHub Actions
- No cross-VM service communication
- No VPN or mesh networking

**Multi-User Agent Goals:**

- Many users authenticate via SIWE and share access to AI agents (graphs)
- OpenFGA determines who can invoke which graph, execute which tool, use which connection
- Agents act on behalf of users via delegation (dual-check enforcement)
- All billing is per-tenant, attributed through LiteLLM spend logs

### Planned Infrastructure Evolution (Key Roadmap Context)

**OIDC / SSO adoption (P1, planned):**

- `proj.maximize-oss-tools` lists **Keycloak / Authentik / ZITADEL** as P1 for MFA/SSO beyond SIWE
- Trigger: "Need MFA or SSO beyond SIWE" — this is expected as multi-user access grows
- Once adopted, all infrastructure services can authenticate users via OIDC
- `cosign keyless` in `proj.cicd-services-gitops` already references OIDC for container image signing

**K8s transition (P2-P3, planned):**

- `proj.cicd-services-gitops` recommends **k3s** (lightweight K8s) + **Argo CD** + **Kustomize** as the target deployment stack
- P2 includes "GitOps deploy manifests: auto-generate K8s Deployment from service Dockerfile + env schema"
- P2 includes "Kubernetes Readiness Gates" (startup probes, verbose readiness)
- `node-operator-contract` states: "Operator may offer multi-tenant Node hosting on Kubernetes; Helm charts and K8s manifests are Operator-owned deployment artifacts"
- `proj.ci-cd-reusable` P3 plans multi-node pipeline extraction when 2+ nodes exist

**This changes the analysis.** The "SIWE ≠ OIDC" objection disappears with OIDC adoption. The K8s transition creates new networking requirements that mesh VPN directly addresses.

### What Prompted This Research

As Cogni grows from a single-VM deployment to potentially multi-node infrastructure (Operator services, multiple Nodes, K8s clusters, cross-VM communication), does a mesh VPN layer like Tailscale/Headscale belong in our stack — and specifically, at what phase?

## Findings

### What Tailscale/Headscale Is

**Tailscale** is a mesh VPN built on WireGuard with three architectural layers:

1. **Coordination Server** — distributes public keys and network maps; never sees data traffic
2. **DERP Relays** — fallback encrypted relays when direct peer-to-peer fails (NAT traversal)
3. **Peer-to-Peer WireGuard Tunnels** — end-to-end encrypted data plane, zero-trust

**Headscale** (github.com/juanfont/headscale, 26.2k stars, BSD-3-Clause) is the open-source, self-hosted implementation of the Tailscale coordination server. It runs unmodified Tailscale clients against infrastructure you control.

- Latest release: v0.26.1 (mid-2025)
- Language: Go
- One maintainer is a Tailscale employee (reduces protocol compatibility risk)
- Single tailnet per instance (no multi-tailnet from one server)
- Backend: SQLite or PostgreSQL
- Production-tested at ~250 nodes

**Key features for Cogni:**

| Feature                  | What It Does                                                | Cogni Relevance                                        |
| ------------------------ | ----------------------------------------------------------- | ------------------------------------------------------ |
| **MagicDNS**             | Automatic hostname-based service discovery                  | Cross-VM service routing without manual DNS            |
| **ACLs**                 | Fine-grained deny-by-default network policy (user/tag/port) | Network-level Node↔Operator boundary enforcement      |
| **Pre-auth keys + tags** | Automated node registration with role-based tags            | Docker sidecar pattern, CI/CD provisioning             |
| **OIDC auth**            | Identity-provider-backed node authentication                | **Direct integration with planned Keycloak/Authentik** |
| **Tailscale SSH**        | Identity-based SSH without key management                   | Replaces Cherry SSH key rotation                       |
| **Subnet routing**       | Extend tailnet to non-Tailscale devices                     | Reach Docker networks from other VMs                   |
| **K8s operator**         | First-class Kubernetes integration                          | **Direct integration with planned k3s transition**     |
| **REST/gRPC API**        | Programmatic node and policy management                     | DAO-governed infrastructure automation                 |

### Option A: Adopt Headscale Now (P0/P1)

**What:** Deploy Headscale coordination server, run Tailscale clients on VMs and/or as Docker sidecars.

**Pros:**

- Encrypted inter-service communication out of the box (WireGuard)
- MagicDNS provides automatic hostname-based service discovery across VMs
- Fine-grained ACLs (per-user, per-tag, per-port) evaluated client-side
- Pre-auth keys with tags work perfectly with Docker sidecar pattern
- Full self-hosted control (DAO sovereignty preserved)
- Existing connections persist even if coordination server goes down

**Cons:**

- **We only have one VM per environment.** Mesh networking solves multi-node communication — we don't have that problem yet
- Adds operational complexity: another service to deploy, monitor, upgrade
- Docker sidecar pattern requires `net_admin` capabilities and `/dev/net/tun` access
- OIDC IdP not yet deployed — would need pre-auth keys only until Keycloak/Authentik lands

**Fit with our system:** Poor fit today. Single VM, no cross-VM traffic. Pure overhead.

### Option B: Adopt Headscale at K8s Transition (P2-P3) — Recommended

**What:** Deploy Headscale as part of the k3s/Argo CD infrastructure transition. Use it for cross-cluster networking, developer access, and Node↔Operator boundary enforcement.

**Pros:**

- **OIDC will exist by then.** Keycloak/Authentik (P1) provides the IdP that Headscale integrates with natively. Developers and services authenticate to the mesh via their OIDC identity — same identity used for app auth, container signing (cosign keyless), and mesh access
- **K8s creates the need.** Once services run on k3s, cross-cluster communication between Node K8s and Operator K8s requires encrypted overlay networking. Tailscale has a first-class [K8s operator](https://tailscale.com/kb/1185/kubernetes/) that manages pods, ingress, and egress
- **Replaces SSH key sprawl.** Current Cherry VM SSH keys are manually managed. Tailscale SSH with OIDC auth eliminates key rotation entirely
- **MagicDNS replaces manual DNS.** k3s CoreDNS handles intra-cluster DNS, but cross-cluster service discovery needs something. MagicDNS fills this naturally
- **ACLs enforce Node sovereignty at the network level.** The `node-operator-contract` defines boundaries at the code layer (dependency-cruiser) and app layer (no cross-imports). Mesh ACLs add a third enforcement layer: Node pods physically cannot reach Operator-internal services unless the ACL allows it
- **Pre-auth keys + tags map to K8s semantics.** `tag:node`, `tag:operator`, `tag:sandbox` → ACL rules. The K8s operator auto-registers pods with appropriate tags
- **Sandbox containers on remote GPUs.** If sandbox execution moves to dedicated GPU VMs, the `sandbox-internal` Docker network won't span VMs. Mesh VPN sidecars solve this without overlay network complexity

**Cons:**

- Adds another piece of infrastructure to the k3s stack (Headscale + DERP alongside Argo CD + Kustomize)
- Headscale OIDC groups can't be used directly in ACLs (known limitation — use tags instead)
- Still a single tailnet per instance — multi-Node isolation is ACL-based, not network-based

**Fit with our system:** Strong fit at this phase. The OIDC IdP, K8s runtime, and multi-VM topology all converge to create the exact conditions where mesh VPN pays off. Headscale integrates with all three naturally.

### Option C: Use Alternatives Instead

**What:** When multi-node communication is needed, use plain WireGuard, Nebula, NetBird, or ZeroTier instead.

**Alternative analysis:**

| Tool                | Self-Hosted        | Protocol  | Key Advantage                                                      | Key Disadvantage                                                         |
| ------------------- | ------------------ | --------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| **Plain WireGuard** | Always             | WireGuard | Zero dependencies                                                  | O(n²) config complexity, no NAT traversal, no auto-discovery             |
| **Nebula** (Slack)  | Always             | Custom    | CA-based trust, proven at scale                                    | No ecosystem (no DNS, no file sharing, no SSH), manual cert distribution |
| **ZeroTier**        | Yes (controller)   | Custom L2 | Virtual L2 (VLANs)                                                 | Single-threaded (~484 Mbit/s), less mature self-hosting                  |
| **NetBird**         | Yes (full stack)   | WireGuard | **Zero vendor dependency**, modern web UI, full-stack OSS          | Smaller community, less battle-tested clients                            |
| **Headscale**       | Yes (coordination) | WireGuard | Polished Tailscale clients, huge community, MagicDNS, K8s operator | Protocol dependency on Tailscale Inc.                                    |

**NetBird deserves special mention** for a DAO that values sovereignty: it owns the entire stack (client + server) with no vendor protocol dependency. However, Tailscale clients are significantly more polished and battle-tested, and Headscale having a Tailscale employee as maintainer reduces the protocol compatibility risk substantially. **NetBird also has OIDC integration and a K8s integration**, making it a viable alternative to Headscale at the K8s transition point.

**K8s-native alternatives to consider at decision time:**

- **Cilium** — eBPF-based CNI with built-in WireGuard encryption for pod-to-pod traffic. Handles intra-cluster networking natively. Could replace mesh VPN for intra-cluster use, but doesn't solve cross-cluster or developer-access use cases
- **Istio/Linkerd** — service mesh with mTLS. Different layer (L7 vs L3), heavier weight, but provides per-request auth and observability. Could complement mesh VPN rather than replace it

## Recommendation

**P2-P3: Adopt alongside K8s transition. Not now, not never.**

### Why Not Now (Still True)

1. **Single VM deployment.** No cross-VM traffic to encrypt. Docker networks handle everything.
2. **No OIDC IdP yet.** Pre-auth keys work, but the identity-aware value proposition is limited without OIDC.
3. **Operational overhead without payoff.** Another service competing for resources on a single small VM.

### Why at K8s Transition (Not P3+ Far Future)

The original analysis said "P3+ future" because it treated OIDC and K8s as hypothetical. They're not — they're planned:

1. **OIDC creates the identity layer.** Once Keycloak/Authentik exists, Headscale OIDC integration means developers authenticate to the mesh with the same identity they use for the app. No separate key management.

2. **k3s creates the networking need.** Cross-cluster communication (Node k3s ↔ Operator k3s), developer access to K8s API servers, and sandbox containers on remote GPU VMs all require encrypted cross-node networking. This is the core problem mesh VPN solves.

3. **Tailscale has a K8s operator.** It's not bolted-on — it manages pod registration, ingress, and egress natively. Adopting mesh VPN alongside k3s means it's part of the infrastructure design, not retrofitted.

4. **Three-layer boundary enforcement.** Today we have:
   - Code layer: dependency-cruiser (import rules)
   - App layer: OpenFGA (authorization checks)

   Mesh VPN adds:
   - Network layer: ACLs (Node pods can't physically reach Operator internals)

5. **cosign keyless already assumes OIDC.** The CI/CD services gitops project uses OIDC-based container signing. Headscale uses the same OIDC IdP. One identity layer serves multiple infrastructure concerns.

### Timing Matrix

| Phase                         | What Happens                              | Mesh VPN Relevance                                                                                  |
| ----------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Now (P0-P1)**               | Single VM, SIWE-only auth, Docker Compose | **Not relevant.** Don't invest.                                                                     |
| **OIDC adoption (P1)**        | Keycloak/Authentik deployed               | **Prerequisite met.** Identity layer exists for mesh auth.                                          |
| **K8s transition (P2)**       | k3s + Argo CD, services move to K8s       | **Deploy Headscale alongside k3s.** Cross-cluster networking, developer K8s access, ACL boundaries. |
| **Operator extraction (P3+)** | Multi-repo, multi-cluster                 | **Full value.** Node↔Operator network isolation, multi-Node federation.                            |

### Concrete Trigger

**When the k3s cluster is being provisioned, include Headscale (or NetBird) in the infrastructure plan.** Don't add it as an afterthought — design the cluster networking to include mesh VPN from day one.

## Open Questions

1. **Headscale vs NetBird bake-off.** Both support OIDC, both support K8s, both are WireGuard-based. NetBird owns the full stack (better for DAO sovereignty). Headscale has Tailscale's polished clients. Deserves a focused comparison when k3s planning begins.

2. **Cilium CNI vs mesh VPN for intra-cluster.** If k3s uses Cilium as CNI, it provides WireGuard-encrypted pod-to-pod traffic natively. Mesh VPN would then only be needed for cross-cluster + developer access. This reduces scope and complexity.

3. **Sandbox networking on remote GPUs.** If sandbox execution moves to dedicated GPU VMs, the `sandbox-internal` Docker network won't span VMs. Mesh VPN sidecar vs overlay network (Swarm, VXLAN) — evaluate together with k3s networking decisions.

4. **Headscale HA story.** The coordination server is a single point of failure for new node registration and policy updates. Existing WireGuard connections survive coordinator downtime, but new nodes can't join and policy updates don't propagate. For a DAO that values uptime, evaluate HA options (PostgreSQL backend + multiple read replicas, or just fast recovery).

5. **OIDC group → ACL mapping.** Headscale OIDC groups can't be used directly in ACLs (known limitation). Workaround: map OIDC claims to tags at registration time via the Headscale API. Verify this works with the chosen IdP before committing.

## Proposed Layout

This section sketches what the work would look like at the K8s transition point.

### Project (at K8s transition)

`proj.mesh-networking` — Secure inter-node mesh VPN for multi-cluster Cogni deployments

**Phases:**

- Crawl: Deploy Headscale (or NetBird) coordination server, connect 2 VMs, validate MagicDNS + ACLs + OIDC auth
- Walk: Integrate K8s operator for pod-level mesh identity, migrate SSH access to mesh, write ACL policy
- Run: Cross-cluster Node↔Operator networking, sandbox containers on remote GPUs, multi-Node federation

**Prerequisites:**

- OIDC IdP deployed (Keycloak/Authentik — `proj.maximize-oss-tools` P1)
- k3s cluster provisioned (`proj.cicd-services-gitops` P2)

### Specs (at K8s transition)

- `mesh-networking.md` — invariants for inter-node communication, trust model, ACL policy schema
- Update `environments.md` — add multi-cluster deployment mode
- Update `node-operator-contract.md` — network-level boundary enforcement (third layer)

### Tasks (rough sequence)

1. Evaluate Headscale vs NetBird with OIDC + K8s focus (spike)
2. Deploy coordination server + DERP relay on management infrastructure
3. OIDC integration with chosen IdP (Keycloak/Authentik)
4. Connect k3s nodes to mesh, validate MagicDNS
5. Write ACL policy: `tag:node`, `tag:operator`, `tag:sandbox`, `tag:developer`
6. Deploy K8s operator for pod-level mesh identity
7. Migrate developer SSH access to mesh VPN
8. Cross-cluster service discovery for Node↔Operator communication
