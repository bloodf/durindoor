#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
command -v docker >/dev/null 2>&1 || { echo 'Docker is required for website verification.' >&2; exit 1; }
# Unique names ensure cleanup cannot affect another run or an existing service.
run_id="durindoor-website-verify-$(date +%s)-$$"
image="$run_id:local"
container="$run_id"
artifacts="$(pwd)/website/verification-artifacts/$run_id"
mkdir -p "$artifacts"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker image rm "$image" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf 'Building verification image %s\n' "$image"
docker build -f website/Dockerfile.verify -t "$image" .
printf 'Running website and Playwright in container %s\n' "$container"
docker run --name "$container" --init --shm-size=1g \
  -v "$artifacts:/artifacts" "$image" sh -eu -c '
    pnpm run start > /artifacts/server.log 2>&1 &
    server=$!
    trap "kill $server 2>/dev/null || true" EXIT
    node -e '\''(async () => { for (let i = 0; i < 120; i++) { try { if ((await fetch("http://127.0.0.1:3000/")).ok) return; } catch {} await new Promise(r => setTimeout(r, 1000)); } process.exit(1); })()'\''
    DOCS_BASE_URL=http://127.0.0.1:3000 WEBSITE_VERIFY_SCREENSHOTS=/artifacts/screenshots WEBSITE_REVIEW_SCREENSHOTS=/artifacts/marketing pnpm exec playwright test
  '
printf 'Website verification passed. Artifacts: %s\n' "$artifacts"
