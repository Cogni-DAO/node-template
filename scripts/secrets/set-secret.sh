#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# scripts/secrets/set-secret.sh — write one secret value to OpenBao at
# cogni/<env>/<service>/<KEY>. The canonical CLI entry point (Spec
# Invariant 9 TOOLING_IS_THE_INTERFACE).
#
# Usage: pnpm secrets:set <env> <service> <KEY>
#   <env>     candidate-a | preview | production
#   <service> a catalog name (infra/catalog/<name>.yaml) OR `_shared`
#             (refuses `_system` — system paths edited by bootstrap only,
#             per Spec Invariant 10 SEED_TOKEN_IS_NEVER_TOUCHED_MANUALLY)
#   <KEY>     env var name; uppercase + digits + underscores
#
# Value: read from secure stdin (never echoed). Pipe input is supported
#        for non-interactive use (CI / bootstrap auto-seed):
#   echo -n "value" | pnpm secrets:set candidate-a node-app FOO
#
# Connectivity: tries in order
#   1. $BAO_ADDR + $BAO_TOKEN env (e.g. port-forward + admin token in CI)
#   2. SSH to .local/<env>-vm-ip with .local/<env>-vm-key, then
#      `kubectl exec -n openbao openbao-0 -- bao` using
#      .local/<env>-openbao-root-token
# Tests stub via $SET_SECRET_BAO (an executable path used in place of
# either real path) — see scripts/ci/tests/set-secret.test.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"

err()  { printf '%s\n' "$*" >&2; }
die()  { err "$@"; exit 2; }

usage() {
  err "Usage: pnpm secrets:set <env> <service> <KEY>"
  err "  env     candidate-a | preview | production"
  err "  service infra/catalog/<name>.yaml, or _shared"
  err "  KEY     uppercase + digits + underscores"
  err ""
  err "Value is read from stdin (interactive prompt or pipe). Never echoed."
  exit 2
}

[[ $# -eq 3 ]] || usage
env_name="$1"; service="$2"; key="$3"

# ── Env validation ──────────────────────────────────────────────────────────
case "$env_name" in
  candidate-a|preview|production) ;;
  *) die "Invalid env: '$env_name'. Must be candidate-a|preview|production." ;;
esac

# ── Service validation ──────────────────────────────────────────────────────
# `_shared` is a sanctioned cross-service namespace per the spec. `_system`
# is hard-refused (bootstrap-only). Other names must match a catalog entry.
case "$service" in
  _system)
    die "Refusing to write to _system/* — system paths are edited by bootstrap only (Spec Invariant 10 SEED_TOKEN_IS_NEVER_TOUCHED_MANUALLY)."
    ;;
  _shared)
    ;;
  _*)
    die "Reserved namespace '$service'. Only _shared is allowed; _system is bootstrap-only."
    ;;
  *)
    catalog_file="$REPO_ROOT/infra/catalog/${service}.yaml"
    if [[ ! -f "$catalog_file" ]]; then
      die "Unknown service '$service' — no infra/catalog/${service}.yaml. List catalog entries: ls infra/catalog/*.yaml"
    fi
    ;;
esac

# ── Key validation ──────────────────────────────────────────────────────────
if ! [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]]; then
  die "Invalid KEY '$key'. Must match ^[A-Z][A-Z0-9_]*$ (uppercase + digits + underscores; must start with letter)."
fi

# ── Read value (secure stdin) ───────────────────────────────────────────────
if [[ -t 0 ]]; then
  # Interactive: prompt + read silently.
  printf 'Value for cogni/%s/%s/%s (input hidden): ' "$env_name" "$service" "$key" >&2
  IFS= read -rs value
  printf '\n' >&2
else
  # Pipe / heredoc: read everything from stdin without trimming.
  value="$(cat)"
fi

if [[ -z "$value" ]]; then
  die "Empty value rejected. Run again and provide a non-empty value."
fi

# ── Patch invocation ────────────────────────────────────────────────────────
# The KV v2 path mounted at `cogni/` (see ClusterSecretStore) — `bao kv patch`
# writes to data/<path> automatically. `kv patch` cannot create an absent
# path, so first writes use `kv put` and later writes use `kv patch`.
# We pass the key=value as the FIRST (and only) arg following the path so that
# `bao` reads it; the value is passed via stdin to avoid showing in `ps`.
#
# Three execution modes:
#  1. $SET_SECRET_BAO set → invoke that command directly (test shim)
#  2. $BAO_ADDR + $BAO_TOKEN set → invoke `bao` from PATH
#  3. otherwise → kubectl exec into openbao-0 over SSH using local .local/ keys

bao_path="cogni/${env_name}/${service}"

if [[ -n "${SET_SECRET_BAO:-}" ]]; then
  # Test shim — bypass real bao + SSH. The shim receives:
  #   $1 = path, $2 = key, value via stdin
  printf '%s' "$value" | "$SET_SECRET_BAO" "$bao_path" "$key"
  exit_code=$?
  exit $exit_code
fi

if [[ -n "${BAO_ADDR:-}" && -n "${BAO_TOKEN:-}" ]]; then
  command -v bao >/dev/null 2>&1 || die "bao CLI not found on PATH (needed when BAO_ADDR is set)."
  op="patch"
  if ! BAO_ADDR="$BAO_ADDR" BAO_TOKEN="$BAO_TOKEN" bao kv metadata get "$bao_path" >/dev/null 2>&1; then
    op="put"
  fi
  # bao kv <op> <path> key=@/dev/stdin reads value from stdin without
  # interpolating into argv. Available since OpenBao 2.x.
  printf '%s' "$value" | BAO_ADDR="$BAO_ADDR" BAO_TOKEN="$BAO_TOKEN" \
    bao kv "$op" "$bao_path" "${key}=-"
  exit
fi

# Fallback: SSH to VM, kubectl exec into openbao-0, run bao.
vm_ip_file="$REPO_ROOT/.local/${env_name}-vm-ip"
ssh_key_file="$REPO_ROOT/.local/${env_name}-vm-key"
root_token_file="$REPO_ROOT/.local/${env_name}-openbao-root-token"
for f in "$vm_ip_file" "$ssh_key_file" "$root_token_file"; do
  [[ -r "$f" ]] || die "Missing $f. Run \`pnpm bootstrap\` (or \`bash scripts/setup/provision-env-vm.sh $env_name\`) first to provision + unseal."
done
vm_ip="$(cat "$vm_ip_file")"
root_token="$(cat "$root_token_file")"

# kubectl exec runs `bao kv patch <path> KEY=-` reading value from stdin.
# Pass the value via stdin all the way through; argv stays clean.
op="patch"
if ! ssh -i "$ssh_key_file" -o StrictHostKeyChecking=accept-new \
  "root@${vm_ip}" \
  "kubectl exec -n openbao openbao-0 -- env BAO_ADDR=http://127.0.0.1:8200 BAO_TOKEN='${root_token}' bao kv metadata get '${bao_path}'" \
  >/dev/null 2>&1; then
  op="put"
fi
printf '%s' "$value" | ssh -i "$ssh_key_file" -o StrictHostKeyChecking=accept-new \
  "root@${vm_ip}" \
  "kubectl exec -i -n openbao openbao-0 -- env BAO_ADDR=http://127.0.0.1:8200 BAO_TOKEN='${root_token}' bao kv '${op}' '${bao_path}' '${key}=-'"
