# Upstream PR Port — #3220 (2026-08-11)

[`decolua/9router#3220`](https://github.com/decolua/9router/pull/3220)
adds a per-response-body read timeout so a provider that returns headers
within `FETCH_CONNECT_TIMEOUT_MS` but then stalls mid-body can no longer
hold a concurrency slot indefinitely. The fork already had
`PROVIDER_BODY_TIMEOUT_MS` at 120 s guarding the same callsites, but the
timeout threw a generic `TimeoutError` that handlers mapped to
`502 BAD_GATEWAY` — wrong code for a stalled-but-otherwise-valid peer.

| PR | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| [#3220](https://github.com/decolua/9router/pull/3220) `feat(open-sse): add response body timeout` | PORTED | `open-sse/handlers/chatCore/nonStreamingHandler.js:331` and `open-sse/handlers/chatCore/sseToJsonHandler.js:261` already gated body reads on `readBoundedResponseText` with `timeoutMs: PROVIDER_BODY_TIMEOUT_MS`, so a hung body unblocked itself only via the abort path. Generic `TimeoutError` was caught and mapped to `502 BAD_GATEWAY`, indistinguishable from a malformed provider body. | Add `open-sse/utils/bodyTimeout.js` with `BodyReadTimeoutError` and `readBodyWithTimeout`; thread a new `responseBodyTimeoutMs` param through `handleNonStreamingResponse` and `handleForcedSSEToJson`; replace both `readBoundedResponseText` calls. Map `BodyReadTimeoutError` to `HTTP_STATUS.GATEWAY_TIMEOUT` (504) and keep malformed/read errors on 502; abort stays 499. |

## Adaptations

- **Default kept at 120 s, not 300 s.** Fork already enforces a 120 s
  body ceiling via `PROVIDER_BODY_TIMEOUT_MS` on the affected callsites,
  plus a 60 s connect ceiling via `FETCH_CONNECT_TIMEOUT_MS` and a
  6-minute streaming stall ceiling via `STREAM_STALL_TIMEOUT_MS`. Lifting
  the new variable to upstream's 300 s would weaken existing protection
  for no benefit to the CLOSE-WAIT bug this PR targets. `RESPONSE_BODY_TIMEOUT_MS`
  defaults to `120 * 1000` here, equal to `PROVIDER_BODY_TIMEOUT_MS`.
- **Env-disable rule kept at `envMs` semantics, not upstream's `<= 0` rule.**
  `envMs(name, def)` in this fork returns the default for any non-positive
  override, so the env var cannot be set to `0` to disable the timer.
  Upstream PR #3220's body claims that `0` "restores unbounded behavior";
  in this fork that only holds at the helper API (per-call `timeoutMs: 0`
  in `readBodyWithTimeout`), and that opt-out is documented in
  `bodyTimeout.js`. Operators that need the pre-port behavior should set
  the env var to a very large value rather than 0.
- **Codex / Responses API branch untouched.** `handleForcedSSEToJson`
  routes Codex/Responses bodies through
  `convertResponsesStreamToJson(providerResponse.body, { timeoutMs: PROVIDER_BODY_TIMEOUT_MS, ... })`
  at `sseToJsonHandler.js:198`. The new param and `readBodyWithTimeout`
  call apply only to the standard Chat Completions SSE path (line 261).
  Broadening the port there would have to either lift the existing
  `PROVIDER_BODY_TIMEOUT_MS` or duplicate status-mapping logic for a
  converter that already returns 502 on its own failure modes; both
  change the contract outside the bug at hand. Future work.
- **No production-time wait in tests.** Both new lifecycle tests inject
  `responseBodyTimeoutMs: 1` so the helper trips well under the
  `testTimeout: 5000` ceiling. Three additional unit tests in
  `tests/unit/body-timeout.test.js` cover the healthy pass, the
  cancel-and-typed-error path, and the `timeoutMs: 0` opt-out.
- **`onRequestSuccess` not promoted for timeouts.** A hung body is not a
  successful terminal response, so the new `quotaTerminalReason: "timeout"`
  branch in both handlers deliberately avoids the upstream-success
  promotion. Existing `terminalProvenance` gating still wins.

## Verification

- `tests/node_modules/.bin/vitest run --root . --config tests/vitest.config.js tests/unit/chat-body-lifecycle.test.js tests/unit/body-timeout.test.js`
  → `Test Files 2 passed (2)`, `Tests 23 passed (23)`, `Duration 1.02s`.
- Pre-implementation `RED` for the two new lifecycle tests (vitest
  test-timeout path, no production code that understood the injected
  `responseBodyTimeoutMs`):

  ```
   ❯ tests/unit/chat-body-lifecycle.test.js (20 tests | 2 failed) 10059ms
       × times out a hung forced-SSE body as a gateway timeout 5002ms
       × times out a hung non-streaming body as a gateway timeout 5000ms
  ```
- Post-implementation `GREEN` (full lifecycle + helper suites together):

  ```
   Test Files  2 passed (2)
        Tests  23 passed (23)
     Duration  1.02s
  ```
