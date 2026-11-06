#!/bin/sh
# Run from any directory with the repository's reviewed CodeGraph version.
set -eu
codegraph_root=$(CDPATH= cd "$(dirname "$0")/.." && pwd)
cd "$codegraph_root"
codegraph_expected=$(cat .codegraph-version)
if ! command -v codegraph >/dev/null 2>&1; then
  echo "CodeGraph $codegraph_expected required. See internal/docs/ai-tooling.md." >&2
  exit 1
fi
codegraph_actual=$(codegraph --version)
if [ "$codegraph_actual" != "$codegraph_expected" ]; then
  echo "CodeGraph $codegraph_expected required; found $codegraph_actual. See internal/docs/ai-tooling.md." >&2
  exit 1
fi
export CODEGRAPH_TELEMETRY=0
exec codegraph "$@"
