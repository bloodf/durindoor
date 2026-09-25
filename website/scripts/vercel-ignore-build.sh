#!/usr/bin/env bash
# Vercel "Ignored Build Step" (website/vercel.json ignoreCommand).
# Exit 0 skips the deployment, exit 1 builds it.
#
# Production (main) always builds, so the public site and docs never go stale.
# Preview deployments build only when the change touches docs/ or website/.
# The website also imports dashboard code from src/ and open-sse/; breakage
# there is caught when main builds (the "Website build" CI job and production).
if [ "$VERCEL_ENV" = "production" ] || [ "$VERCEL_GIT_COMMIT_REF" = "main" ]; then
  exit 1
fi

cd "$(git rev-parse --show-toplevel)" || exit 1

# Compare against the last deployed commit when Vercel provides it, else the
# previous commit. If the base is missing from the shallow clone, build.
base="${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}"
git cat-file -e "$base^{commit}" 2>/dev/null || exit 1

if git diff --quiet "$base" HEAD -- docs website; then
  echo "No docs/ or website/ changes since $base; skipping preview."
  exit 0
fi
exit 1
