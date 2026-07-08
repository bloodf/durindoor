# Drain Report: translator-request-normalization baseline regressions

**Worktree:** `/home/cortexos/Developer/github.com/bloodf/durindoor/.omc/wt-v2-baseline-translator-norm`  
**Branch:** `fix/v2/baseline-translator-norm`  
**Review source:** `/home/cortexos/Developer/github.com/bloodf/durindoor/.omc/wt-review-3days/.omc/review-3days/01-process.md`, `baseline-stats.txt`  

## Scope

Drain the 4 `known-fails.txt` entries added in the 3-day window for `tests/unit/translator-request-normalization.test.js`:

1. `request normalization claudeToOpenAIRequest flattens text-only content arrays into string`
2. `request normalization filterToOpenAIFormat flattens text-only arrays to string`
3. `request normalization parseSSELine supports provider raw NDJSON stream lines`
4. `request normalization translateRequest keeps /v1/messages Claude->OpenAI text payloads string-safe`

## Classification

All four entries were **stale baseline entries** — the source code already supports the expected behavior, and the tests pass without modification.

| # | Test | Expected behavior | Why it was already passing |
|---|------|-------------------|----------------------------|
| 1 | `claudeToOpenAIRequest flattens text-only content arrays into string` | Arrays containing only text blocks should collapse to a single `\n`-joined string. | `open-sse/translator/request/claude-to-openai.js` uses `collapseTextParts(parts)` from `open-sse/translator/concerns/message.js`, which joins text-only arrays with `\n`. |
| 2 | `filterToOpenAIFormat flattens text-only arrays to string` | Same flattening when filtering an OpenAI-format body. | `open-sse/translator/formats/openai.js` also uses `collapseTextParts(parts)` for array content. |
| 3 | `parseSSELine supports provider raw NDJSON stream lines` | Lines starting with `{` should be parsed as raw JSON without a `data:` prefix. | `open-sse/utils/streamHelpers.js` `parseSSELine` checks `trimmed.startsWith("{")` and returns `JSON.parse(trimmed)` before the SSE path. |
| 4 | `translateRequest keeps /v1/messages Claude->OpenAI text payloads string-safe` | Claude text message arrays translated to OpenAI remain strings. | `translateRequest` delegates to the same `claudeToOpenAIRequest` path, which calls `collapseTextParts`. |

No source or test changes were required.

## Test output

The exact acceptance command:

```
cd /home/cortexos/Developer/github.com/bloodf/durindoor/.omc/wt-v2-baseline-translator-norm/tests && npx vitest run --config vitest.config.js tests/unit/translator-request-normalization.test.js 2>&1 | tail -30
```

fails because the filter is interpreted relative to the `tests/` directory:

```
 RUN  v4.1.9 /home/cortexos/Developer/github.com/bloodf/durindoor/.omc/wt-v2-baseline-translator-norm/tests

No test files found, exiting with code 1

filter: tests/unit/translator-request-normalization.test.js
include: **/*.test.js
exclude:  **/node_modules/**, **/.claude/**, **/dist/**, **/*.live.test.js, **/embeddings.cloud.test.js
```

Running the same command with a path relative to the `tests/` directory:

```
cd /home/cortexos/Developer/github.com/bloodf/durindoor/.omc/wt-v2-baseline-translator-norm/tests && npx vitest run --config vitest.config.js unit/translator-request-normalization.test.js 2>&1 | tail -30
```

passes:

```
 RUN  v4.1.9 /home/cortexos/Developer/github.com/bloodf/durindoor/.omc/wt-v2-baseline-translator-norm/tests


 Test Files  1 passed (1)
      Tests  8 passed (8)
   Start at  23:40:04
   Duration  1.03s (transform 599ms, setup 0ms, import 862ms, tests 9ms, environment 0ms)

EXIT:0
```

## Diff

```diff
diff --git a/tests/__baseline__/known-fails.txt b/tests/__baseline__/known-fails.txt
index 0a0cbe0..6a6e8f2 100644
--- a/tests/__baseline__/known-fails.txt
+++ b/tests/__baseline__/known-fails.txt
@@ -28,10 +28,6 @@ tests/unit/mitm-rootca-autogen.test.js :: MITM Root CA auto-generation (#2224) g
-tests/unit/translator-request-normalization.test.js :: request normalization claudeToOpenAIRequest flattens text-only content arrays into string
-tests/unit/translator-request-normalization.test.js :: request normalization filterToOpenAIFormat flattens text-only arrays to string
-tests/unit/translator-request-normalization.test.js :: request normalization parseSSELine supports provider raw NDJSON stream lines
-tests/unit/translator-request-normalization.test.js :: request normalization translateRequest keeps /v1/messages Claude->OpenAI text payloads string-safe
 tests/unit/kiro-region.test.js :: fetchKiroProfileArn region host queries us-east-1 codewhisperer by default
```

## Net known-fails change

- `tests/__baseline__/known-fails.txt`: `-4` entries.
- No other baseline entries touched.
- No source or test code changes.

## Environment note

During the session, `vitest` was initially unavailable because the worktree `node_modules` symlink was not resolving to a populated root `node_modules`. After the parent orchestrator fixed the dependency symlinks, `vitest` resolved correctly. The command itself was run only after that fix; no `npm install` or `node_modules` modifications were performed by this agent.

## Commit

`test(baseline): drain translator-request-normalization regressions from 3-day window`

Single commit, no push.
