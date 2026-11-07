#!/usr/bin/env bash
# Build the upstream scan report: every OPEN upstream PR that has NOT already
# been ported into this fork, with no truncation.
#
#   upstream-scan-report.sh <upstream-prs.json> <ported.json> <outdir>
#   upstream-scan-report.sh --intake <candidates.json> <outdir> [ported.json] [page-bytes]
#
# Classic mode:
# <upstream-prs.json>  `gh pr list` output (number,title,additions,deletions)
# <ported.json>        JSON array of upstream PR numbers already ported here
# <outdir>             receives body.md plus comment-NNN.md continuation pages
#
# Intake mode (Issue #1148):
# Extends intake design across both decolua/9router and diegosouzapw/OmniRoute,
# storing source SHA, state, final diff, local equivalent, test, disposition,
# and owner issue records, with multi-page pagination under GitHub body limits.
#
# GitHub caps an issue body (and each comment) at 65536 bytes, so the candidate
# list is paginated instead of cut off: body.md holds the summary and the first
# page, each remaining page becomes a comment. The union of body.md and every
# comment-NNN.md contains the complete unported set.
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<'EOF'
Usage:
  upstream-scan-report.sh <upstream-prs.json> <ported.json> <outdir>
  upstream-scan-report.sh --intake <candidates.json> <outdir> [ported.json] [page-bytes]

Modes:
  Classic mode:
    Scans open upstream PRs from decolua/9router, subtracting ported IDs.
  Intake mode (Issue #1148):
    Tracks candidates across decolua/9router and diegosouzapw/OmniRoute with
    complete reviewed records (source, SHA, state, finalDiff, localEquivalent,
    test, disposition, ownerIssue) and pagination under GitHub's 65,536-byte limit.
EOF
  exit 0
fi

if [ "${1:-}" = "--intake" ]; then
  shift
  CANDIDATES_JSON=${1:?usage: upstream-scan-report.sh --intake <candidates.json> <outdir> [ported.json] [page-bytes]}
  OUTDIR=${2:?missing outdir}
  PORTED_JSON=${3:-}
  PAGE_BYTES=${4:-${PAGE_BYTES:-60000}}

  HELPER="$(dirname "$0")/upstream-intake-ledger.mjs"
  CMD=(node "$HELPER" build-report --candidates "$CANDIDATES_JSON" --outdir "$OUTDIR" --page-bytes "$PAGE_BYTES")
  if [ -n "$PORTED_JSON" ]; then
    CMD+=(--ported "$PORTED_JSON")
  fi
  exec "${CMD[@]}"
fi

PRS_JSON=${1:?usage: upstream-scan-report.sh <upstream-prs.json> <ported.json> <outdir>}
PORTED_JSON=${2:?missing ported.json}
OUTDIR=${3:?missing outdir}

# Leave headroom under the 65536-byte cap for the summary header and page footer.
PAGE_BYTES=${PAGE_BYTES:-60000}

mkdir -p "$OUTDIR"
rm -f "$OUTDIR"/body.md "$OUTDIR"/comment-*.md "$OUTDIR"/chunk-*.md "$OUTDIR"/new-prs.json

TOTAL=$(jq 'length' "$PRS_JSON")

# Subtract the ported set. `. as $pr` binds the PR before descending into
# $ported, otherwise `.number` would resolve against the ported array.
jq --slurpfile ported "$PORTED_JSON" \
  '[.[] | . as $pr | select($ported[0] | any(. == $pr.number) | not)]' \
  "$PRS_JSON" > "$OUTDIR/new-prs.json"

NEW=$(jq 'length' "$OUTDIR/new-prs.json")
PORTED_COUNT=$((TOTAL - NEW))

if [ "$NEW" -eq 0 ]; then
  printf 'No unported upstream PRs. Scanned %s open PRs from decolua/9router; all %s are already ported.\n' \
    "$TOTAL" "$PORTED_COUNT" > "$OUTDIR/body.md"
  echo "total=$TOTAL ported=$PORTED_COUNT new=0 pages=1"
  exit 0
fi

# Newest first so the freshest candidates lead the report.
jq -r 'sort_by(-.number)[] | "- #\(.number) +\(.additions)/-\(.deletions): \(.title)"' \
  "$OUTDIR/new-prs.json" > "$OUTDIR/lines.txt"

# LC_ALL=C makes awk's length() count bytes, matching GitHub's byte limit.
LC_ALL=C awk -v max="$PAGE_BYTES" -v out="$OUTDIR" '
  BEGIN { idx = 0; len = 0 }
  {
    l = length($0) + 1
    if (len + l > max && len > 0) { idx++; len = 0 }
    printf "%s\n", $0 >> sprintf("%s/chunk-%03d.md", out, idx)
    len += l
  }
' "$OUTDIR/lines.txt"

PAGES=$(find "$OUTDIR" -maxdepth 1 -name 'chunk-*.md' | wc -l | tr -d ' ')

{
  printf 'Scanned %s open upstream PRs from decolua/9router: %s already ported here, **%s unported**.\n' \
    "$TOTAL" "$PORTED_COUNT" "$NEW"
  if [ "$PAGES" -gt 1 ]; then
    printf '\nListing all %s across %s pages (page 1 below, the rest as comments).\n' "$NEW" "$PAGES"
  fi
  printf '\n'
  cat "$OUTDIR/chunk-000.md"
} > "$OUTDIR/body.md"

page=1
for chunk in "$OUTDIR"/chunk-*.md; do
  [ "$chunk" = "$OUTDIR/chunk-000.md" ] && continue
  page=$((page + 1))
  {
    printf 'Unported upstream PRs — page %s of %s\n\n' "$page" "$PAGES"
    cat "$chunk"
  } > "$(printf '%s/comment-%03d.md' "$OUTDIR" "$page")"
done

echo "total=$TOTAL ported=$PORTED_COUNT new=$NEW pages=$PAGES"
