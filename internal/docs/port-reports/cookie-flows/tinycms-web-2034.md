# TinyCMS Web capture and import (#2034)

**Status: mocked public-route evidence complete; no live claim.** The 502 replay recorded in "Public-route extension: blocked by replay" is repaired in `open-sse/executors/tinycms-web.js` and every case below passes in a private isolated gate (see "Completion: gateway dispatch, non-replay and import formats"). All evidence uses synthetic vendor frames. No live sign-in or provider request was performed. The paragraphs before that section are kept as the historical record; where they say "not verified" or "blocked", the completion section supersedes them.

The real registry describes `https://site.tinycms.xyz` and one required localStorage item, `app-config-uuid`, matching `^R[\x21-\x7e]{3,}$`. It declares no cookies, chunks or optional cookie fields. The import stores the item in `providerSpecificData`; the executor uses it when a pasted API key is absent. The executor is registered and has a request path: public-IP lookup, challenge, signing and chat. This is an active provider rather than a capture-disabled staging profile. These are local source observations, not evidence of a live provider contract.

Existing `api/provider-cookie-import-local-storage.test.js` covers real pairing, create/update, validation, redaction and wrong ownership; `cookie-capture-local-storage-origin.test.js` covers navigation and origin checks using a constructed pairing. `tinycms-web-provider.test.js` covers executor and gateway calls with synthetic pasted keys. The new test joins an actual pairing to extension selection and capture, the import handler, SQLite storage and the executor with synthetic responses. It also exercises selected update ownership and account isolation, and runs the actual parser and contract on Cookie, cURL and HAR input. Those formats carry cookies rather than localStorage and the candidate builder refuses them; HAR's current error may say there is no request to the origin even when the matching request has no approved cookie. The API already rejects cookies beside or instead of this item in the existing localStorage suite. Cookie expiration has no applicable TinyCMS cookie to evaluate; pairing expiry and tab navigation are bounded in the extension, with navigation covered by the existing suite. The localStorage value itself has no expiry metadata, so expiration can only be established by a provider probe, not by capture.

The test mocks management authority, browser APIs and external fetch. The SQLite adapter, registry, parser, handlers, storage and executor are real. The capture test uses one synthetic account and the default direct route; it does not prove proxy routing, real browser permission behavior, an upstream session, or live sign-in. Separate tests cover the invalid-input and redaction cases described above; this new test is not a substitute for running them. No upstream source claim or ported logic is introduced here.

Focused command attempted with a unique private `/var/tmp` HOME, DATA_DIR, TMPDIR and cache, empty inherited environment, explicit PATH/LANG/CI and a 300-second timeout:

```sh
node tests/node_modules/vitest/vitest.mjs run tests/unit/cookie-flow-tinycms-web-2034.test.js --config tests/vitest.config.js --maxWorkers=2
```

Result: `MODULE_NOT_FOUND` for `tests/node_modules/vitest/vitest.mjs`; no tests collected. No dependency installation was attempted. `node --check tests/unit/cookie-flow-tinycms-web-2034.test.js` passed. The remaining owner requirement is to run and review the focused test in the native isolated dependency gate, including its executor boundary and redaction assertions, before treating the flow as proved.

## Public-route extension: blocked by replay

The new shared-fixture cases use real pairing, import, storage, registry, executor and public routes with synthetic vendor frames and strict proxy dispatchers. Eight pinned account/format/stream combinations, update/origin/owner isolation, and pinned 401 and 429 refusals passed. The original three cases also passed. No live provider claim follows.

With a private credential-free environment and 300-second ceiling, this command finished with **14 passed, 1 failed**:

```sh
node tests/node_modules/vitest/vitest.mjs run tests/unit/cookie-flow-tinycms-web-2034.test.js --config tests/vitest.config.js --maxWorkers=2 --reporter=dot
```

The ordinary failing 502 test is a bounded reproduction: two imported UUID accounts use distinct strict proxies; the public streamed route is pinned to the first; IP and challenge responses succeed; every vendor chat POST returns HTTP 502. The test expects one challenge and one chat request, but observes six credential-bearing calls (three challenge/chat pairs). It does not accept a success terminal. The 502 comes after the billable chat POST, so the response alone does not establish that work was refused. This violates the requested non-replay requirement. The sibling provider and secret files passed (15 and 2 tests respectively) in the earlier combined run, which was interrupted while the then-mocked public cases were timing out; the public suite was rerun after unloading that legacy mock.

