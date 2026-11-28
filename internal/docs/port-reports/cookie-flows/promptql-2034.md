# PromptQL cookie flow (#2034)

The repository's real PromptQL profile names `https://prompt.ql.app`, `__Host-next-auth.csrf-token` and `next-auth.session-token`. Both names are required. It declares no chunk prefixes, optional cookies or localStorage keys. Consequently a chunked session alone is refused; no claim is made that this describes every session the live site might issue. The descriptor identifies an experimental integration. Its existing attribution is OmniRoute, `open-sse/config/providers/registry/promptql/index.ts`, commit `4265bb2ad5477450a07d3a43ea33a62c6c874878`, MIT; no upstream behavior is independently asserted here.

The new focused suite connects the actual pairing handler and registry contract to extension selection against a mocked tab and cookie store, and sends the captured values to the actual import handler and isolated SQLite repository. It checks the selected store, bounded named reads, absence of localStorage access, redaction, update binding, account isolation, origin and expiry refusal, and the management guard boundary. It exercises the actual parser with Cookie, cURL and HAR inputs, including distinct HAR accounts and refusal of a wrong origin and unsupported chunks. A stored synthetic connection is passed to the existing executor with mocked token exchange and model-catalog responses. Existing `promptql-import-dispatch.test.js` already covers chat dispatch, refresh, account isolation and error paths; generic extension and import suites cover broader pairing, replay, bounds and transport rules.

These are network and browser mocks, not evidence of live sign-in, actual provider cookies, provider availability, proxy routing, or real account behavior. No browser run was performed. The new executor case uses direct mocked fetch, not a proxy. The parser cases do not submit each parsed candidate to the handler; the extension capture does submit its selected cookies. Those remain gaps in the owner's complete end-to-end requirement. No product defect is asserted on this evidence, and this report does not claim full parity.

Evidence command (from `tests/`, with dependencies installed in an isolated run and private HOME, DATA_DIR, TMPDIR and caches): `node node_modules/vitest/vitest.mjs run unit/cookie-flow-promptql-2034.test.js --maxWorkers=2`. **Not run locally:** the checkout has no test dependencies. The owner must run this focused command and the required full gate on the final head. CodeGraph query `promptql` was attempted but the required CodeGraph 1.6.2 was unavailable; bounded checkout search was used instead.

## Public-route follow-up

Status: **partial mocked evidence, blocked by product defects**. The focused suite now has a `promptql public route dispatch (#2034)` block on the shared `tests/unit/helpers/cookiePublicFlow2034.js` fixture: real pairing and import, isolated SQLite, real `/api/v1/chat/completions` and `/api/v1/messages` routes, the registry and `PromptQlExecutor`, and strict proxy pools. Only the operator boundary and the vendor network are synthetic. The three original cases are unchanged. The only edit above them adds `describe` to the vitest import.

Each vendor call records its operation, the account identified by the exact cookie or bearer token it carried, and the strict-proxy dispatcher. The new cases assert:

- Cookie header, cURL and HAR inputs are each parsed, submitted to the import endpoint and stored before a pinned dispatch. This runs on OpenAI and Anthropic routes, buffered and streamed (6 cases). The call sequence is exactly token exchange with the pinned cookie, model catalog, one `StartThreadWithModel`, then events with the pinned token, all on the pinned account's proxy. The refreshed token is persisted only on that connection. The reply, the connection listing and the captured logs contain no cookie or token from either account.
- An unpinned request whose first-selected account fails the token exchange (401, before any message is sent) falls back to the other account. That account uses only its own cookie, token and proxy (buffered and streamed).
- Pinned 429 on the message mutation, HTML token-exchange body and 403 exchange refusal (4 route/mode combinations each) return the expected error status. The response has no `[DONE]`, `message_stop`, `finish_reason: stop`, `end_turn` or reply text, the vendor sees no extra calls, and no token is persisted.
- A caller abort during event polling ends with no success terminal and no replay.
- Wrong origin, expired cookie, a `localStorage` value (the profile declares none, so the refusal is safe and actionable), a chunked session cookie, and an update pairing for one connection submitted with another's ID are refused with 400/400/400/400/409 and no row change. A non-operator pairing gets 403. A later update changes only the paired row. The next pinned dispatch exchanges the new cookie, so the token cached for the old session is not reused, and stays on the original proxy.

