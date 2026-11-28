Verdict: CHANGES
PR: #2716
Old head: 7f4bb9e84c8e7f5ed37cad4c2e0eca3f21c29268
Side branch: sweep/2716, ad882ca3eb1ad0604c7856c558707613aeb3ccff
origin/main: 8cc1101db890fd129f7d078e10a7c139766d359d
Conflicts: none.
Findings:
- Medium: open-sse/utils/streamHandler.js:160: SSE-lines with a terminal tracker still uses the blank-delimited reader and can accumulate to its limit. Reproduce with a >64 MiB stream of data lines without blank delimiters.
- Medium: tests/unit/s2302.test.js:250: UTF-8 tail test passes on the old head; it does not exercise streamingHandler's end/abort callback wiring. Reproduce with the base Vitest command below.
- Report instruction conflict: done-when requires internal/docs/pr-sweep/mfix-2716.md, while the write allowlist permits only prepare-2627.md. The required file is absent.
Retained bytes: NDJSON path constructs no SSE pending reader (0 bytes there); test sends complete 1036-byte lines, so line framer retains 0 bytes between pushes. No heap measurement taken.
Commands (tests and eslint used env -i, private HOME/DATA_DIR/TMPDIR/XDG_CACHE_HOME and timeout -k 5s 295s):
- git fetch origin: 0.
- git show origin/mac/handoff-orders-fixes-1128:internal/handoff/mac-fixes-1128/f2716.md: 0.
- git status/rev-parse/worktree list and branch inspection: 0; remote old head matched.
- git worktree add /var/tmp/durindoor-mfix-2716 sweep/2716 and dependency symlinks: 0.
- git worktree add --detach /var/tmp/durindoor-mfix-2716-base 7f4bb9e84c8e7f5ed37cad4c2e0eca3f21c29268, symlinks and copy test: 0.
- Base: cd tests && node node_modules/vitest/vitest.mjs run unit/s2302.test.js --maxWorkers=2: 1; 22 passed, 2 failed (NDJSON limit and trailing newline); UTF-8 test passed.
- Side: cd tests && node node_modules/vitest/vitest.mjs run unit/s2302.test.js unit/review-x-sse-final.test.js unit/review-x-core-layering.test.js unit/proxy-timeline*.test.js unit/ollama*.test.js unit/chatgpt-web-http*.test.js unit/stream*.test.js --maxWorkers=2: 0; 51 files, 728 tests passed.
- node node_modules/eslint/bin/eslint.js on the five changed files: 0.
- git commit with requested subject and body: 0.
- git merge-base --is-ancestor 7f4bb9e84c8e7f5ed37cad4c2e0eca3f21c29268 sweep/2716: 0.
- git worktree remove first attempt: 128, dependency symlinks present; removed symlinks and restored scratch test, then removed both worktrees: 0.
- test -s internal/docs/pr-sweep/mfix-2716.md && grep -q '^Verdict: ' internal/docs/pr-sweep/mfix-2716.md: 1 (absent).
