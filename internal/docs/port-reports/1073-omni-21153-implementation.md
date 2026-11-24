# OmniRoute #21153 stream color adaptation

Status: implementation in this checkout; no DurinDoor PR link has been recorded, so this is not a completed port.

Upstream [PR #21153](https://github.com/cheaper-inference/OmniRoute/pull/21153) was re-fetched on 2026-11-24. It is merged at `92f696203921581a4b0e1334beafa8e8c0c8006b`, with final head `1f47a122873e86118d324d64b9acdf8797e6ff22`. It colors stream outcomes and adds `APP_LOG_COLORS` with TTY and `NO_COLOR` fallback. The local controller previously emitted plain `DISCONNECT`, `ABORTED`, and `ERROR` labels, and had no such control. Local normal completion has no controller status line; its existing completion summary stays unchanged.

The local implementation colors only those existing labels, yellow for disconnect and abort and red for error. Details, log level selection, callbacks, abort handling, and completion remain unchanged. The control accepts upstream's true and false values, with explicit values taking precedence over TTY and `NO_COLOR`. The dashboard capture in `src/lib/consoleLogBuffer.js` already strips ANSI sequences. This does not assert behavior for external log collectors; non-TTY output remains plain unless forced.

The 2026-11-24 open DurinDoor PR search found no changed stream handler or stream status color file. Other open PRs touch the shared environment reference, so the operator note is separate. Worktree status inspection found no active uncommitted edits to the target files. These checks are point-in-time evidence.

Verification: with private HOME, DATA_DIR and cache and an empty inherited environment, `cd tests && node node_modules/vitest/vitest.mjs run unit/stream-status-colors.test.js unit/streaming-interrupted-detail.test.js --maxWorkers=2` passed both files. The new file covers force-on and force-off values, TTY and NO_COLOR fallback, controller output and callbacks, completion, and fallback output; the existing file covers interrupted-stream accounting. The first run failed before collection because root dependencies were missing; after root and CLI installation the focused run passed. Full CI and independent review have not been run.
