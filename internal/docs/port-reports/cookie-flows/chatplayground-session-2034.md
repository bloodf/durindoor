# ChatPlayground session handoff (#2034)

Source freeze: 2026-11-27T23:49:25.752045Z. Read the sourceflow report
`chatplayground-2034.md`; no post-freeze upstream adoption or live calls.

## Implemented boundary

`chatplaygroundSession.js` extracts the current executor's fixed Clerk exchange.
Only `__client` reaches the fixed Clerk session-token endpoint; the session JWT's
bounded, restricted `sid` selects its path. Cookies never become Bearer headers.
The resulting token goes to the current web `/api/me` and chat endpoints. The
current chat catalog remains credential-free. No legacy `app.` endpoints were added.
No code was ported from OmniRoute; its cached MIT source does not establish the
newer unified web API's identity or availability.

Each operation mints anew. There is no shared token cache or account fallback.
Explicit expired JWTs are rejected; returned expiry is capped at 60 seconds.
Opaque minted tokens remain supported for compatibility with the existing chat
contract and fixtures; they do not establish cryptographic expiry or identity.
Acquisition is bounded to ten seconds and 256 KiB of JSON; cancellation also
bounds transports that ignore signals. Diagnostics contain fixed reason strings,
never upstream bodies, exception text, redirect locations, cookies or token URLs.
No retry is introduced, including after a chat dispatch of unknown outcome.

The exported `inspectChatPlaygroundConnection(credentials, fetcher, options)` is
nonbillable and requires the selected connection's proxy-bound fetcher. It checks
`/me` for a nonempty string `id`, otherwise returns exactly
`unsupported_me_identity_shape`. Discovery additionally requires an array catalog,
otherwise `unsupported_catalog_shape`. These checks establish only the local
protocol contract, not live sign-in. A 200 HTML challenge cannot pass readiness.
The existing compatibility wrappers remain available; registration must activate
the new helper, rather than interpreting those wrappers as strict readiness.

Machine-readable activation instructions are in
`open-sse/executors/chatplayground-session-handoff.json` for register-auth03.
No shared registration, models, test or validation wiring changed here.

## Bounded reproductions for registration owner

The sourceflow report's existing immutable integration test remains the exact
reproduction harness. Its reported base is `4819aba30dd` (38 assertions passed).
Run only with mocked network, isolated environment, and at most two workers:
`node node_modules/vitest/vitest.mjs run unit/cookie-flow-chatplayground-2034.test.js --maxWorkers=2`.

1. In its chat or `/v1/models` case, after the bounded 100 ms warm-up, inspect
   catalog calls: the generic resolver sends
   `Authorization: Bearer __client=synthetic-client-bravo...` to web `/api/models`.
   Required repair is exclusion from both generic Bearer resolvers, then selected
   connection discovery through the helper. The malformed header is not accepted
   behavior and no new passing assertion endorses it.
2. Test and validate issue one raw-Cookie `/api/me` call without minting. Under the
   mocked chat contract they return `valid:false`, although mint then Bearer `/me`
   succeeds. Both need the new readiness helper and selected proxy snapshot.
3. Dashboard discovery's request has `redirect:undefined`; it needs the new helper
   so each request uses `manual` and a 3xx cannot become successful discovery.

## Validation and limits

Added `tests/unit/chatplayground-session-2034.test.js`: real helper/executor with
network mocks, account/proxy closure snapshots, repeated acquisition, explicit
expiry, cookie echo rejection, denial/redirect/HTML/oversize/unknown shape,
abort/stalled body, fixed origins, and one chat dispatch after unknown work.
All existing tests, baseline and test configuration are unchanged.

Syntax checks passed for both executors and the added test. A dependency-free
helper smoke passed mint Cookie scope, Bearer readiness and stalled-body deadline
under `env -i`, explicit PATH/LANG/CI, a unique mode-700 `/var/tmp` HOME/DATA_DIR/
TMPDIR/cache, and a 60 second ceiling. No credentials were inherited.
Root and tests dependencies are absent; no installs or borrowed-dependency edits
were performed. Vitest and repository gates have **not run**; native isolated gate
setup must run the new test and existing ChatPlayground/cookie-flow/redirect suites,
then required full CI. CodeGraph wrapper reported required version unavailable;
bounded exact-file reads were used instead. No claim of live protocol parity.
