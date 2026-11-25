#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
command -v docker >/dev/null 2>&1 || { echo 'Docker is required for website verification.' >&2; exit 1; }
# Unique names ensure cleanup cannot affect another run or an existing service.
run_id="durindoor-website-verify-$(date +%s)-$$"
image="$run_id:local"
container="$run_id"
artifacts="$(pwd)/website/verification-artifacts/$run_id"
run_root="${DURINDOOR_RUN_ROOT:-${XDG_CACHE_HOME:-$HOME/.cache}/durindoor-runs}/$run_id"
mkdir -p "$run_root/home" "$run_root/pnpm-store" "$run_root/ms-playwright" \
  "$run_root/test-results" "$run_root/artifacts"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker image rm "$image" >/dev/null 2>&1 || true
  if [ -d "$run_root/artifacts" ]; then
    mkdir -p "$artifacts"
    cp -R "$run_root/artifacts/." "$artifacts/"
  fi
  rm -rf "$run_root"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf 'Building verification image %s\n' "$image"
docker build -f website/Dockerfile.verify -t "$image" .
printf 'Running website and Playwright in container %s\n' "$container"
# Playwright starts and stops its own transient server inside the container,
# bound to the container's loopback interface. No host port is published and
# no server outlives the run.
docker run --rm --name "$container" --read-only --init --shm-size=1g \
  --tmpfs /tmp:size=256m \
  -e HOME=/home/run -v "$run_root/home:/home/run" \
  -e npm_config_store_dir=/pnpm/store -v "$run_root/pnpm-store:/pnpm/store" \
  -e PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright \
  -v "$run_root/test-results:/tmp/omc-docs" \
  -v "$run_root/artifacts:/artifacts" "$image" sh -eu -c '
    WEBSITE_VERIFY_SCREENSHOTS=/artifacts/screenshots WEBSITE_REVIEW_SCREENSHOTS=/artifacts/marketing pnpm exec playwright test
  '
printf 'Website verification passed. Artifacts: %s\n' "$artifacts"