Minimal repair path for the orchestrator: preserve the distinction between a pre-chat challenge failure and an outcome-unknown failure after the TinyCMS chat POST in `open-sse/executors/tinycms-web.js`; propagate the latter as terminal through `src/sse/handlers/chat/singleModel/postProcess.js` so the outer `runWithTransientBackendRetry` in `src/sse/handlers/chat/combo.js` cannot rerun it. Confirm the actual marker and dispatch provenance rather than treating all 502s as safe refusals. Re-run the failing test and add equivalent transport/body failure cases when repairing. Product files were not changed here.

Acceptance is otherwise incomplete: safe unpinned fallback, non-replay after partial output and transport failure, malformed/HTML responses, abort, body deadline, streamed error terminals, expired metadata, and endpoint-level refusals for Cookie/cURL/HAR still need runtime cases. The declared localStorage value has no expiry metadata. No extension to the shared helper has yet been established as necessary. Root lint results are recorded below.

Root lint with private dependencies: `node node_modules/eslint/bin/eslint.js src` passed with 348 warnings; `node scripts/build-anti-slop-plugin.mjs` and `node scripts/check-anti-slop.mjs` passed (0 diagnostics). The generated bundle had no tracked change. Root and test dependencies were installed with frozen lockfiles in this checkout using private stores. The earlier no-dependency status and command are historical; the result above supersedes them.

## Completion: gateway dispatch, non-replay and import formats

### Product repair

Only `open-sse/executors/tinycms-web.js` changed. No shared handler, base, stream helper, provider config or retry policy was edited. A failure after the TinyCMS chat POST has left the gateway, where nothing proves TinyCMS refused the work, now sets the existing executor `claudeRequestScoped` flag. `postProcess.js` already returns that result as terminal, and `runWithTransientBackendRetry` already stops on it, so neither account fallback nor the outer transient retry sends the chat again. Error code: `upstream_outcome_unknown`, HTTP 502. These failures are covered:

- chat POST transport failure (reset, `fetch failed`), excluding abort, quota-dispatch refusal and refused redirect;
- chat HTTP 5xx (anything `classify` maps to 502);
- 200 JSON: body deadline or read failure (now bounded by `readBodyWithTimeout` with `PROVIDER_BODY_TIMEOUT_MS`/`MAX_PROVIDER_BODY_BYTES`), malformed JSON, no `choices`, or an error envelope that maps to 502;
- 200 with a content type that is neither JSON nor SSE (for example an HTML page). Before the repair this was passed through for buffered requests;
- 200 SSE that resets, ends or stays silent until `STREAM_FIRST_CHUNK_TIMEOUT_MS` before its first output frame, or whose first frame is an error. The executor runs the shared `peekStreamForContent` and replays every byte of a stream that does produce output. Without this, the gateway's existing early-EOF sibling retry in `holdForEarlyEof` sends the chat to the second account. In-stream error frames are not treated as proven refusals because no vendor frame format establishes that.

These kinds stay unchanged and still allow fallback: uncharged setup failures (IP lookup, challenge HTTP refusal, challenge transport failure, malformed challenge, difficulty) and vendor refusals of the chat with 401/403/3xx (auth), 429 (quota, with retry hint) or another 4xx. Partial output followed by an error frame, reset, truncation or stall was already terminal through the gateway's existing partial-output path. The tests now cover it.

### New cases

These are appended to `tests/unit/cookie-flow-tinycms-web-2034.test.js` in a new `describe` block. They use `tests/unit/helpers/cookiePublicFlow2034.js` unchanged, so pairing, import, SQLite, registry, connection selection, executor and both public routes are real. Only operator authority and external network are replaced. Each imported UUID account sits behind its own strict proxy dispatcher, so every physical send records which account sent it, its `uuid` header, the absence of a cookie and its dispatcher. All three original cases and the 12 checkpoint `7e4b3e125f0` public-route cases are kept byte for byte. That includes the ordinary pinned streamed 502 assertion of exactly one challenge and one chat.

