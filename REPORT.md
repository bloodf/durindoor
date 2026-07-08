# Baseline Drain Report: xai-oauth-service

## Scope

- Worktree: `/home/cortexos/Developer/github.com/bloodf/durindoor/.omc/wt-v2-baseline-xai`
- Branch: `fix/v2/baseline-xai` (base `origin/dev` a3c97f2a4)
- Target test file: `tests/unit/xai-oauth-service.test.js`
- Baseline entries removed: **5**

## Baseline Entries Drained

```
tests/unit/xai-oauth-service.test.js :: xai/oauth service builds authorize URLs with CLIProxyAPI query extras
tests/unit/xai-oauth-service.test.js :: xai/oauth service discovers endpoints without custom user-agent headers
tests/unit/xai-oauth-service.test.js :: xai/oauth service exchanges dashboard codes against the discovered xAI token endpoint
tests/unit/xai-oauth-service.test.js :: xai/oauth service generates dashboard auth data with CLIProxyAPI PKCE size and discovered endpoints
tests/unit/xai-oauth-service.test.js :: xai/oauth service validates discovered endpoints are https x.ai URLs
```

## Classification

All five entries classified as **(b) snapshot/baseline drift**. No source-code bug was found and no test rewrite was required.

Evidence:

- After the `node_modules` / `tests/node_modules` symlinks were restored, the targeted test file ran and all five tests passed.
- Source files `src/lib/oauth/services/xai.js` and `src/lib/oauth/providerHelpers.js` match the assertions in the test file (endpoint validation, discovery, authorize URL construction, token exchange, PKCE/discovery wiring).
- No flakiness was observed across the verification run.

## Verification

Exact command specified by the assignment:

```bash
cd /home/cortexos/Developer/github.com/bloodf/durindoor/.omc/wt-v2-baseline-xai/tests
npx vitest run --config vitest.config.js tests/unit/xai-oauth-service.test.js
```

Result:

```
No test files found, exiting with code 1
filter: tests/unit/xai-oauth-service.test.js
include: **/*.test.js
exclude:  **/node_modules/**, **/.claude/**, **/dist/**, **/*.live.test.js
```

The config root is the `tests/` directory, so the filter path must be relative to that root (`unit/...`, not `tests/unit/...`). Targeted verification run:

```bash
cd /home/cortexos/Developer/github.com/bloodf/durindoor/.omc/wt-v2-baseline-xai/tests
npx vitest run --config vitest.config.js unit/xai-oauth-service.test.js
```

Result:

```
 RUN  v4.1.9 /home/cortexos/Developer/github.com/bloodf/durindoor/.omc/wt-v2-baseline-xai/tests

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  23:39:01
   Duration  4.75s (transform 3.26s, setup 0ms, import 106ms, tests 4.41s, environment 0ms)
```

## Diff

```diff
tests/__baseline__/known-fails.txt | 5 -----
1 file changed, 0 insertions(+), 5 deletions(-)

--- Changes ---

File: tests/__baseline__/known-fails.txt
  @@ -41,11 +41,6 @@ tests/unit/oauth-cursor-auto-import.test.js :: GET /api/oauth/cursor/auto-import
  -tests/unit/xai-oauth-service.test.js :: xai/oauth service builds authorize URLs with CLIProxyAPI query extras
  -tests/unit/xai-oauth-service.test.js :: xai/oauth service discovers endpoints without custom user-agent headers
  -tests/unit/xai-oauth-service.test.js :: xai/oauth service exchanges dashboard codes against the discovered xAI token endpoint
  -tests/unit/xai-oauth-service.test.js :: xai/oauth service generates dashboard auth data with CLIProxyAPI PKCE size and discovered endpoints
  -tests/unit/xai-oauth-service.test.js :: xai/oauth service validates discovered endpoints are https x.ai URLs
```

## Summary

- Removed 5 stale `known-fails.txt` entries for `xai-oauth-service.test.js`.
- No source or test changes were required.
- All five previously baselined tests now pass.
- `node_modules` / `tests/node_modules` symlinks were restored to absolute paths for verification but are not part of the commit.
