# NoTrack Web cookie flow (#2034)

Historical status before the public-route follow-up: **NOT VERIFIED**. The integration cases in `tests/unit/cookie-flow-notrack-web-2034.test.js` were added but could not be run in this checkout because its test dependencies are absent. No live sign-in or provider request was attempted. A passing isolated test run is required before treating the assertions below as evidence.

The actual registry descriptor specifies origin `https://notrack.ai`, required cookies `uid`, `si_usr_id`, and `si_ses_id`, optional `nt_session`, no chunk prefixes and no localStorage keys. It enables extension capture; the active executor posts to `/api/dispatch`. The new cases connect the issued pairing to the actual extension capture, import handler and SQLite repository, then pass the retrieved connection to the executor with a mocked fetch. They also exercise the real parser candidates for Cookie, cURL and HAR input, selected update ownership, refusal of foreign origin, expired cookies, unsupported chunks and localStorage, and response/log redaction. The generic handler suite uses synthetic descriptors; `notrack-optional-session-cookie.test.js` already covers the NoTrack parser, extension and executor separately. This addition targets their integration boundary.

The extension cookie store, management authority and network are mocked. SQLite is in-memory; the database driver and unrelated localDb lookups use the existing test fixture pattern. No proxy is configured in this case. These assertions cannot establish provider-side authentication, real browser permissions, a live sign-in, or proxy routing. The registry has no supported chunk or localStorage credential: those inputs should be refused, not interpreted as additional credentials. The existing optional-cookie suite covers omission of `nt_session`.

Exact intended focused command, with private directories and a credential-free environment (after separately supplying isolated dependencies):

```sh
env -i PATH="$PATH" LANG=C.UTF-8 CI=1 HOME="$run/home" DATA_DIR="$run/data" TMPDIR="$run/tmp" XDG_CACHE_HOME="$run/cache" npm_config_cache="$run/npm-cache" timeout 300s node tests/node_modules/vitest/vitest.mjs run tests/unit/cookie-flow-notrack-web-2034.test.js --config tests/vitest.config.js --maxWorkers=2
```

Here `run` must name a new private directory under `/var/tmp` with the listed subdirectories created first. Local execution: **not run**, because `tests/node_modules/vitest/vitest.mjs` is absent; no install was attempted. CodeGraph was unavailable (`CodeGraph 1.6.2 required`), so retrieval used bounded checkout searches. This report makes no new upstream-source claim; registry attribution already identifies OmniRoute release/v3.8.55, commit `4265bb2ad5477450a07d3a43ea33a62c6c874878`, `open-sse/config/providers/registry/notrack-web/index.ts`.


## Public-route follow-up

Status: **BLOCKED by reproducible product failures**. The appended suite uses `cookiePublicFlow2034` with real pairing, import, SQLite, registry, executor, and public chat routes; only external vendor transport and the helper's narrow management authorization boundary are replaced. Its synthetic responses are not evidence of live NoTrack behavior. Two imported accounts are bound to distinct strict proxy dispatchers. The suite checks each account pin in both API formats and buffered/streamed modes, Cookie header/cURL/HAR import followed by public dispatch, account update and rejection boundaries, redaction, and failure behavior. No localStorage credential is supported by the descriptor. The helper was not modified; no helper extension was necessary for these reproductions.

The focused run leaves ordinary failing regression assertions, not expected failures. In the mock transport, a pinned 502 produced three dispatches; an unpinned rejected POST produced two dispatches although its acceptance is unknown. A 401 refusal did permit the explicitly tested account fallback. HTTP 200 HTML, malformed SSE, and an SSE error yielded an error followed by `[DONE]` at the OpenAI public route. A stalled upstream body did not complete within one second despite the fixture's 100 ms body timeout. Partial-text stream failure and caller abort cases passed in this run. See the test for exact inputs and assertions; no live credentials or provider were used.

Repair handoff: in `open-sse/executors/notrack-web.js`, preserve an outcome-unknown classification for failed or ambiguous billable POSTs rather than turning every transport failure into an ordinary retryable 502; propagate that classification through `open-sse/handlers/chatCore.js` and `src/sse/handlers/chat/singleModel/postProcess.js` so selection does not replay it. Inspect the pinned 502 retry path as well and stop retries where non-acceptance is not proven. Make NoTrack's body reading deadline-aware and distinguish malformed, HTML, and error frames from valid completion, propagating errors through the public stream without a success terminal. Validate those changes against the retained focused regressions, including the explicit 401 fallback; these paths are a bounded repair starting point, not proof that each change alone suffices.

