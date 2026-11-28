# Mandatory DeepSeek source proof and terminal parity (#2034)

Base: `bcd70c75541967c7220d9b924ec9640cf8aea3eb` (integrates `82d15a5a7c0` through merge `352dd6e36ab`,
including the `32727dcb0bb` and `1105fed4228` repair ancestry). This follow-up
withdraws the default-off completion claim and the legacy EOF-success relaxation.
All evidence below uses closed mocks and synthetic credentials. It is not live
DeepSeek validation, a full build, an installed artifact smoke test, or full CI.

## Source and behavior

Attribution: cheaper-inference/OmniRoute (MIT),
`open-sse/executors/deepseek-web.ts`, `open-sse/executors/deepseek-web/pow.ts`,
`open-sse/lib/deepseek-pow.ts`, `open-sse/lib/deepseek-pow-hash.js`, and
`open-sse/lib/deepseek-pow-worker.mjs` at
`4265bb2ad5477450a07d3a43ea33a62c6c874878`.
The carried report records identical relevant blobs at `b15b2ee6ac0`.
Only the exact pinned executor object was re-read, with lazy fetch and optional
locks disabled. No newer upstream head was consulted after the freeze
`2026-11-27T23:49:25.752045Z`. License remains in
`open-sse/executors/deepseek-web/LICENSE.omniroute`.

Every completion now requires current-user lookup, session creation, challenge
creation and one proof-bearing completion, in that order. The deprecated flag
has no effect: unset, false, off and source all require proof. The compatibility
predicate always returns true; the completion path has no conditional bypass.
Unsupported algorithms, invalid challenges and solver failure stop after three
unbilled setup requests. There is no fallback to a bare completion.

All four calls retain the chosen account, proxy and fixed first-party host.
Completion transport replay remains disabled. The unchanged solver uses actual
source JavaScript hash/worker assets, not a guessed WASM filename or placeholder.
Its two-worker capacity, bounded difficulty, memory limits, solve deadline,
empty worker environment and termination on abort remain intact. The request
has a 60-second deadline, 64 KiB setup limits and a 4 MiB completion limit.

Native streams require FINISHED. Supported legacy OpenAI and biz_data content
require an explicit valid finish or DONE. EOF alone, incomplete event records,
malformed values, mixed dialects, error frames and empty output cannot publish
success stop/usage. Comments and typed source search metadata can be ignored;
post-FINISHED search metadata is allowed, while trailing output/errors fail.
The decoder remains in the existing allowed executor module. The architecture
guard and shared splitter are unchanged. Both client dialects retain buffered
validation before publishing success, including requests for streamed output.

Accepted/uncertain completion failures retain the request-scoped terminal marker
and original quota ticket. Setup/challenge remain unbilled. Explicit auth/quota
rejections remain classifiable; unknown billable outcomes cannot rotate accounts
or replay. Provider error prose and credentials are not returned or logged.

## Exact fixture migrations and count matrix

No old test row is deleted or skipped. Model, tool, format, credential, proxy,
account-isolation and output assertions remain. Only success wire fixtures gain
a deterministic real-solver challenge and explicit terminal. The prior incomplete
biz_data and batch-a delta shapes remain negative regressions in the parity suite.

