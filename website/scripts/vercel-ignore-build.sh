#!/usr/bin/env bash
# Exit 0 cancels, exit 1 builds. Git branch controls prevent preview creation;
# this second gate skips unchanged main deployments. See internal/docs/deploy-gates.md.
if [ "${VERCEL_GIT_COMMIT_REF:-}" != "main" ] || [ "${VERCEL_ENV:-}" != "production" ]; then
  echo "Skipping deployment outside production main."
  exit 0
fi

export GIT_NO_LAZY_FETCH=1
cd "$(git rev-parse --show-toplevel)" || exit 0

# Never substitute HEAD^: several commits may have landed since the last build.
base="${VERCEL_GIT_PREVIOUS_SHA:-}"
if ! [[ "$base" =~ ^[0-9a-fA-F]{40}$ ]] || ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  echo "Skipping production main: previous successful deployment SHA is absent or unavailable; operator review required."
  exit 0
fi
if [ -n "${VERCEL_GIT_COMMIT_SHA:-}" ] && [ "$VERCEL_GIT_COMMIT_SHA" != "$(git rev-parse HEAD)" ]; then
  echo "Skipping production main: checkout does not match Vercel commit metadata."
  exit 0
fi
if ! git merge-base --is-ancestor "$base" HEAD; then
  echo "Skipping production main: previous deployment ancestry cannot be verified."
  exit 0
fi

inputs=(src open-sse public scripts patches
  package.json package-lock.json npm-shrinkwrap.json pnpm-lock.yaml pnpm-workspace.yaml
  yarn.lock bun.lock bun.lockb .npmrc .nvmrc .node-version .tool-versions
  jsconfig.json tsconfig.json vercel.json .vercelignore
  ':(top,glob)next.config.*' ':(top,glob)postcss.config.*' ':(top,glob)tailwind.config.*'
  ':(top,glob).env*')
case "${1:-website}" in
  website) inputs+=(website docs assets/brand) ;;
  app) inputs+=(':(top,glob)*.js' ':(top,glob)*.mjs' ':(top,glob)*.cjs') ;;
  *) echo "Unknown project root; operator review required."; exit 0 ;;
esac

# Disabling rename detection checks both old and new paths, including deletions.
git diff --quiet --no-ext-diff --no-textconv --no-renames "$base" HEAD -- "${inputs[@]}"
result=$?
if [ "$result" -eq 0 ]; then
  echo "Skipping production main: no ${1:-website} inputs changed since $base."
  exit 0
fi
if [ "$result" -ne 1 ]; then
  echo "Skipping production main: Git diff failed with status $result; operator review required."
  exit 0
else
  echo "Building production main: ${1:-website} inputs changed since $base."
fi
exit 1