Commands used with a unique private `/var/tmp/notrack2034-worker-1175396` HOME, DATA_DIR, TMPDIR, XDG and npm caches, empty inherited environment apart from PATH/LANG/CI and those paths, and 300-second command limits:

```sh
env -i PATH="$PATH" LANG=C.UTF-8 CI=1 HOME="$run/home" DATA_DIR="$run/data" TMPDIR="$run/tmp" XDG_CACHE_HOME="$run/cache" npm_config_cache="$run/npm-cache" timeout 300s node tests/node_modules/vitest/vitest.mjs run tests/unit/cookie-flow-notrack-web-2034.test.js --config tests/vitest.config.js --maxWorkers=2 --reporter=dot
env -i PATH="$PATH" LANG=C.UTF-8 CI=1 HOME="$run/home" DATA_DIR="$run/data" TMPDIR="$run/tmp" XDG_CACHE_HOME="$run/cache" npm_config_cache="$run/npm-cache" timeout 300s node tests/node_modules/vitest/vitest.mjs run tests/unit/notrack-optional-session-cookie.test.js --config tests/vitest.config.js --maxWorkers=2 --reporter=dot
```

The final focused run failed: 26 passed, 6 failed (pinned 502, uncertain transport replay, three error-terminal cases, and body deadline). The related optional-cookie test passed 17/17. Root ESLint (`node node_modules/eslint/bin/eslint.js src`) passed with 348 warnings; `node scripts/build-anti-slop-plugin.mjs` and `node scripts/check-anti-slop.mjs` passed. Each used the same private environment and timeout. Root, CLI and test dependencies were installed in this checkout with frozen lockfiles and a private store. Full CI was outside this worker's scope. The original assertions were preserved; this follow-up does not establish real browser permission behavior, real provider authentication, or production proxy behavior.

## Repair of the NoTrack executor

Status: **PASSING under mocks**. The six regressions above are fixed in `open-sse/executors/notrack-web.js` alone. No shared base, handler, stream helper, registry, config or fixture file changed. All results come from synthetic vendor frames on the real public route, gateway selection, registry executor, SQLite import and strict proxy binding. None of it is evidence of live NoTrack behavior.

What changed in the executor:

- **Trusted no-replay metadata.** Any failure after the billable POST may have reached NoTrack: a transport error, any status other than 401/403/429, an unusable or failed body, or a body deadline. These results now carry `claudeRequestScoped: true` and `response.upstreamPartialOutput = true`. This is the same internal contract deepseek-web and doubao-web use, and `chatCore.js`, `singleModel/postProcess.js`, account selection and `transientBackendRetry.js` already honor it, so no consumer change was needed. Explicit 401/403 and 429 replies, a refused login redirect, and a send that provably never left the gateway (`OUTBOUND_URL_GUARD_BLOCKED`, or a strict proxy with no route) stay ordinary refusals that may fall back to another account.
- **Bounded, cancellation-aware body reads.** Buffered replies are read through `readBodyWithTimeout` within `PROVIDER_BODY_TIMEOUT_MS` and `MAX_PROVIDER_BODY_BYTES`. In a streamed reply, each read waits at most `PROVIDER_BODY_TIMEOUT_MS` and is stopped at once by the caller signal. A failure, an early stop or a client cancel cancels the upstream body without waiting on the provider.
- **Strict frame parsing.** Blank lines, SSE comments, `event:`/`id:`/`retry:` fields, `[DONE]`, and frames without text (`chat_meta`, `done`) stay benign. `delta` and `message` frames keep their existing meaning, `data:` with or without a space still parses, and an unterminated final line is still dropped. HTML or other non-SSE lines, non-JSON or non-object `data:`, and `type:"error"` frames now fail with fixed messages ("Notrack returned an unusable response" or "Notrack reported a generation failure"). Vendor text is never echoed. A reply with no text frame at all is unusable rather than an empty success.
- **No false EOF success.** A streamed reply is held until its first text frame, so a failure before any output becomes an ordinary error response. A failure after text errors the stream: there is no `finish_reason: "stop"`, no `[DONE]`, and the usage row is recorded as `cancelled`, not `success`. Only a body that ends cleanly gets the success terminal.

