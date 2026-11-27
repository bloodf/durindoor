# SenseNova session boundaries (#2034)

## Pins and ownership

- Qualified base: `dc624113dc5728c04a01c1dd49e37f9a1dd80c4b`.
- Starting integration: `8f4fc37ee778aeb99f59e450de5ff932e95dae1b`.
- Source: cheaper-inference/OmniRoute #20403, exact head
  `cb67bb6521980b8a2c1d5a28fa2bbd0e5667fca0` (retrieved and inspected).
- Requested earlier report `807f1c838ac0` is not an available local git object;
  its contents were not read or assumed. This is an outstanding evidence limit.
- Temporary scope: usage module, separate endpoint regression file, this report.
  No auth, DB, OAuth, registry or protected-test edits.

Before editing, the checkout was clean. The usage module and protected test were
identical between qualified base and integration; no shared uncoordinated changes
were found in those owned paths. The protected suite's blob is
`e5da7e5acd165d02e66d1cfaa396de072f13f2db`, unchanged after this work.

## Investigation before behavior changes

Source `open-sse/services/usage/sensenovaTokenPlan.ts` recognizes custom nodes by
`token.sensenova.cn`, accepting HTTP/HTTPS, optional ports and a trailing dot,
rejecting URL userinfo. An explicit base URL takes precedence over provider ID.
This is recognition only: `open-sse/services/sensenovaQuotaFetcher.ts` always
exchanges at `https://signin.sensecore.cn/oauth2/token` and reads
`https://platform.sensenova.cn/lite/console/v1/tokenplan/pool-usage`. The recognized
origin is not used to derive credential destinations. Node registration registers
a fetcher under the node ID; fetching and persistence use the selected connection
ID and `fetchWithConnectionProxy(connectionId, ...)`.

The source does **not** establish that an inference API key, custom node and
console refresh token describe the same vendor account. Missing requirements are
an authoritative account identity/binding check, an approved mapping from custom
node IDs to DurinDoor usage dispatch, and a verified credential acquisition and
replacement contract for those nodes. Host recognition alone proves none of
these. Custom-node quota support remains unsupported; there is no new registry
activation, endpoint derivation, credential field, or claim of live parity.

Source exchange classification is 400/401 auth, everything else transient. Its
comment calls 400 `invalid_grant`, but its code does not inspect the OAuth error.
Thus source-backed 403/404/other non-auth failures must not be called rejected
credentials; additionally 400 `invalid_client`/`invalid_request` must not be
inferred to invalidate a refresh token. The local change reports auth only for
401 or an explicit 400 `invalid_grant`. All failures retain stored credentials.
Pool-read 401 remains the only pool response that triggers refresh; pool 403 is
forbidden and does not spend a refresh token. Proactive expiry refresh remains.

The source lacks DurinDoor's cross-process lease. That weaker implementation was
not ported. Existing CAS persist-before-use, memory fallback, lease and replaced
credential protections are retained.

## Changes and offline evidence

The original exchange mapped nontransient 4xx (including permission/configuration
and missing endpoint failures) to auth. Classification now distinguishes these
without clearing credentials. Both credential-bearing endpoints use
`redirect: "error"`; the rotating exchange also sets `noTransportReplay: true`
so proxy transport failure cannot replay it through direct fallback. Existing
10-second request signals cover fetch and body consumption in compliant fetch
transports. There is no custom URL fetch path.

`tests/unit/sensenova-session-boundaries-2034.test.js` uses the real module and
SQLite read/lease/CAS boundaries, mocking only endpoint transport and time. It
covers exchange status/error classification and credential retention, malformed
success and transport failure, expiring-session fallback, pool non-401 failures,
persist-before-retry, selected proxy/account isolation, bounded repeated 401,
hostile URL fields, redirect policy and abort-aware stalled endpoint fixtures.
The redirect fixture checks fetch options and refusal to issue another request;
it is not a live HTTP redirect or network integration test. Deadlines use a
controlled AbortSignal timer and an abort-aware transport fixture.

## Validation and remaining gates

`git diff --check` passed. The original protected file is byte-identical to the
qualified base; its twelve cases were not edited. No baseline changes.

Attempted from `tests/`, with `env -i`, private `/var/tmp` HOME/DATA_DIR/TMPDIR,
caches/store, explicit PATH/LANG/CI and a 300-second ceiling:

```sh
timeout 300 node node_modules/vitest/vitest.mjs run \
  unit/portor-sensenova-token-plan-20403.test.js \
  unit/sensenova-session-boundaries-2034.test.js --maxWorkers=2
```

**Both suites not run:** Node exited before collection because
`tests/node_modules/vitest/vitest.mjs` is absent. No installs, dependency repairs,
relinks or shared dependency mutations were performed. The private gate must
supply setup and run these exact suites (at most two workers, 300 seconds), then
the required full clean-checkout exact-head gate and independent review. No live
provider, account, browser, service, Docker, push, merge or review-train unlock
was attempted. This report is not acceptance evidence for auth06.

## Source attribution

Adaptation reference: OmniRoute `open-sse/services/sensenovaQuotaFetcher.ts` at
the source pin above. Original local persistence safeguards remain DurinDoor's.
Upstream notice (MIT):

> Copyright (c) 2026 Cheaper Inference - Created by Diego Souza
> https://github.com/diegosouzapw

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
