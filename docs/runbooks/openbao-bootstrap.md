# OpenBao + ESO — Bootstrap & Operations

> Installed by `task.0284` as the Tier-1 secrets substrate.
> Manifests: `infra/k8s/argocd/{openbao,external-secrets}/` + `infra/k8s/secrets/external-secrets/`
> Spec: [`docs/spec/secrets-management.md`](../spec/secrets-management.md) — invariants + design
> Sister guides: [`secrets-add-new.md`](../guides/secrets-add-new.md) (adding a key) · [`secrets-rotate.md`](../guides/secrets-rotate.md) (rotating a value)

This runbook is the **operational** companion to the spec. Use this on first cluster bootstrap, after an unseal-required restart, when rotating the ESO seed binding, or when ESO sync is stuck. It does not duplicate the spec — read the spec first if you don't know why we picked OpenBao + ESO.

## Bootstrap: automated via `scripts/setup/provision-env-vm.sh` Phase 5b

OpenBao + ESO install is **not** a hand-run kubectl session — it is Phase 5b of `provision-env-vm.sh`, idempotent, and re-runs on every provision. Each provision:

1. `rsync infra/k8s/argocd/openbao/ → root@$VM_HOST:/opt/cogni-template-openbao/`
2. `kubectl kustomize --enable-helm /opt/cogni-template-openbao/ | kubectl apply -f -` — pulls the upstream OpenBao Helm chart at the pinned version (see [`values.yaml`](../../infra/k8s/argocd/openbao/values.yaml)) and applies the rendered manifests.
3. Same two steps for `infra/k8s/argocd/external-secrets/` → `/opt/cogni-template-external-secrets-operator/`.
4. `kubectl wait --for=condition=Established` on the `externalsecrets.external-secrets.io` and `clustersecretstores.external-secrets.io` CRDs.
5. Applies the cluster-scoped `ClusterSecretStore openbao-backend` (`infra/k8s/secrets/external-secrets/cluster-secret-store.yaml`).

Then Phase 6 applies the per-env `ExternalSecret` manifests. Phase 5b is idempotent; re-dispatching folds in chart version bumps.

> The bootstrap sequence is a deliberate ordering: ESO CRDs must register before any `ExternalSecret`/`ClusterSecretStore` apply. Skipping the wait in step 4 is the bug we paid for; `provision-env-vm.sh` exits a warning (not an error) on CRD wait timeout because re-running provision is the unblock — see the `TRANSITION_SAFE` invariant in the spec.

## First-time unseal (run ONCE per cluster lifetime)

OpenBao starts **sealed**. Until unsealed, all ESO reconciles fail with `vault is sealed` events on the ExternalSecrets and downstream Pods CrashLoop. Surface via `kubectl describe externalsecret -n cogni-<env>` and Argo CD UI; this is loud-by-design (spec Invariant 12).

```bash
# 1. Initialize the storage (writes 5 unseal keys + a root token). Run ONCE.
kubectl -n openbao exec -ti openbao-0 -- bao operator init -key-shares=5 -key-threshold=3
```

Capture the 5 keys + root token in your operator's password manager. **Do not commit, paste into chat, or feed to an AI agent context window** (spec Invariant 4 NO_VALUE_IN_GIT). Distribute 1 unseal key each to ≥3 trusted operators; the threshold-3-of-5 design is the recovery story when a single operator is unavailable.

```bash
# 2. Unseal — repeat with 3 distinct keys (Shamir's threshold).
kubectl -n openbao exec -ti openbao-0 -- bao operator unseal
# (paste key 1)
kubectl -n openbao exec -ti openbao-0 -- bao operator unseal
# (paste key 2)
kubectl -n openbao exec -ti openbao-0 -- bao operator unseal
# (paste key 3)

# 3. Verify unsealed.
kubectl -n openbao exec -ti openbao-0 -- bao status   # should show Sealed=false
```

After a pod restart, OpenBao starts sealed again — repeat step 2. Production should use the auto-unseal pattern (cloud KMS or another OpenBao); single-node k3s sticks with Shamir until task.5054 lands cert-manager + an auto-unseal target.

## Kubernetes auth — bind the `eso-reader` role

ESO authenticates via the cluster's Kubernetes auth method. Run ONCE per cluster post-unseal:

```bash
# Authenticate as root for setup (rotate the root token after, see "Root token rotation" below).
export BAO_TOKEN=<root-token-from-init>
export BAO_ADDR=http://openbao.openbao.svc.cluster.local:8200

# Enable the KV v2 mount at `cogni/` (matches ClusterSecretStore spec.provider.vault.path).
bao secrets enable -path=cogni -version=2 kv

# Enable Kubernetes auth.
bao auth enable kubernetes

# Tell OpenBao where the cluster's TokenReview API lives.
bao write auth/kubernetes/config \
  kubernetes_host=https://kubernetes.default.svc:443

# Policy: ESO reads cogni/<env>/<service>/* across the cluster. RBAC at the path
# level — see spec Invariant 6 RBAC_VIA_PATH_POLICY.
cat <<'HCL' | bao policy write eso-reader -
path "cogni/data/*"     { capabilities = ["read"] }
path "cogni/metadata/*" { capabilities = ["read", "list"] }
HCL

# Bind ESO's ServiceAccount to the eso-reader role.
bao write auth/kubernetes/role/eso-reader \
  bound_service_account_names=external-secrets \
  bound_service_account_namespaces=external-secrets \
  policies=eso-reader \
  ttl=1h
```

