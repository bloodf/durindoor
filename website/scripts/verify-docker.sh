#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
command -v docker >/dev/null 2>&1 || { echo 'Docker is required for website verification.' >&2; exit 1; }
# Unique names ensure cleanup cannot affect another run or an existing service.
run_id="durindoor-website-verify-$(date +%s)-$$"
lock_hash=$(sha256sum website/pnpm-lock.yaml website/Dockerfile.verify | sha256sum | cut -c1-16)
image="durindoor-website-base:$lock_hash"
container="$run_id"
artifacts="$(pwd)/website/verification-artifacts/$run_id"
run_root="${DURINDOOR_RUN_ROOT:-${XDG_CACHE_HOME:-$HOME/.cache}/durindoor-runs}/$run_id"
mkdir -p "$run_root/home" "$run_root/pnpm-store" "$run_root/ms-playwright" \
  "$run_root/test-results" "$run_root/artifacts" "$run_root/website"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  if [ -d "$run_root/artifacts" ]; then
    mkdir -p "$artifacts"
    cp -R "$run_root/artifacts/." "$artifacts/"
  fi
  rm -rf "$run_root"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if ! docker image inspect "$image" >/dev/null 2>&1; then
  printf 'Building verification base image %s\n' "$image"
  docker build -f website/Dockerfile.verify --label durindoor.base=website -t "$image" .
fi
# Remove only old tags carrying our label, keeping the current base.
cutoff=$(date -u -d '7 days ago' +%s)
docker image ls --filter label=durindoor.base=website --format '{{.Repository}}:{{.Tag}}' | while IFS= read -r old_image; do
  [ "$old_image" = "$image" ] && continue
  case "$old_image" in *:'<none>') continue ;; esac
  created=$(docker image inspect --format '{{.Created}}' "$old_image")
  created_epoch=$(date -u -d "$created" +%s)
  if [ "$created_epoch" -lt "$cutoff" ]; then
    docker image rm "$old_image"
  fi
done
# Generated public assets, styles and build output live only in this run.
tar -C website --exclude='./node_modules' --exclude='./.next' --exclude='./verification-artifacts' -cf - . | tar -C "$run_root/website" -xf -
printf 'Running website and Playwright in container %s\n' "$container"
# Playwright starts and stops its own transient server inside the container,
# bound to the container's loopback interface. No host port is published and
# no server outlives the run.
docker run --rm --name "$container" --read-only --init --shm-size=1g \
  --tmpfs /tmp:size=256m \
  -v "$(pwd):/repo:ro" -v "$run_root/website:/repo/website" \
  -e HOME=/home/run -v "$run_root/home:/home/run" \
  -e npm_config_store_dir=/pnpm/store -v "$run_root/pnpm-store:/pnpm/store" \
  -e PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright \
  -v "$run_root/test-results:/tmp/omc-docs" \
  -v "$run_root/artifacts:/artifacts" "$image" sh -eu -c '
    ln -s /deps node_modules
    pnpm exec fumadocs-mdx source.config.mjs
    pnpm run build
    WEBSITE_VERIFY_SCREENSHOTS=/artifacts/screenshots WEBSITE_REVIEW_SCREENSHOTS=/artifacts/marketing pnpm exec playwright test
  '
printf 'Website verification passed. Artifacts: %s\n' "$artifacts"