### Product defects blocking the remaining required cases

These were reproduced on the same fixture with the same `vendor()` helper. They are not in the suite as failing or weakened tests.

1. **Replay after accepted work.** If `QueryThreadEvents` returns HTTP 500, malformed JSON or a GraphQL `errors` array after `StartThreadWithModel` succeeded, the executor returns a synthesized 502 `Response`. The gateway treats it as retryable. A pinned request runs the whole sequence three times on the same account, which means three quota-bearing messages. An unpinned request runs it on the second account too. Observed pinned sequence: `[exchange, FetchLlmConfigs, StartThreadWithModel, QueryThreadEvents] × 3`. Observed unpinned sequence: bob ×1 then alice ×1, each with its own `StartThreadWithModel`.
2. **Second mutation after an uncertain one.** If `StartThreadWithModel` returns 502 (HTML) or a GraphQL error, the `catch` around model selection in `open-sse/executors/promptql.js` (`runThread`) falls back to `StartThreadRoomless`, a second quota-bearing mutation on the same account. Defect 1 then repeats both.
3. **No body deadline.** GraphQL bodies are read with `r.json()` and no bound. An events response whose body never finishes keeps the request pending past `RESPONSE_BODY_TIMEOUT_MS=100`, until the 30-second test timeout.

Minimal repair path (product scope, not done here):

- In `runThread`, fall back to `StartThreadRoomless` only when no message mutation was dispatched (`message === null`).
- Once a message mutation has been dispatched, return every non-refusal failure with the `upstream_outcome_unknown` code (`MINIMAX_CODE_OUTCOME_UNKNOWN`). Keep plain 401/403/429 for explicit refusals.
- Add `"promptql"` to `OUTCOME_UNKNOWN_CODE_PROVIDERS` in `src/sse/handlers/chat/singleModel/postProcess.js`. This makes the response terminal: no sibling account and no transient retry.
- Read GraphQL bodies through the bounded reader with `MAX_PROVIDER_BODY_BYTES` and `RESPONSE_BODY_TIMEOUT_MS`, as `t3-chat-web.js` does.

After the repair, the reproductions above become the required no-replay, malformed, HTML-5xx and body-deadline cases. Each needs exactly one `StartThreadWithModel` and no call on the other account.

The shared fixture needs no extension for these cases. Authenticated public-caller and foreign API-key owner cases would need the extension already reported for Conol: `dispatch` accepting extra headers.

### Commands and results

Isolated dependencies came from `pnpm install --frozen-lockfile` in this checkout and in `tests/`, with private HOME, DATA_DIR, TMPDIR, XDG cache and store under `/var/tmp/promptql2034-run/`. Each command ran under `env -i` with `timeout 300s`:

```sh
node tests/node_modules/vitest/vitest.mjs run tests/unit/cookie-flow-promptql-2034.test.js --config tests/vitest.config.js --maxWorkers=2
node tests/node_modules/vitest/vitest.mjs run tests/unit/cookie-flow-promptql-2034.test.js tests/unit/promptql-import-dispatch.test.js --config tests/vitest.config.js --maxWorkers=2
```

Results: 26 passed in one file, then 37 passed in two files. Separately, `node node_modules/eslint/bin/eslint.js src` exited 0 with 0 errors and 348 existing warnings. `node scripts/build-anti-slop-plugin.mjs` exited 0. `node scripts/check-anti-slop.mjs` exited 0 with 0 diagnostics. `git diff --check` passed. Full CI was not run; it is outside this unit's scope.

Remaining uncertainty: all evidence is mocked. Nothing here shows live sign-in, real cookie shapes, provider availability or real proxy behavior. The fallback order between the two accounts is whatever the gateway chose; the test finds the first account and does not fix it. No upstream source was read for this follow-up.