Test changes in `tests/unit/cookie-flow-notrack-web-2034.test.js`. All 32 cases from `4a19920da3e59342e8590017f084858756691a0e` are kept, with inputs and assertions unchanged. The only edit to an existing case: the stalled-buffered fixture's delayed `controller.close()` is wrapped in `try`. The executor now cancels that body at the deadline, and the unguarded close raised an unhandled `ERR_INVALID_STATE` after the test. The three unusable-body cases needed no migration; they pass as written. Thirty-nine cases were added in the same public-route describe block:

- HTML, malformed SSE, vendor error frame, HTTP 500, HTTP 502 and transport reset on an unpinned request with two prioritized accounts. Each runs on the OpenAI and Anthropic routes, buffered and streamed (24 cases). Each asserts exactly one POST with account A's cookie and proxy dispatcher, a 502 with a fixed error and no choices, content or usage, and no `[DONE]`, `finish_reason:"stop"`, `message_stop`, `end_turn` or vendor text. No usage row is recorded and no credential appears in the output or logs.
- Explicit 403 and 429 refusals that fall back to account B: two POSTs, with each request's cookie and dispatcher checked.
- Vendor error frame, malformed frame and stalled body after partial text, on both routes (6 cases). The partial text is delivered, the stream errors within one second, the upstream body is cancelled, there is one POST, no success terminal, and no `success` usage row.
- A streamed body stalled before any text, on both routes. The request ends within one second with the fixed timeout error, no success terminal, the body cancelled, and one POST.
- A caller abort during the buffered body read, without replay.
- Client API key scope with `requireApiKey`, on both routes, buffered and streamed. Each scoped key dispatches only its own account's cookie and proxy and is attributed in usage. Another account's key, an invalid key and a missing key are refused with no network call.

Check that the cases exercise the defect: with the original executor restored temporarily (`git show HEAD:open-sse/executors/notrack-web.js`), the focused file failed 39 of 71 (the 6 original failures plus 33 new cases). The 403/429 fallback and API key cases pass with both executors, as positive proofs should.

Commands. Each ran under a private `/var/tmp/notrack2034-repair-*` run directory with `env -i`, carrying only PATH, `LANG=C.UTF-8`, `CI=1`, private HOME, DATA_DIR, TMPDIR, XDG cache, npm cache and pnpm store paths, and `timeout 300s`. Root and test dependencies were installed in this checkout with `pnpm install --frozen-lockfile` against the private store.

```sh
node tests/node_modules/vitest/vitest.mjs run tests/unit/cookie-flow-notrack-web-2034.test.js --config tests/vitest.config.js --maxWorkers=2 --reporter=verbose --silent
node tests/node_modules/vitest/vitest.mjs run tests/unit/notrack-optional-session-cookie.test.js tests/unit/arch-c2311.test.js tests/unit/web-session-executor-base.test.js tests/unit/web-session-redirects.test.js tests/unit/review-x-executor-send-5.test.js tests/unit/review-x-sse-final.test.js tests/unit/notrack-web-provider.test.js tests/unit/provider-registration-web-batch-c.test.js tests/unit/provider-registration-web-batch-c-routes.test.js tests/unit/provider-cookie-import-contracts.test.js --config tests/vitest.config.js --maxWorkers=2 --reporter=verbose --silent
node node_modules/eslint/bin/eslint.js src
node node_modules/eslint/bin/eslint.js open-sse/executors/notrack-web.js tests/unit/cookie-flow-notrack-web-2034.test.js
node scripts/build-anti-slop-plugin.mjs
node scripts/check-anti-slop.mjs
```

Results: focused file 71/71 passed with no unhandled errors. Related files 10/10 passed with 527 tests, including `notrack-optional-session-cookie.test.js` at 17/17 and the `review-x-sse-final.test.js` splitter allowlist, which still lists `notrack-web`. Root ESLint: 0 errors, 348 existing warnings. The changed files lint clean. The anti-slop bundle was rebuilt with no tracked change, and the gate reports 0 diagnostics. Full CI, builds, browsers and live providers were out of scope and were not run.

Remaining uncertainty:

- Whether real NoTrack ever returns HTML or other non-SSE lines inside a successful reply is not known. Such a reply is now an error with no replay, not text.
- Unknown-outcome failures carry no cost receipt from this executor. Unknown-cost receipt registration belongs to the shared `register-cookie-outcome-accounting-02` work, and no cost completeness is claimed here.
- When a stream fails after partial text, the error reaches the client as a broken stream, as in the pre-existing partial-text case, not as a typed in-stream error event. Changing that framing would need `open-sse/handlers/**` or `open-sse/utils/stream*.js`, which this unit may not edit.
- Real browser permission prompts, real provider authentication and production proxy behavior remain unproved.
