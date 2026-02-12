#!/bin/bash
# Script: services/sandbox-openclaw/seed-pnpm-store.sh
# Purpose: Idempotent seeding of a pnpm_store Docker volume from a pre-built store image.
# Invariants:
#   - Creates volume if missing
#   - Skips if /mnt/target/.lockhash matches image /workspace/.lockhash
#   - Otherwise copies /pnpm-store/. into volume and writes .lockhash sentinel
# Notes:
#   - Used by both local dev (pnpm sandbox:pnpm-store:seed) and deploy (seed-pnpm-store.sh)
#   - Requires docker CLI
# Links: work/items/task.0031.openclaw-cogni-dev-image.md

set -euo pipefail

usage() {
  echo "Usage: $0 --image <image> --volume <volume>"
  echo "  --image   Docker image containing /pnpm-store and /workspace/.lockhash"
  echo "  --volume  Docker named volume to seed"
  exit 1
}

IMAGE=""
VOLUME=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image) IMAGE="$2"; shift 2 ;;
    --volume) VOLUME="$2"; shift 2 ;;
    *) usage ;;
  esac
done

[[ -z "$IMAGE" || -z "$VOLUME" ]] && usage

SENTINEL="/mnt/target/.lockhash"

# Ensure volume exists
docker volume inspect "$VOLUME" &>/dev/null || docker volume create "$VOLUME"

# --entrypoint sh: bypass sandbox-entrypoint.sh which prints to stdout and garbles output
# --user root: image defaults to sandboxer (1001:1001) but fresh volumes are root-owned
IMAGE_HASH=$(docker run --rm --user root --entrypoint sh "$IMAGE" -c "cat /workspace/.lockhash 2>/dev/null || echo none")
VOLUME_HASH=$(docker run --rm --user root --entrypoint sh -v "${VOLUME}:/mnt/target" "$IMAGE" -c "cat $SENTINEL 2>/dev/null || echo none")

if [[ "$IMAGE_HASH" == "$VOLUME_HASH" ]]; then
  echo "[INFO] pnpm_store already seeded (hash: ${VOLUME_HASH}), skipping"
  exit 0
fi

echo "[INFO] Seeding ${VOLUME} (image hash: ${IMAGE_HASH}, volume hash: ${VOLUME_HASH})..."
docker run --rm --user root --entrypoint sh -v "${VOLUME}:/mnt/target" "$IMAGE" \
  -c "cp -a /pnpm-store/. /mnt/target/ && cp /workspace/.lockhash $SENTINEL"
echo "[INFO] ${VOLUME} seeded successfully (hash: ${IMAGE_HASH})"
