#!/bin/sh
set -u
cd "$(dirname "$0")/.." || exit 1
mode=${1:-}
case "$mode" in unit|final) ;; *) echo "Usage: $0 unit|final" >&2; exit 2 ;; esac
failed=0
run() {
  echo "+ $*"
  timeout 300 "$@" || { echo "FAILED: $*" >&2; failed=1; }
}
if [ "$mode" = final ]; then
  run pnpm run lint
  # test:ci enforces the 300 s ceiling per batch; an outer timeout would kill the whole run.
  echo "+ cd tests && pnpm run test:ci"
  (cd tests && pnpm run test:ci) || { echo 'FAILED: test:ci' >&2; failed=1; }
  exit "$failed"
fi
work=$(mktemp -d) || exit 1
trap 'rm -rf "$work"' EXIT HUP INT TERM
if [ "${ORQ_CHANGED_FILES+x}" = x ]; then
  cp -- "$ORQ_CHANGED_FILES" "$work/files" || exit 1
else
  base=$(git merge-base HEAD origin/main) || exit 1
  git diff --name-only --diff-filter=AMR "$base" HEAD > "$work/files" || exit 1
fi
node scripts/checks-select.mjs "$work/files" > "$work/selection" || exit 1
for kind in eslint tests related; do
  node -e 'const fs = require("fs"); const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(data[process.argv[2]].join("\n"));' "$work/selection" "$kind" > "$work/$kind" || exit 1
done
set --
while IFS= read -r file || [ -n "$file" ]; do [ -z "$file" ] || set -- "$@" "$file"; done < "$work/eslint"
if [ "$#" -gt 0 ]; then run pnpm exec eslint "$@"; fi
# Oxlint checks repository source, excluding tests and vendored/generated files.
if node -e 'const fs=require("fs"); const files=fs.readFileSync(process.argv[1],"utf8").split(/\r?\n/); process.exit(files.some(f => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(f) && !/^(tests|tools\/oxlint\/anti-slop|node_modules|website\/node_modules)\//.test(f) && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(f)) ? 0 : 1)' "$work/files"; then
  run pnpm run lint:anti-slop
fi
set --
while IFS= read -r file || [ -n "$file" ]; do [ -z "$file" ] || set -- "$@" "$file"; done < "$work/tests"
if [ "$#" -gt 0 ]; then
  (cd tests && timeout 300 node node_modules/vitest/vitest.mjs run --passWithNoTests --maxWorkers=50% "$@") || { echo 'FAILED: selected tests' >&2; failed=1; }
fi
set --
while IFS= read -r file || [ -n "$file" ]; do [ -z "$file" ] || set -- "$@" "../$file"; done < "$work/related"
if [ "$#" -gt 0 ]; then
  (cd tests && timeout 300 node node_modules/vitest/vitest.mjs related --run --passWithNoTests --maxWorkers=50% "$@") || { echo 'FAILED: related tests' >&2; failed=1; }
fi
exit "$failed"
