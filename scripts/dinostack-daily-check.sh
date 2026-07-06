#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# dinostack-daily-check.sh
#
# Daily cron entrypoint for the DurinDoor Hermes profile's "must always
# update daily" DinoStack requirement (AGENTS.md §6.6).
#
# Behavior (contract-compatible with AGENTS.md §6.4 / §7):
#   - If ~/.config/cortexos/dinostack.env sets DSTACK_AUTO_UPDATE=disabled,
#     exit 0 with a log line. The env file is the kill switch — no need to
#     edit the crontab.
#   - git ls-remote https://github.com/Space-Dinosaurs/DinoStack HEAD
#   - Parse the recorded SHA from AGENTS.md §6.4 (single line, marked
#     "Last verified:").
#   - If they match: log "in sync", exit 0. Nothing else happens.
#   - If they differ: invoke scripts/dinostack-daily-check.py with both
#     SHAs and the AGENTS.md path. The Python script opens a PR that
#     updates §6.4 to the new SHA, with a one-line diff summary. The cron
#     itself NEVER git-pulls, NEVER re-runs the install, NEVER direct-pushes
#     to dev. A human merges the PR; the next install run (manual or
#     otherwise) updates the live symlink.
#
# Logs to ~/.local/share/dinostack/var/update-check.log with one line per
# run: ISO8601 timestamp, recorded SHA, observed SHA, action.
#
# Crontab (user crontab, install once):
#   0 6 * * * /home/<user>/Developer/github.com/bloodf/durindoor/scripts/dinostack-daily-check.sh
# Choose a quiet hour; 06:00 local is fine.
# ---------------------------------------------------------------------------
set -euo pipefail

# Resolve repo root from the script's own path so the cron works regardless
# of where the crontab was installed from. Falls back to $HOME if the script
# is not inside the repo (cron-friendly: never errors out the host).
SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
REPO_ROOT_DEFAULT="$(cd "$(dirname "$SCRIPT_PATH")/.." 2>/dev/null && pwd || true)"
REPO_ROOT="${DSTACK_REPO_ROOT:-$REPO_ROOT_DEFAULT}"
AGENTS_MD="${REPO_ROOT:-$HOME}/AGENTS.md"

LOG_DIR="${DSTACK_LOG_DIR:-$HOME/.local/share/dinostack/var}"
LOG_FILE="$LOG_DIR/update-check.log"
mkdir -p "$LOG_DIR"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { printf '%s  %s\n' "$(ts)" "$*" >> "$LOG_FILE"; }

# Kill switch: env file, optional, sourced if present.
ENV_FILE="${DSTACK_ENV_FILE:-$HOME/.config/cortexos/dinostack.env}"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
fi

if [[ "${DSTACK_AUTO_UPDATE:-enabled}" == "disabled" ]]; then
  log "skip: DSTACK_AUTO_UPDATE=disabled (env file: $ENV_FILE)"
  exit 0
fi

if [[ ! -f "$AGENTS_MD" ]]; then
  log "skip: AGENTS.md not found at $AGENTS_MD"
  exit 0
fi

# Fetch upstream HEAD SHA.
OBSERVED_SHA="$(git ls-remote https://github.com/Space-Dinosaurs/DinoStack HEAD 2>/dev/null | awk '{print $1}')"
if [[ -z "$OBSERVED_SHA" ]]; then
  log "error: git ls-remote returned empty (network or rate limit); will retry tomorrow"
  exit 0
fi

# Parse the recorded SHA from AGENTS.md §6.4. The SHA is on the SAME line as
# "Last verified:", inside backticks (e.g. `- **Last verified:** \`abc...\``).
# Match the line, then pull out the first 40-hex token. Robust to a trailing
# punctuation or an em-dash, but refuses to return a non-SHA-shaped value.
RECORDED_SHA="$(grep -m1 'Last verified' "$AGENTS_MD" 2>/dev/null \
                | grep -oE '[0-9a-f]{40}' \
                | head -n1)"

# If the marker is split across two lines (some markdown renderers), fall
# back to looking on the next line for a 40-hex token.
if [[ -z "$RECORDED_SHA" ]]; then
  RECORDED_SHA="$(grep -m1 -A1 'Last verified' "$AGENTS_MD" 2>/dev/null \
                  | tail -n1 \
                  | grep -oE '[0-9a-f]{40}' \
                  | head -n1)"
fi

if [[ -z "$RECORDED_SHA" ]]; then
  log "error: could not parse 'Last verified' SHA from $AGENTS_MD; leaving cron disabled until AGENTS.md is fixed"
  exit 0
fi

if [[ "$OBSERVED_SHA" == "$RECORDED_SHA" ]]; then
  log "in-sync: recorded=$RECORDED_SHA observed=$OBSERVED_SHA"
  exit 0
fi

# Drift detected. Delegate to the Python script for the PR.
log "drift: recorded=$RECORDED_SHA observed=$OBSERVED_SHA; opening PR via dinostack-daily-check.py"

PY_SCRIPT="${REPO_ROOT:-$HOME/Developer/github.com/bloodf/durindoor}/scripts/dinostack-daily-check.py"
if [[ ! -f "$PY_SCRIPT" ]]; then
  log "error: $PY_SCRIPT not found; cannot open PR"
  exit 0
fi

# Don't `tee`; the python script writes its own log lines via log_line().
# We capture stdout/stderr so the cron is silent on success, and any non-zero
# exit from the python script becomes a log entry.
python3 "$PY_SCRIPT" \
  --recorded "$RECORDED_SHA" \
  --observed "$OBSERVED_SHA" \
  --agents-md "$AGENTS_MD" \
  --repo-root "$REPO_ROOT" \
  --log-file "$LOG_FILE" >> "$LOG_FILE" 2>&1 || \
  log "error: dinostack-daily-check.py exited non-zero (see log tail above)"

exit 0