- Unpinned gateway selection: picks account A by priority with A's UUID and proxy, for OpenAI and Anthropic routes, buffered and streamed (4).
- Proven-safe fallback to B after a challenge 401, a challenge transport failure, a chat 401, 403 or 429. Each case runs in all four route/stream modes, with exactly one B chat and the original A credentials and proxy (5).
- Outcome-unknown after the chat POST is terminal with exactly `a:challenge, a:chat`, status at least 500, no success terminal, no successful usage row and redaction. The kinds are HTTP 500, HTTP 503, reset, 200 HTML, malformed JSON, JSON without choices, error envelope 500, stream reset before output, empty stream and an error frame before output. Each runs in all four modes (40).
- Pinned 502 on account B in all four modes: exactly one challenge and one chat (4).
- Buffered body deadline, both routes (2), and a silent accepted stream at a 300 ms first-output deadline, both routes (2).
- Partial text then error frame, reset, truncation, or a stall with a 300 ms stall deadline, on both routes. None of these replays or reports success (8).
- Client abort during the challenge or the chat, with no fallback (2).
- Real client API keys scoped to each stored connection with `requireApiKey`. Each key reaches only its account and its usage carries its key id. A foreign, invalid or missing key pinned to A makes no vendor call (1).
- Cookie header, cURL and HAR text go through the real parsers, and their cookies are then submitted to the real import endpoint for create and update, with and without the valid localStorage item. All 12 submissions get 400 with no write and no secret echo (1).
- No write for a cookie with expired `expirationDate`, a malformed UUID, an extra localStorage key, an expired pairing (401), a spent pairing (401) or a foreign-owner pairing request (403) (1).

"No success terminal" means no `finish_reason:"stop"`, `stop_reason:"end_turn"` or `message_stop`. An OpenAI `[DONE]` is allowed only after an error frame. The gateway's own incomplete-stream handling emits `{"error":{"code":"incomplete_upstream_stream"}}` and then `[DONE]`, and that shared behavior was not changed. The partial-stall and silent-stream fakes fail when the request signal aborts, as a network body would, so the gateway's watchdog can end them.

The cases are meaningful regressions. With the pre-repair executor restored temporarily, the same file gave **49 failed, 36 passed**. The failures were all non-replay, pinned-502 (including the checkpoint case), body-deadline and silent-stream cases. The repaired executor was then put back.

### Commands and results

The environment was `env -i` with explicit PATH, `LANG=C.UTF-8` and `CI=1`, plus a unique private `/var/tmp/tiny2034-*` HOME, DATA_DIR, TMPDIR, XDG cache and pnpm store. There were no credentials and every command had a 300-second `timeout`. Root and `tests/` dependencies were installed with `pnpm install --frozen-lockfile` into this checkout's own real `node_modules`, not borrowed links.

```sh
node tests/node_modules/vitest/vitest.mjs run tests/unit/cookie-flow-tinycms-web-2034.test.js tests/unit/tinycms-web-provider.test.js tests/unit/review-w-tinycms-secret.test.js tests/unit/review-x-executor-send-6.test.js tests/unit/web-session-redirects.test.js tests/unit/provider-registration-web-batch-c.test.js tests/unit/api/provider-cookie-import-local-storage.test.js tests/unit/cookie-capture-local-storage-origin.test.js tests/unit/provider-cookie-import-contracts.test.js tests/unit/extend-cookie-public-auth-fixture-2034.test.js --config tests/vitest.config.js --maxWorkers=2
```

Result: **10 files, 309 tests passed** (the TinyCMS flow file has 85). Root lint: `node node_modules/eslint/bin/eslint.js src` exited 0 with 0 errors and 348 warnings, all pre-existing (no `src/` change). ESLint on the two changed files reported nothing. `node scripts/build-anti-slop-plugin.mjs` passed with no tracked bundle change, and `node scripts/check-anti-slop.mjs` passed with 0 diagnostics. Full `test:ci` was not run; it belongs to later PR qualification.

### Remaining uncertainty

- Everything is mocked at the network edge. Real TinyCMS frame shapes, error envelopes, its 5xx semantics and whether a failed chat actually consumed quota are unknown.
- A transport failure on the chat POST counts as outcome-unknown even if the connection failed before any byte was written. The sender exposes no trusted "not sent" marker, so the executor gives up a possible safe fallback rather than risk a replay.
- Buffered and streamed outcome-unknown failures get no unknown-cost receipt. That registration is the separate `register-cookie-outcome-accounting-02` work, so no full accounting claim is made. The usage assertions show only that no successful usage row is written.
- The localStorage UUID has no expiry metadata, so expiry can only show up as a challenge or chat 401. Cookie, cURL and HAR stay unsupported by the source contract (`cookieNames: []`). They are refused safely and no cookie profile or HTTP credential fallback was invented.
- The shared helper needed no extension.