After this, the `ClusterSecretStore openbao-backend` should reach `status.conditions[].type=Ready`. Verify:

```bash
kubectl get clustersecretstore openbao-backend -o jsonpath='{.status.conditions}' | jq
# Want: [{type:"Ready",status:"True",reason:"Validated", ...}]
```

## Smoke test (end-to-end)

```bash
# 1. Write one secret value into OpenBao via the bao CLI from your laptop
#    (auth via OIDC from your operator identity — NOT a shared bot token).
bao kv patch cogni/candidate-a/node-app HELLO_WORLD=hello-from-runbook

# 2. Force the candidate-a ExternalSecret to resync immediately
#    (default refreshInterval is 1h; this annotation bypasses it).
kubectl annotate externalsecret -n cogni-candidate-a node-app-env-secrets \
  force-sync=$(date +%s) --overwrite

# 3. Watch the synced k8s Secret pick up the value.
kubectl -n cogni-candidate-a get secret node-app-env-secrets -o jsonpath='{.data.HELLO_WORLD}' \
  | base64 -d
# Expect: hello-from-runbook

# 4. Restart the consuming pod (Stakater Reloader auto-restart lands in task.5056).
kubectl -n cogni-candidate-a rollout restart deployment/node-app
kubectl -n cogni-candidate-a rollout status  deployment/node-app --timeout=120s
```

If step 3 returns nothing or step 4 CrashLoops: `kubectl describe externalsecret -n cogni-candidate-a node-app-env-secrets` — the events surface the cause (sealed, auth failure, missing OpenBao path, etc.).

## Rotation drill (run on every chart-version bump)

```bash
# 1. Update the value.
bao kv patch cogni/candidate-a/node-app HELLO_WORLD=hello-after-rotation

# 2. Wait for ESO to refresh (1h default for routine app secrets; use force-sync
#    annotation to skip the wait during drills).
kubectl annotate externalsecret -n cogni-candidate-a node-app-env-secrets \
  force-sync=$(date +%s) --overwrite

# 3. Confirm the k8s Secret carries the new value.
kubectl -n cogni-candidate-a get secret node-app-env-secrets -o jsonpath='{.data.HELLO_WORLD}' \
  | base64 -d

# 4. Restart the pod; verify the new value is in effect at runtime
#    (HOW you verify depends on what the pod does with HELLO_WORLD — for the
#    smoke key, exec into the pod and `printenv HELLO_WORLD`).
kubectl -n cogni-candidate-a rollout restart deployment/node-app
kubectl -n cogni-candidate-a exec deploy/node-app -- printenv HELLO_WORLD
```

Document the run output in the validation PR comment for `task.0284`.

## Rollback paths

### ExternalSecret stuck (sync failing)

```bash
# Inspect the failing condition.
kubectl describe externalsecret -n cogni-<env> <name>

# Common causes + fixes:
# - "vault is sealed"          → unseal (see above)
# - "permission denied"        → rebind eso-reader role / re-check policy paths
# - "missing or empty Secret"  → cogni/<env>/<service> path is empty in OpenBao;
#                                seed via secrets-add-new guide
# - CRD version drift          → re-run Phase 5b (kustomize re-apply is idempotent)
```

### Value regression (rotated key is broken)

```bash
# OpenBao KV v2 retains prior versions. List + rollback.
bao kv metadata get cogni/<env>/<service>
bao kv rollback -version=<N> cogni/<env>/<service>
# ESO refresh interval pulls the rolled-back value; restart pod to apply.
```

### Controller misbehaving (broken commits to k8s Secrets)

```bash
# Scale ESO to 0 — stops further reconciles.
kubectl scale -n external-secrets deployment/external-secrets --replicas=0

# (Optional) delete the bad ExternalSecret; deletionPolicy: Retain preserves
# the existing k8s Secret so consuming pods keep running on the prior value.
kubectl delete externalsecret -n cogni-<env> <name>
```

## Root token rotation

The init-time root token is a break-glass credential. Rotate after first-time
setup is complete:

```bash
# 1. Generate a new root with the unseal key threshold.
kubectl -n openbao exec -ti openbao-0 -- bao operator generate-root -init
# Captures `otp` + `nonce`. Run two more times with the unseal keys:
kubectl -n openbao exec -ti openbao-0 -- bao operator generate-root \
  -nonce=<nonce> <unseal-key-1>
# ...key-2, key-3 → outputs encoded_root.

# 2. Decode the new root.
kubectl -n openbao exec -ti openbao-0 -- bao operator generate-root \
  -decode=<encoded_root> -otp=<otp>
# Replace your captured root with this value.

# 3. Revoke the old root.
BAO_TOKEN=<old-root> kubectl -n openbao exec -ti openbao-0 -- bao token revoke -self
```

## Upgrades

Pinned versions live in:

- `infra/k8s/argocd/openbao/kustomization.yaml` (`helmCharts[0].version`)
- `infra/k8s/argocd/external-secrets/kustomization.yaml` (same)

Procedure:

1. Bump the pin.
2. `kustomize build --enable-helm infra/k8s/argocd/<name>/` locally to confirm the new render diffs cleanly.
3. Run the **smoke test** above on `candidate-a` after Phase 5b re-applies. ESO occasionally renames CRD versions between minor releases — watch for `kubectl wait` failures in Phase 5b and re-apply if needed.
4. Run the **rotation drill** to confirm pull + push paths still work end-to-end.

Do not bump OpenBao and ESO in the same PR unless the rotation drill is included — pairing a sealed-state regression with an auth-method regression makes the failing axis ambiguous.
