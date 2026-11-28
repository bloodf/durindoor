# #2034 Fish Audio speech: default transport replay

Scope: the staged, unregistered `native-fishaudio-tts` module only. No shared proxy code, registry, or public registration changed. This closes the Fish Audio TTS row of `internal/docs/port-reports/recovery-2689/default-transport-replay.md`.

## Base

- Implementation base: `62d08b11374f1e2dc590594da15e5f7c2cce0a39` (integration). Its module tree `open-sse/services/providerParity/native-fishaudio-tts` is `20ff8a7b70b502421c2874b712e1bad765fcbf7c`, the same tree as the frozen reference named in the inventory. Nothing else was imported from the frozen ancestry.

## Finding (reproduced)

- `http.js boundedSend` defaulted `fetchImpl` to `proxyAwareFetch` and passed no `noTransportReplay`. `tts.js synthesize` sends the billable speech request through `sendOnce` (`billable` defaults to true) as `POST https://api.fish.audio/v1/tts` with a JSON string body.
- `open-sse/utils/proxyFetch.js` `proxyAwareFetch` (lines 1190-1208): when a non-strict connection proxy send throws and the error is not an abort, it re-sends directly unless `noTransportReplay` is set or `hasNonReplayableBody` is true. A JSON string body is replayable (`hasNonReplayableBody`, line 1034), so no existing body guard covered this POST.
- `acceptedJob` in `sendOnce` is created only after `proxyAwareFetch` returns or throws, so it cannot stop the internal second send.
- Voice discovery (`voices.js`) is a free `GET /model` sent with `billable: false`.

Reproduction: the new suite drives the real `proxyAwareFetch` with the physical transport replaced by `__setOriginalFetchForTesting` and a fixture proxy dispatcher registered by `__setProxyDispatcherForTesting`. Each physical send is counted by leg (proxy A, proxy B, direct). On the base, 6 of 17 tests failed with `expected [ 'proxyA', 'direct' ] to deeply equal [ 'proxyA' ]`. The failing cases are proxy failures after a send (`ECONNRESET`, `UND_ERR_SOCKET`, `EPIPE`, `UND_ERR_HEADERS_TIMEOUT`), proxy `ECONNREFUSED`, and A/B isolation after a reset. A direct answer was queued in each case, so the replay surfaced as a second physical send. Deadline, caller-abort, abort-before-send, broken 2xx body, proxied 503, and direct `ENOTFOUND` already sent once on the base, because `proxyAwareFetch` rethrows aborts and answered responses are never replayed.

## Change

- `http.js`: `boundedSend` takes `noTransportReplay` and adds it to the init only when it uses the default `proxyAwareFetch`. An injected `fetchImpl` receives exactly the init it received before. `sendOnce` passes `noTransportReplay: billable`, so the speech POST goes out once and discovery keeps its existing fallback.
- Unchanged: URL and host, headers, selected key and proxy options (`resolveCredentialProxyOptions`), `redirect: "manual"`, body, abort and deadline handling, refusal mapping, and accounting. No retry policy changed.
- Consequence: a proxy `ECONNREFUSED` on speech now fails as "could not connect" (502, no `acceptedJob`) instead of falling back to a direct send. This matches the embedding correction pattern (`tests/unit/embedding-stage-transport-replay-2034.test.js`).

## Tests

- New: `tests/unit/fishaudio-tts-default-transport-replay-2034.test.js` (17 tests). It covers:
  - normal proxied and direct success with one send;
  - one physical send on the four uncertain failures, the deadline and caller abort, with `acceptedJob` `submit-unknown`, unknown cost, and no success accounting;
  - a broken 2xx body (`accepted`) and a proxied 503;
  - proven-unsent failures (proxy `ECONNREFUSED`, direct `ENOTFOUND`, abort before send) with no `acceptedJob`;
  - A/B key and proxy isolation;
  - the unchanged injected-fetch init;
  - discovery GET success, plus its preserved proxy-to-direct fallback.
- Protected: `tests/unit/native-fishaudio-tts.test.js` is byte-identical, sha256 `621d27ba76c0d86737b8c264462665c89ccf8d905236386775cf55e7848b16d9`.
- Results (Vitest 4.1.12, two fork workers, private HOME/DATA_DIR/TMPDIR/cache, borrowed read-only dependency graph with matching lockfiles):
  - base, new suite: 6 failed, 11 passed;
  - fix: the new suite (17), `native-fishaudio-tts.test.js` (92) and `private-audio-503-replay.test.js` (30), 139 passed in 3 files.
- `eslint` on both changed files: clean. `oxlint -c .oxlintrc.json` reports 0 diagnostics; its config linted `http.js` only. `git diff --check`: clean.

## Limits

- This module has no upload path, so "upload unchanged" is not applicable.
- The suite uses mocked transport only. It makes no claim about the live Fish Audio service, real proxies, or billing. A replay is a possible duplicate dispatch, not proven duplicate billing.
- No full suite, browser, e2e, Docker, or live runs were done. Recovery assembly, gate, and review remain separate parent steps. The stage is still unregistered.