| File under tests/unit | Before | After | Exact migration |
| --- | ---: | ---: | --- |
| deepseek-web-provider.test.js | 6 | 6 | Insert nonce-3 challenge in setup; add DONE to biz_data success; exact four-path/proof assertions; account B starts at call 4 instead of 3; access-token completion assertion moves 2 to 3. |
| deepseek-web-capture.test.js | 23 | 23 | Executor setup gains challenge and DONE; exact four paths/proof asserted; capture/import/origin/precedence scenarios retained. |
| port9r-deepseek-web-reasoner-3945.test.js | 10 | 10 | Each of three completion variants gains challenge and DONE; exact four-call slice/proof; expert/thinking assertions retained. |
| provider-registration-web-batch-a-routes.test.js | 24 | 24 | Only DeepSeek handler/fixture changes: deterministic challenge, valid stop and DONE, exact four-path/proof assertions. Other provider fixtures and expectations unchanged. |
| cookie-flow-deepseek-web-2034.test.js | 35 | 35 | Remove source opt-in from executor describe; existing exact four requests, two selected accounts/strict dispatchers and nonce-5 proof assertions now execute with flag unset. |
| deepseek-web-source-parity-2034.test.js | 57 | 79 | Default-unset setup; replace opt-in row with mandatory-proof flag matrix; add DONE to legacy success; restore original incomplete-delta 502; retain stronger malformed/empty/mixed negatives; add 22 terminal/shape/keepalive cases. |
| complete-deepseek-source-default-2034.test.js | 0 | 41 | New real public route/translation/chatCore/executor tests: both dialects and stream modes, two synthetic accounts/proxies, flag matrix, auth/quota/nonstream JSON/truncated/unknown-submit errors, no replay, log redaction, CPU/body abort, pinned vector, pre-submit proof failures, offline packaged worker. |
| Total | 155 | 218 | Seven explicitly authorized files only. |

The original `1105fed4228` incomplete legacy delta assertion is restored to 502.
The additional `82d15a5a7c0` malformed, empty and mixed-truncated cases remain.
Its default-off row becomes stronger mandatory-default coverage, rather than
being removed. The original pinned source vectors, real quota settlement,
proxy-router/no-replay, timeout, worker-slot and cwd/package tests remain.

## Offline packaging and verification

The existing CLI copyRecursive helper copies the real worker/hash payload plus
the manifest-listed typeChecks dependency to a disposable runtime directory.
The test checks the copied worker exists, changes cwd to that runtime and solves
a deterministic challenge using the copied worker. The manifest includes the
open-sse tree. This proves helper-level source/runtime asset discoverability;
no WASM asset is required by this JavaScript implementation. It does not claim
that a full production build or npm pack was executed.

The new public tests keep real route handlers, translation, chatCore, executor
and solver. The handleChat seam supplies synthetic selected account metadata;
the existing cookie-flow suite independently exercises real persisted account
selection and strict proxy dispatchers. Network, management guards and browser
objects are mocked. No real providers, tokens or user data are used.

Dependencies were installed in this checkout with frozen lockfiles and private
stores. No borrowed dependency graph was repaired, deleted or relinked. Checks
use env -i, explicit PATH/LANG/CI, unique private /var/tmp HOME/DATA_DIR/TMPDIR,
cache/store settings and stripped credentials, with a 300-second command ceiling.
Vitest uses at most two workers. Only root lint and these seven explicit files
are authorized; no full CI, build, pack, browser, Docker or live test was run.

Commands from tests/ (inside that private environment):

```sh
node node_modules/vitest/vitest.mjs run \
  unit/deepseek-web-provider.test.js unit/deepseek-web-capture.test.js \
  unit/port9r-deepseek-web-reasoner-3945.test.js \
  unit/provider-registration-web-batch-a-routes.test.js \
  unit/cookie-flow-deepseek-web-2034.test.js \
  unit/deepseek-web-source-parity-2034.test.js \
  unit/complete-deepseek-source-default-2034.test.js --maxWorkers=2
```

Root check: `pnpm run lint`.

Final scoped result: seven files, 218 tests passed, zero failed/skipped. Evidence:
`/var/tmp/ds2034-tests.Qa0iaA/results.json`. Root lint passed with zero errors
and 348 existing warnings; anti-slop passed with zero diagnostics. Lint evidence:
`/var/tmp/ds2034-lint.r7yXwX/output.log`. The first
run exposed a new test harness proxy placement error; the corrected harness uses
credential metadata. An abort-result assertion now inspects the real executor
result, because chatCore returns its own client-cancellation response. Neither
fix changes production behavior or weakens the no-replay assertion. Failure baseline is unchanged and no entries,
assertion skips, todos or expected-failure markers were added. Protected paths
are untouched. Full exact-head CI and independent review remain for the parent.
