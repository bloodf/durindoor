# #2034 HuggingFace TTS default transport replay

Scope: the staged, unregistered `native-huggingface-tts` adapter only. This change does not touch shared proxy code, the registry, the catalog or public activation.

## Finding

`internal/docs/port-reports/recovery-2689/default-transport-replay.md` lists HuggingFace TTS as a candidate. The default `boundedSend` transport (`open-sse/services/providerParity/native-huggingface-tts/http.js`) called `proxyAwareFetch` without `noTransportReplay`. The fixed-host JSON TTS POST (`tts.js`, `https://router.huggingface.co/hf-inference/models/<owner>/<name>`, body `{ inputs }`) has a string body, so `hasNonReplayableBody` does not block it. On a legacy, non-strict connection proxy, `proxyAwareFetch` (`open-sse/utils/proxyFetch.js`, proxy catch block near line 1196) therefore resent the billable POST directly after a proxy failure whose outcome is unknown. No existing body guard prevented that. The frozen reference `8f4fc37` has the same default (`fetchImpl = proxyAwareFetch`).

Reproduced on base `62d08b11374` with the real `proxyAwareFetch`. Each physical send was captured through `__setOriginalFetchForTesting` plus fixture proxy dispatchers. There were no sockets or network calls. 6 of 21 new cases failed:

- `ECONNRESET`, `UND_ERR_SOCKET`, `EPIPE` and `UND_ERR_HEADERS_TIMEOUT` after the proxy send each produced legs `["proxy-a", "direct"]`, and the direct replay returned audio as a success.
- A proxy reset on connection A was replayed directly with A's key and returned success, where unknown cost was expected.
- A proxy `ECONNREFUSED` fell back to direct.

Deadline, caller abort, a 2xx body failure, 503, 500 and redirect cases already sent once on base. `rethrowTransportAbort` stops the fallback on abort and deadline, and the other cases are answers, not transport errors.

## Change

`http.js`: the default `fetchImpl` is now a local `defaultFetch` that calls `proxyAwareFetch(url, { ...init, noTransportReplay: true }, proxyOptions)`. An injected `fetchImpl` still receives exactly the old init (`method`, `headers`, `body`, `redirect`, `signal`). These are unchanged: host, selected credential and proxy options (`resolveCredentialProxyOptions(credentials)`), `redirect: "manual"`, body, abort and deadline handling, `provenUnsent` classification and 503/5xx `acceptedJob`. There is no retry-policy change.

Two behaviours change on a legacy non-strict proxy. An uncertain proxy failure now returns `acceptedJob` (`submit-unknown`, unknown cost, no success accounting) after one physical send. A pre-connect proxy failure such as `ECONNREFUSED` returns 502 with no receipt and is not retried directly, which matches the confirmed embedding fix.

## Tests

- New: `tests/unit/huggingface-tts-default-transport-replay-2034.test.js` (21 cases). Covers normal proxy, direct and base-URL-ignored sends; four uncertain transport errors; the deadline and in-flight abort; a 2xx body failure; 503 (Retry-After kept, unknown work); 500; redirect refusal; A/B key and proxy isolation; proven-unsent proxy and direct failures with no receipt; pre-send abort; input refused before send; static discovery with no send; and the unchanged injected-transport init.
- Protected suite `tests/unit/native-huggingface-tts.test.js` is byte identical (blob `1fff8caac20775b2129343a73e90999990d4aa8c` at base and after).
- Base: new suite 6 failed / 15 passed. After: the new suite, `native-huggingface-tts.test.js` and `native-audio-503-contract.test.js` pass 111/111 (Vitest, `--maxWorkers=2`, private `env -i` HOME/DATA_DIR/TMPDIR/cache).
- oxlint with `.oxlintrc.json` on `http.js`: 0 warnings, 0 errors. `node --check` passed. The regenerated tracked anti-slop bundle was restored.

## Limits

Mocked transport only. This says nothing about live HuggingFace or real proxies. No full suite, browser, e2e, Docker or live calls were run. Dependencies were borrowed read-only from the main checkout's pnpm store through private symlinks, which are not committed. Recovery assembly, gate, review, PR and activation are separate parent steps.
