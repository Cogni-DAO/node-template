---
id: handoff.deploy-scorecard
title: "Deploy scorecard — compose infra deployed, k8s sync blocked on 3 issues"
branch: deploy/multi-node
vm_ip: 84.32.109.222
ssh: "ssh -i .claude/worktrees/deploy-scorecard/.local/test-vm-key root@84.32.109.222"
created: 2026-04-03
---

# Deploy Scorecard Handoff

## Current State

**VM is live** at `84.32.109.222` with Docker + k3s + Argo CD bootstrapped.

### What's working (green)

| Component | Status | Details |
|-----------|--------|---------|
| Postgres | **UP** | Port 5432 on host, 3 node DBs + litellm provisioned |
| Temporal | **UP** | Port 7233 on host, auto-setup complete |
| LiteLLM | **UP** | Port 4000 on host, custom image built |
| Redis | **UP** | Port 6379 on host |
| Caddy | **UP** | Ports 80/443, multi-node Caddyfile deployed |
| k3s | **UP** | Single node, Ready |
| Argo CD | **UP** | 5 Applications generated from catalog |
| k8s secrets | **UP** | All 5 secrets created directly on cluster |
| DB provisioning | **UP** | cogni_operator, cogni_poly, cogni_resy, litellm |

### What's blocked (3 issues)

#### 1. EndpointSlice rejects 127.0.0.1 (CRITICAL)

**Error:** `EndpointSlice "postgres-1" is invalid: endpoints[0].addresses[0]: Invalid value: "127.0.0.1": may not be in the loopback range`

**Root cause:** k8s validates EndpointSlice addresses and rejects loopback IPs. The entire bridge design (`infra/k8s/base/node-app/external-services.yaml`) uses `127.0.0.1` as the base, with overlays patching it per-env.

**Fix options:**
- **Option A (quick):** Use the node's actual internal IP (e.g., `10.42.0.1` or the VM's public IP `84.32.109.222`). Patch overlays to use `$(hostname -I | awk '{print $1}')`. k3s pods can reach host ports via the node IP.
- **Option B (proper):** Use `hostNetwork: true` on pods + regular k8s Services pointing to compose containers. Removes the EndpointSlice pattern entirely.
- **Option C (simplest):** Use k8s `ExternalName` services instead of EndpointSlice. `ExternalName` can point to a hostname, not an IP. But Postgres/Temporal use TCP not HTTP, so DNS-based routing has caveats.

**Recommended:** Option A. Get the node IP from `kubectl get node -o jsonpath='{.status.addresses[?(@.type=="InternalIP")].address}'` and patch all EndpointSlice overlays.

#### 2. GHCR image pull 403 Forbidden

**Error:** `failed to authorize: failed to fetch oauth token: 403 Forbidden`

**Root cause:** The provision script passes `dummy-ghcr-token-for-test` as the GHCR deploy token. The k3s `registries.yaml` (written at bootstrap via cloud-init) has this dummy token. Real private images need a valid `read:packages` PAT.

**Fix options:**
- Provide a real GHCR PAT with `read:packages` scope via `GHCR_DEPLOY_TOKEN` env var
- Or make the GHCR repo public for testing
- Or build images locally and import via `k3s ctr images import`

#### 3. Placeholder image tags

The overlays use placeholder tags like `staging-placeholder-operator`. Even with valid GHCR auth, these images don't exist. Need either:
- Real CI-built images promoted via `scripts/ci/promote-k8s-image.sh`
- Or local builds imported to k3s containerd

## Files Changed (on `deploy/multi-node`)

| File | Change |
|------|--------|
| `scripts/setup/provision-test-vm.sh` | Unified one-command: provision + compose deploy + k8s secrets + scorecard |
| `infra/compose/runtime/docker-compose.yml` | Host port bindings for Postgres/LiteLLM/Redis |
| `infra/compose/edge/docker-compose.yml` | `host.docker.internal` + POLY/RESY domain env |
| `infra/compose/edge/configs/Caddyfile.tmpl` | Multi-node routing to k8s NodePorts |

## Connection Info

```bash
# SSH (key in worktree .local/)
ssh -i .claude/worktrees/deploy-scorecard/.local/test-vm-key root@84.32.109.222

# Secrets
cat .claude/worktrees/deploy-scorecard/.local/test-vm-secrets.env

# Cherry credentials
cat .env.operator  # CHERRY_AUTH_TOKEN, CHERRY_PROJECT_ID, OPENROUTER_API_KEY

# Destroy VM when done
cd infra/provision/cherry/base
source .env.operator && export CHERRY_AUTH_TOKEN
export TF_VAR_ssh_private_key="" TF_VAR_ghcr_deploy_token="dummy" TF_VAR_sops_age_private_key="dummy"
tofu workspace select test && tofu destroy -var-file=terraform.test.tfvars
```

## Next Steps (priority order)

1. **Fix EndpointSlice IPs** — replace `127.0.0.1` with node internal IP in all overlays
2. **Provide GHCR PAT** — or build/push real images to GHCR
3. **Promote real images** — run `promote-k8s-image.sh` with actual digests
4. **Verify Argo sync** — all 5 apps should go Synced/Healthy
5. **Produce green scorecard** — the report template is in the provision script Phase 7

## Cost

VM is running at ~€0.07/hr. **Destroy when done** to avoid charges.
