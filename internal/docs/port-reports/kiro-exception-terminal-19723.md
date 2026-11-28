# Kiro terminal-frame parity with OmniRoute #19723

Refs #2034. Source: OmniRoute (cheaper-inference/OmniRoute, MIT) at
`df8c91dd298e0b51661ca629be718311b9c1f488`. I read it read-only from a private bounded clone,
`open-sse/executors/kiro.ts` and `changelog.d/fixes/19723-kiro-stream-terminal.md`. The private
sync report `b66baee31cb` was not available. Its candidate list (D5 to D8) came from the parent
and was verified here, not assumed.

## Method

Every candidate was checked through the real code with only `proxyAwareFetch` mocked:

- `KiroExecutor.transformEventStreamToSSE` and `execute()`.
- The gateway `handleChat` with an isolated SQLite database and two Kiro accounts. Each account
  has its own strict proxy pool.
- The account loop, the early-EOF peek, SSE-to-JSON, and the Claude translation for
  `/v1/chat/completions` and `/v1/messages`, buffered and streamed.

AWS EventStream frames are built byte for byte with real prelude and message CRCs. No tokens are
real and nothing goes to a provider.

Evidence file: `tests/unit/kiro-exception-terminal-19723.test.js`, 44 tests. I ran it against the
unchanged `open-sse/executors/kiro.js` from `HEAD` by swapping the file in temporarily: 31 of the
first 43 tests failed and 12 passed. The 44th test, the wrapper repair below, is a preservation
case and passes on both. With the fix, all 44 pass.

## Confirmed and fixed

| ID | Candidate | Before (HEAD) | After |
|----|-----------|---------------|-------|
| D5a | Exception frame status | Every `:message-type: exception` became `{"type":"provider_error"}` with no status. Buffered: a throttled pair gave HTTP **502** "Provider unavailable". A `ValidationException` was replayed on the second account. | The name maps to 429/401/403/400/404/409/502, the same table as the source. The frame carries `type` (`rate_limit_error`, `authentication_error`, `permission_error`, `invalid_request_error`, `server_error`), `code: kiro_stream_exception` and `status`/`status_code`. Buffered throttled pair: HTTP **429** on both routes. Validation is request-scoped: account A only, 400 buffered, in-band `invalid_request_error` streamed. |
| D5b | Exception termination | The transform marked the failure and kept reading. If the upstream stayed open after the exception, the executor stream hung (no EOF within 500 ms). Through the gateway, the client stream still had no EOF after 5 s and account B was never tried. | One error frame, then `controller.terminate()`. The client stream ends, the upstream body is cancelled (`cancel()` observed), and the gateway fails over to account B on B's proxy. |
| D6a | Uppercase truncation stops | `MAX_TOKENS` and `MODEL_CONTEXT_WINDOW_EXCEEDED` finished as `stop`. Only lowercase matched. | Stop reasons are compared lowercased: `length` for OpenAI, `max_tokens` for Anthropic, buffered and streamed. |
| D6b | Content-filter stops | `content_filtered` and `guardrail_intervened` finished as `stop`. An empty filtered turn looked like an empty stream, so the OpenAI path replayed it on account B. | `content_filter`. The gateway's safety-stop rule then treats it as terminal, with no replay, buffered or streamed. |
| D7 | `MALFORMED*` stop | Ended as a success: `stop`, usage and `[DONE]`. | In-band 502 `server_error` / `kiro_malformed_stop`. No finish, usage or `[DONE]`. A malformed stop after content is not replayed. Wrapper validation still runs first, so an invalid `tool_call` wrapper keeps its one-shot repair (tested). |

Exception messages from the provider never reach the client. The message is fixed text, and the
tests check that the synthetic provider string appears in no client body.

## Checked, no gap, not changed

- **D8, an accounting frame without a stop.** OmniRoute now accepts a stream whose only terminal
  evidence is a metering, context-usage or token-usage frame. That relaxation is **not ported**.
  The DurinDoor rule still holds and is pinned by tests: a stream with no `messageStopEvent`
  fails with "Kiro stream ended before messageStopEvent", with no finish and no usage. This
  covers metering/context, `metricsEvent`, and a `metadataEvent` that carries a nested
  `stopReason`.
- **Nested `metadataEvent` stop reason.** The source reads `stopReason` from `metadataEvent`.
  There is no evidence that Kiro sends that frame, so it is not treated as a stop (see D8).
  A `metadataEvent` after `messageStopEvent` is still rejected as an invalid frame, which is
  current behavior.
- **EOF status after content.** For streamed OpenAI and Anthropic, a cut stream and an exception
  after content both stay terminal on account A, with no sibling call. This was already correct
  for the cut stream. The exception case now carries the mapped category.
- **Caller abort.** Cancelling the client body cancels the upstream body, and there is no sibling
  call. Already correct, covered.
- **Split frames.** Frames split at 1, 7 and 33 bytes give the same result. Already correct for
  stops, and now covered for exceptions.
- **Valid tool stops.** The structured `toolUseId`, name, arguments and `tool_calls` finish are
  unchanged.

## Not fixed here (outside the allowed scope)

1. **Buffered replay after partial output.** For buffered requests on either route, account A
   streams `partial` text, then an exception or a cut. The gateway retries on account B and
   returns B's answer. This was reproduced both before and after this change; the change neither
   causes nor worsens it. The cause is generic, in
   `open-sse/handlers/chatCore/sseToJsonHandler.js` (`aggregateParsedChunks`):
   `upstreamPartialOutput` only recognizes Gemini `candidates` and ignores OpenAI chunk
   `delta.content` / `tool_calls`. The fix belongs in that shared handler, not in the Kiro
   executor, and it needs its own task.
2. **Claude route content filter.** `open-sse/translator/response/kiro-to-claude.js`
   (`convertFinishReason`) maps `content_filter` to `end_turn`. An empty filtered turn on
   `/v1/messages` streamed is therefore still replayed on account B, and buffered it shows
   `end_turn`. A translator change (for example to `refusal`) is outside this executor-only
   scope.

No retry-policy, field-downgrade learned table, account/environment state or sign-in changes were
made. Accounts and proxies are only selected by the existing loop.

## Files

- `open-sse/executors/kiroTerminal.js` (new): the exception status table, the in-band failure
  payload, stop-reason normalization and the finish mapping.
- `open-sse/executors/kiro.js`: wiring for exception frames and `messageStopEvent`, plus the
  finish chunk. The stream terminates on failure.
- `tests/unit/kiro-exception-terminal-19723.test.js` (new).

## Checks run

Private `env -i` environment under `/var/tmp`, no credentials, each command under 300 s, with
`node node_modules/vitest/vitest.mjs run --maxWorkers=2` run from `tests/`:

- The new file: 44 passed.
- Every `tests/unit/*kiro*`, `tests/translator/*kiro*`, the `scripts/checks-select.mjs` selection
  for the changed files, `translator/golden-response-stream`,
  `unit/omniroute-specialized-executors` and `unit/keepalive-error-frame-status`. This includes
  `kiro-mitm-eventstream-pipeline`, `provider-signin-kiro-continuity` and
  `special-executor-terminal-integrity`. Result: 81 files and 789 tests passed.
- `pnpm run lint`: 0 errors. The warnings already existed under `src/`. The anti-slop check was
  OK. ESLint on the changed files was clean.

The full `test:ci` was not run here; it belongs to PR qualification.
