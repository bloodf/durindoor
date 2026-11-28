Verdict: BLOCKED
PR: #2708
Old head: 5722701a01da2921cf94b37117d511ff58df7180
New side-branch head: 523c39d69992c051e5bd0105b3e4881ecd25052e (sweep/2708)
origin/main: 8cc1101db890fd129f7d078e10a7c139766d359d
Conflicts: none.
All test and lint invocations used env -i, fresh private HOME/DATA_DIR/TMPDIR/XDG_CACHE_HOME and timeout -k 5s 295s.
Commands and results:
- git fetch origin; exit 0.
- git show origin/mac/handoff-orders-fixes-1128:internal/handoff/mac-fixes-1128/f2708.md; exit 0.
- git status --short --branch; git rev-parse origin/mac/2313-refresh-persistence origin/main; git worktree list; exit 0.
- git branch -f sweep/2708 5722701a01da2921cf94b37117d511ff58df7180; git worktree add side and detached base; exit 0.
- Symlink root, tests and CLI node_modules from main checkout into both worktrees; exit 0.
- Base: node node_modules/vitest/vitest.mjs run unit/r2313.test.js --maxWorkers=2; exit 1: 51 passed, 1 failed (review case, expected C2, received C0).
- Base, with all three added tests: same command; exit 1: 51 passed, 3 failed as expected.
- Fixed: node node_modules/vitest/vitest.mjs run unit/r2313.test.js unit/*token-refresh*.test.js unit/*refresh-token*.test.js unit/refresh-*2313.test.js unit/provider-credentials.test.js unit/*copilot*.test.js --maxWorkers=2; exit 1: 29 files passed, 1 failed; 357 tests passed, 2 failed; r2313 54 passed.
- Base: node node_modules/vitest/vitest.mjs run unit/refresh-persist-guard-2313.test.js --maxWorkers=2; exit 1: 7 passed, 2 failed, same failures as fixed run.
- node node_modules/eslint/bin/eslint.js src/sse/services/tokenRefresh.js tests/unit/r2313.test.js; exit 0, twice.
- git diff --check; exit 0. git diff --quiet origin/main -- src/shared/services/providerCredentials.js; exit 0.
- git commit (side branch, requested subject and Refs #2313 body); exit 0.
- git merge-base --is-ancestor 5722701a01da2921cf94b37117d511ff58df7180 sweep/2708; exit 0, before and after removal.
- Removed symlinks, restored scratch test, removed both worktrees; exit 0.
- test -s internal/docs/pr-sweep/mfix-2708.md && grep -q '^Verdict: ' internal/docs/pr-sweep/mfix-2708.md; exit 1: file absent and outside permitted write path.
Findings:
- tests/unit/refresh-persist-guard-2313.test.js:31, P2: existing rotation race expectation fails on both base and fix; reproduce with base guard test command above.
- tests/unit/refresh-persist-guard-2313.test.js:133, P2: existing unusable lifetime expectation fails on both base and fix; reproduce with base guard test command above.
- Required related suite is not green; sentinel file conflicts with the sole authorized unit-branch report path. No push performed.

---

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
