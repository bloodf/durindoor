# #1072 — Preserve model-test results on transport failure

## Source

Scoped gateway comparison: 9router PR #5792, head `621383bf7e50b17af876326ed4413e2c7d4164a3`, merge base `1855aa44473e88feac9d3f131b9c0c5fc9706b68`. The comparison identifies the fetch rejection escaping `pingModelByKind` as the independent residual. The model-test route's admission and request behavior are outside this change.

## Change

`src/app/api/models/test/ping.js` converts a fetch `TimeoutError` into a sanitized `{ ok: false, status: 408, error: "Request timed out", latencyMs }` result and a native fetch connection `TypeError` into `{ ok: false, status: 502, error: "Connection failed", latencyMs }`. Other thrown errors continue to propagate. Existing response and provider-error handling is unchanged.

Independent in-memory mocked cases cover a chat timeout and embedding connection rejection, with normal success controls in `tests/unit/ping-reasoning-models-3010.test.js` and `tests/unit/model-test-routing.test.js`.

## Scoped evidence

Command: `test -s internal/docs/port-reports/1072-5792-model-test-transport-failures.md && (cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/ping-reasoning-models-3010.test.js unit/model-test-routing.test.js)`

Result: exit 0. Vitest v4.1.12 reported 2 test files passed and 22 tests passed (duration 4.17s). The initial attempt before dependency installation could not start because `tests/node_modules/vitest/vitest.mjs` was absent; after the prescribed frozen root, CLI, and test installs, the exact command above passed.
