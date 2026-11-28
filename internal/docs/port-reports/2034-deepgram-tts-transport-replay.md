# #2034 Deepgram TTS default transport replay

Scope: the staged, unregistered `native-deepgram-tts` module only. This closes the Deepgram TTS candidate in `internal/docs/port-reports/recovery-2689/default-transport-replay.md`. Shared proxy code, the registry, registration and the protected suite were not touched. The frozen `8f4fc37` tree was used only as reference. The fix is on top of the integration module (base `62d08b11374`).

## Finding

- `http.js boundedSend` falls back to `proxyAwareFetch` when no `fetchImpl` is injected, and `sendOnce` passed no transport options (`http.js:54`, `http.js:155` before the change).
- `tts.js` sends the billable speech request through `sendOnce` as a JSON-string POST (`tts.js:156-160`). A string body is replayable, so `hasNonReplayableBody` does not protect it (`open-sse/utils/proxyFetch.js:1034-1041`, `:1190`).
- With a legacy, non-strict connection proxy, any proxy-leg error that is not an abort goes to `sendDirect()` unless `noTransportReplay` is set (`proxyFetch.js:1199-1208`). The direct resend happens inside one `proxyAwareFetch` call, before the module's `acceptedJob` classification runs, so wrapper accounting could not prevent it.
- Deadline and caller abort were already safe: the bounded signal aborts, and `rethrowTransportAbort` rethrows before the fallback (`proxyFetch.js:271-274`, `:1200`). A 2xx body failure and a 503 answer were also safe, because the response had already been returned.
- `discovery.js` sends a free `GET /v1/models` through the same `sendOnce` with `billable: false` (`discovery.js:67-68`). Deepgram TTS has no upload step.

## Reproduction (base, unchanged module)

The new suite `tests/unit/deepgram-tts-default-transport-replay-2034.test.js` drives the real `proxyAwareFetch`. The physical fetch is replaced by `__setOriginalFetchForTesting`, and each selected proxy gets a fixture dispatcher through `__setProxyDispatcherForTesting`. Each physical send is counted as `proxy-a`, `proxy-b` or `direct`. On the base module, 6 of 18 tests failed, each with `expected [ 'proxy-a', 'direct' ] to deeply equal [ 'proxy-a' ]`:

- after the proxy accepted the POST: ECONNRESET, UND_ERR_SOCKET, EPIPE (request-body write failure) and UND_ERR_HEADERS_TIMEOUT. Each was resent directly, and the queued direct audio came back as a success.
- a proven-unsent ECONNREFUSED on the proxy leg was also resent directly.
- selected-connection A/B isolation: a reset on connection A's proxy caused a direct resend with A's key.

The other 12 already passed on base: proxied and direct success, deadline, caller abort, abort before send, 2xx body failure, 503, direct ENOTFOUND, the injected-transport contract and the three discovery cases.

## Change

`http.js` adds a private `billableTransport` that calls `proxyAwareFetch(url, { ...init, noTransportReplay: true }, proxyOptions)`. `sendOnce` uses it only when no `fetchImpl` is injected and `billable` is true (the default, used by `tts.js`). Nothing else changes:

- An injected `fetchImpl` gets the same `(url, init, proxyOptions)` call. The suite asserts that `init` keys are exactly `body, headers, method, redirect, signal`.
- Discovery (`billable: false`) keeps plain `proxyAwareFetch`. The suite asserts that its existing proxy-to-direct fallback still happens and that it never carries `acceptedJob`.
- Host, URL, method, headers, body, selected credential and proxy options, `redirect: "manual"`, deadline, abort and refusal mapping are unchanged. There is no new retry policy.

Behavior change: a proven-unsent proxy failure on the billable POST (for example ECONNREFUSED) now returns a 502 with no `acceptedJob` and is no longer resent directly. This matches the confirmed embedding fix (`0a10696601d`).

## Current result

The private wrapper ran Vitest 4.1.12 with `--maxWorkers=2`, a 300 s ceiling and a clean `env -i` environment. HOME, DATA_DIR, TMPDIR, the cache and the Vite `cacheDir` were all private under `/var/tmp`. Dependencies were borrowed read-only via ignored symlinks. Only these two files were run:

- `tests/unit/deepgram-tts-default-transport-replay-2034.test.js`: 18/18 pass
- `tests/unit/native-deepgram-tts.test.js` (byte-identical, sha256 `35f879a4…7f28a29`): 53/53 pass, including the acceptance and 503 cases

Both were 71/71 on three consecutive runs. ESLint on the two touched source and test files exited 0.

## Limits

- All mocks are closed: no real proxy, socket, network or Deepgram call. Passing says nothing about live billing.
- Node was 24.22.3, not the declared 24.22.2.
- The full suite, browser, e2e and Docker were not run.
- The module stays staged and unregistered. Assembly, the gate and review are left to the parent.
