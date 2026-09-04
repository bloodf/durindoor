#!/usr/bin/env bash
# Emit the set of upstream (decolua/9router) PR numbers already ported into this
# fork, as a sorted JSON array.
#
#   upstream-ported-ids.sh [repo-root] > ported.json
#
# Two evidence sources, unioned:
#
#   1. Commit subjects  `port(upstream): #N - ...`
#      Only the FIRST #N counts; a trailing `(#123)` is our own squash number.
#
#   2. .github/upstream-ported.json `ported[].pr`
#      Reviewed ledger for PRs with no `port(upstream)` subject of their own:
#      ported inside a commit naming a different number, or implemented
#      independently rather than cherry-picked. Both count as ported — the scan
#      exists to surface work NOT yet made here.
#
# CHANGELOG prose is deliberately NOT parsed: it says "Independent of #3500" for
# behavior that IS implemented and tested in this fork, so a naive parser would
# both mislabel real ports and hide real candidates. Membership is decided by
# reviewed evidence in the ledger.
set -euo pipefail

ROOT=${1:-.}
LEDGER="$ROOT/.github/upstream-ported.json"

{
  git -C "$ROOT" log --format='%s' \
    | sed -nE 's/^port\(upstream\): #([0-9]+).*/\1/p'

  if [ -f "$LEDGER" ]; then
    jq -r '.ported[].pr' "$LEDGER"
  fi
} | sort -un | jq -Rn '[inputs | tonumber]'
