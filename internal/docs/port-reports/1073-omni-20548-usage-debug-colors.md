# OmniRoute #20548: verbose usage debug colors

Status: local implementation, not a completed port. No PR link exists yet.

The row 91 comparison identified a cosmetic gap in `logUsage`. The upstream commit [0813d37fd50687327c6510cebcf50c343f4a790b](https://github.com/cheaper-inference/OmniRoute/commit/0813d37fd50687327c6510cebcf50c343f4a790b) moves the reset to the end of the line and restores green after the yellow estimated marker. Its diff was fetched and inspected on 2026-11-24.

At this checkout's starting HEAD, `logUsage` reset the color after the account and again after the estimated marker, leaving cache and reasoning fields uncolored. The logger returns before printing unless `LOG_USAGE_VERBOSE=1`. The open DurinDoor PR list had no PR touching `open-sse/utils/usageTracking.js`, and no listed worktree had uncommitted edits to that file when checked. Other orchestrators' files were left alone.

The local change applies the upstream formatting to DurinDoor's existing fields. It does not change token selection or persistence. The logger has no built-in environment switch for disabling ANSI colors; the focused test also checks plain output when its exported color codes are empty. Focused tests cover verbose output, the estimated marker, cache and reasoning fields, disabled verbose logging, plain colors, and preservation of the input object.

Validation: starting HEAD `3720b5f00fc1a78de04ae44a798cc24d77ecfdf5`; local `origin/main` was `707303379a53d4c189d28c9f4351b71198f0e403`. From `tests/`, `node node_modules/vitest/vitest.mjs run unit/omni-20548-usage-debug-color.test.js --maxWorkers=2` passed all three tests with private HOME, DATA_DIR and cache. `git diff --check` passed. The full CI and independent review required for a PR merge have not been run.
