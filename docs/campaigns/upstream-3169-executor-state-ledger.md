# Upstream #3169 executor state ledger

- Source: decolua/9router#3169
- Fork: bloodf/durindoor
- Worktree: .omc/wt-port-3169

## Fork adaptation

Upstream's PR targeted one leak (model-mislabel via `this._lastModel`) in `opencode-zen`.
The fork broadens the fix into a uniform executor rule: any per-request routing metadata
flows through the third argument of `buildHeaders(credentials, stream, requestContext, model)`,
and `transformRequest` writes to that same object. This keeps singleton executors stateless
between requests when several requests are in flight concurrently.

The new `requestContext` slot is a deliberate fork contract addition. The upstream PR left
the third slot for an URL index; the fork re-purposes it for request-scoped state so executor
adaptations can carry `grokCliSessionId`/`grokCliRequestId`/`grokCliTurnIdx` (or future metadata)
without relying on instance fields that survive past the call.

## Ported changes

- `open-sse/executors/base.js` — `execute()` now builds a fresh `requestContext` and passes
  it through `buildUrl` and `transformRequest` to `buildHeaders`. The third arg is documented
  as the fork's request-context slot (not upstream's URL index).
- `open-sse/executors/gemini-cli.js` — uses the explicit `model` argument for
  `geminiCLIUserAgent(model)`; no instance cache.
- `open-sse/executors/opencode-zen.js` — removed `_lastModel`; `buildHeaders` now requires
  the explicit `model` argument to pick the auth scheme.
- `open-sse/executors/grok-cli.js` — `transformRequest` resolves `grokCliSessionId`,
  `grokCliRequestId`, `grokCliTurnIdx` per request and writes them onto the supplied
  `requestContext`; `buildHeaders` reads from `requestContext` only. The
  `this._currentSessionId`/`_currentReqId`/`_currentTurnIdx` instance fields are removed —
  the executor no longer retains per-request routing state across calls.
- `open-sse/handlers/countTokensCore.js`, `open-sse/handlers/moderationsCore.js`,
  `open-sse/handlers/rerankCore.js` — direct `buildHeaders` callers now pass the resolved
  `model` (and a `null` request context) so they share the same explicit-model contract.
- `tests/unit/executor-request-state-isolation.test.js` — interleaved assertions for Gemini,
  OpenCode Zen (both auth schemes) and Grok IDs.
- `tests/unit/opencode-go-models.test.js` — model transport capability assertions cover the
  shared `DefaultExecutor` routing path.

## Intentionally retained

- Per-machine fingerprint (machine id, device id) on the Grok executor: stable across
  requests, used only when a connection has no `deviceId`. It is not request-scoped state.
- The module-level per-session Grok turn store (used to compute the per-session turn index)
  and its `_resetGrokCliTurnStore` test helper. This is request-scoped logic, not executor
  instance state; it is keyed by session id and consumed inside `transformRequest`.

## Restored upstream comment

`open-sse/executors/grok-cli.js` — the `// xAI cli-chat-proxy enforces a maximum of 200 tools
per request. Upstream decolua/9router#2534.` comment is restored in `transformRequest` to
preserve provenance for the 200-tool cap.

## Verification

- RED: new tests fail against the prior source (instance-state reads, missing model arg,
  direct-callsite calls without `model`).
- GREEN: focused/adjacent executor suites passed 32/32; full `tests && npm run test:ci` reported `Raw failures: 0`; lint and production build exited 0; docs integrity passed; `tests/__baseline__/known-fails.txt` was unchanged.
