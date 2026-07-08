# MITM RootCA Baseline Drain Report

## Scope
- Worktree: `/home/cortexos/Developer/github.com/bloodf/durindoor/.omc/wt-v2-baseline-mitm`
- Branch: `fix/v2/baseline-mitm`
- Target files: `tests/unit/mitm-rootca-autogen.test.js`, `tests/unit/mitm-root-ca.test.js`
- Review input: `/.omc/wt-review-3days/.omc/review-3days/01-process.md` (P0 B baseline +16)

## Classification

All 6 listed failures are classified as **(b) snapshot/structural drift**, not source/test bugs.

The two test files are not in the `known-fails.txt` format because they are failing tests; they were added to the baseline because the runner was invoked with project-relative paths from the wrong working directory. When the tests are executed with the correct `unit/*.test.js` paths from the `tests/` directory, all 6 tests pass immediately with no source or test changes.

| Test file | Baseline entries removed | Classification | Fix / Test rewrite |
|-----------|--------------------------|----------------|--------------------|
| `tests/unit/mitm-root-ca.test.js` | 1 | (b) structural drift | none; baseline removal only |
| `tests/unit/mitm-rootca-autogen.test.js` | 5 | (b) structural drift | none; baseline removal only |

## Verification

### Command attempted exactly as requested (from `tests/`)
```bash
cd /home/cortexos/Developer/github.com/bloodf/durindoor/.omc/wt-v2-baseline-mitm/tests && npx vitest run --config vitest.config.js tests/unit/mitm-rootca-autogen.test.js tests/unit/mitm-root-ca.test.js
```
Result: `No test files found, exiting with code 1`. The path arguments are relative to the `tests/` directory, so `tests/unit/...` does not match any file.

### Corrected command (from `tests/`)
```bash
cd /home/cortexos/Developer/github.com/bloodf/durindoor/.omc/wt-v2-baseline-mitm/tests && npx vitest run --config vitest.config.js unit/mitm-rootca-autogen.test.js unit/mitm-root-ca.test.js
```
Result:
```
 RUN  v4.1.9 /home/cortexos/Developer/github.com/bloodf/durindoor/.omc/wt-v2-baseline-mitm/tests

 Test Files  2 passed (2)
      Tests  6 passed (6)
   Start at  23:40:19
   Duration  484ms (transform 57ms, setup 0ms, import 92ms, tests 424ms, environment 0ms)
```

## Net change to `known-fails.txt`

```diff
--- tests/__baseline__/known-fails.txt
+++ tests/__baseline__/known-fails.txt
@@ -21,12 +21,6 @@
-tests/unit/mitm-root-ca.test.js :: MITM Root CA generation creates Root CA files synchronously for direct server startup
-tests/unit/mitm-rootca-autogen.test.js :: MITM Root CA auto-generation (#2224) creates the MITM directory when it does not exist
-tests/unit/mitm-rootca-autogen.test.js :: MITM Root CA auto-generation (#2224) generates rootCA.key and rootCA.crt when both are absent
-tests/unit/mitm-rootca-autogen.test.js :: MITM Root CA auto-generation (#2224) generates when only rootCA.key exists (partial state)
-tests/unit/mitm-rootca-autogen.test.js :: MITM Root CA auto-generation (#2224) is idempotent when valid cert already exists (returns false)
-tests/unit/mitm-rootca-autogen.test.js :: MITM Root CA auto-generation (#2224) regenerates when rootCA.crt is corrupt / unreadable
```

6 entries removed, 0 added, 0 modified. No source or test files changed.
