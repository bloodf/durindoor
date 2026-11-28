# Private MaxAI session import and renewal (#2034)

Private and unregistered. No route, UI, registry, storage activation, chat dispatch
or image dispatch imports this module. Public integration belongs to
`register-cookie-repairs-02`; its requirements are in `handoff.json`.

## Frozen evidence

OmniRoute, cheaper-inference/OmniRoute, MIT. Compared only
`4265bb2ad5477450a07d3a43ea33a62c6c874878` and
`b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523`, before the supplied freeze
2026-11-27T23:49:25.752045Z. Read exact Git objects from
`/tmp/omniroute-2034-d3f06`, with `GIT_NO_LAZY_FETCH=1` and
`GIT_OPTIONAL_LOCKS=0`. No newer HEAD or provider calls were used.

The following file blobs are identical at both revisions:

| File | Git blob SHA | Evidence |
| --- | --- | --- |
| `open-sse/executors/maxai/credentials.ts` | `3f12d55999a98d291cd975010135da75271d09b0` | Complete token/device/user credential; optional refresh; JWT subject and expiry; quoted device values |
| `open-sse/executors/maxai/refresh.ts` | `a9c3d922cc64264dea63046cf63135ddb71bd2d7` | Signed refresh request, response aliases, 3600-second proactive margin |
| `open-sse/executors/maxai/signing.ts` | `8de8c41eb3acab090318a0db8c8c9e247bbdeb2e` | Version/time/path/user proof, salted AES envelope, browser headers |
| `open-sse/executors/maxai/protocol.ts` | `d3bb117d8faab1e0e7233f7a48184e4d4930f721` | Fixed API origin and static web origin/referer |
| `open-sse/executors/maxai/emailLogin.ts` | `676b5c1fae4c5b27d51b79a29bf1feacc073052f` | Complete returned credential object; caller-generated matching device ID |
| `src/app/api/providers/[id]/login/route.ts` | `783aea4a0c9fc8a13e8a7bdb5f393dd56563f2e8` | Saves access token in apiKey plus maxai PSD tuple and refresh token |
| `src/app/api/providers/bulk-web-session/route.ts` | `143aee6c714d8554f80c4af7bffdb6c94d7e4b78` | Generic import copies the same credential string into every token alias; not a complete MaxAI session parser |
| `open-sse/services/tokenExtractionConfig.ts` | `d91c9cdb413b8fbc16c06d5bf506173c303235e7` | No MaxAI capture entry |
| `src/lib/providers/webSessionContract.ts` | `58ee726f5b2000df75f2a40c6b41b2f5e70a51a8` | Exports metadata from extraction configs, not session secrets |

`src/shared/providers/webSessionCredentials.ts` differs: blob
`33f181ae6005b7bf22e746b177c777501ab360e7` at 4265bb2, and
`32bf64133b4196a67a82efb5dacd1c703ae6d7f2` at b15b2ee6. The later file
declares MaxAI token-kind, rejects full cookie headers, lists credential aliases
and recommends its browser sign-in. Those aliases are not proof of site storage
keys. The older report's matching-blob claim for credentials/signing is confirmed;
renewal also exists identically at both pins, not only at the later pin.

## Storage and manual transfer

No inspected capture source establishes site cookie names. The credentials
comment mentions raw browser localStorage quoting for device IDs, but provides
no exact storage key, origin or complete token export procedure. It does not
establish that the three credential fields are localStorage keys. There is no
MaxAI session-secret export implementation in the inspected metadata contract.
Comments refer to `maxaiBrowserLogin`, but no file with that name appears in
the pinned tree; the concrete login route uses the email flow.

No inspected source establishes a foreign extension's private storage namespace
either. A normal MV3 extension cannot read another extension's private storage.
If a user obtains a session from such storage, that extension must provide its
own export, or the user must explicitly transfer a complete credential object.
This helper adds no permissions, page execution, cookie scan or storage guesses.
Automatic capture remains unsupported and unverified.

Manual paste accepts the complete credential object shape returned by source
`verifyMaxaiEmailCode`, or a complete source connection object with its PSD tuple
and top-level `accessToken` or token-valued `apiKey`. The explicit private
`exportMaxaiSession` produces the same transferable credential object. It is a
new local manual serialization of source fields, not a claimed upstream export
feature. Copy the whole object from an authorized existing export; do not
assemble a session from different accounts. No raw token-only paste, Cookie,
cURL, HAR, browser storage dump or email login response lacking its device ID is
accepted. Example with synthetic values:

```json
{"accessToken":"synthetic-access","refreshToken":"synthetic-refresh","deviceId":"synthetic-device","userId":"synthetic-user"}
```

Snake-case access/refresh/user aliases follow source email response parsing;
deviceId remains required. JWT subject can supply userId. Duplicate aliases must
agree. A `maxai*` PSD family is never filled from the plain family. The completed
local tuple helper validates the whole chosen tuple. JWT identity/expiry decoding
is structural, not signature verification or proof of provider acceptance.
Legacy source PSD refresh tokens are accepted only for migration into the existing
encrypted top-level refreshToken. If top-level refreshToken exists, it is canonical;
an invalid value fails rather than resurrecting stale PSD material. Output never
creates a PSD refresh secret. Missing refreshToken permits manual import but
cannot renew. Unknown expiry stays absent; reconnect must clear stale expiry.

## Renewal contract

Exactly one POST to `https://api.maxai.me/oauth/refresh_access_token`, refresh token
as Bearer, `noAuthLogout: true`, JSON `{"app":"maxai_webapp"}`. No OAuth client ID,
client secret, scope or grant_type is present in the source refresh request;
`maxai_webapp` is its application marker. Its signature retains user ID, unlike
the three blank-user login paths. The source code actually prefers explicit
userId despite a comment suggesting JWT-first; this helper requires any decoded
refresh subject to agree with the selected user's tuple.

Refresh has no OAuth client_id, scopes, grant_type or form body in these source
files; the app selector is its JSON client marker.

The proof is HMAC-SHA1 of `appVersion:time:path:userId` with key
`time:hmacKey`, then SM3 of `time:sha1:hmacKey`. It uses the existing AES envelope
and static header helpers read-only. The staged image proof helper differs from
this frozen source formula and is deliberately not reused for the proof. Image
code and immutable tests are untouched; that discrepancy remains with its owner.
Constants are supplied explicitly; there are no guessed defaults or network
discovery in this unit. The owner must load valid constants through bounded
source-backed discovery on the selected proxy before calling this helper.

Success accepts `data.access_token` or top-level `access_token` and returns a
complete replacement tuple with the same device/user/refresh token. Conflicting
response aliases fail. Source has no refresh-token rotation response contract;
this helper does not consume invented rotation fields. Expiry comes only from
the new access JWT's finite positive `exp`, in epoch seconds. Approximate 24-hour
and one-year lifetimes appear in upstream comments but are never used as expiry.
No `expires_at` is fabricated. A source comment claiming browser-only TLS conflicts
with refresh.ts's browserless claim; neither establishes live acceptance here.

Uses standard `serializeRefresh`, `proxyAwareFetch` (environment proxy fallback
disabled, strict chosen proxy, no transport replay), and bounded response reading.
Only direct or explicit connection proxy routes are accepted. Endpoint overrides
and relay overrides fail. Manual redirects and changed response URLs fail closed.
One deadline bounds both submit and body, including signal-ignoring transports;
late responses are discarded. Body limit is 64 KiB. Errors carry fixed codes and
status only; provider bodies, tokens, proxy credentials and exception messages
are never logged or returned on failure. Success/export results contain secrets
and belong only in the authenticated owner's encryption path, never list APIs.

The helper does not persist, select another account, retry, or replay billable
work. The JSON handoff specifies proactive and explicit-auth-reject behavior and
requires reconnect-safe CAS before dispatch. The standard serializer currently
has no MaxAI rotation group; per-connection singleflight and revision checks are
the public owner's responsibility, not a shared mutable token cache here.

## Scoped verification

Base: `ff3602026e6e30d1569710efc33f1cfd40349220`. Dependencies were borrowed
through links to the completed cookie-flow checkout; no dependency files are
part of this change. Commands used private HOME, DATA_DIR, TMPDIR and cache
under `/var/tmp/maxai-session-2034-run`, `env -i` and `timeout 300`.

Eight explicit files passed together (376 assertions): `native-maxai-session`,
`fix-maxai-credential-tuple-2034`, `cookie-flow-maxai-2034`, `native-maxai-image`,
`maxai-provider`, `web-session-redirects`, `provider-cookie-import-contracts`,
and `provider-cookie-capture-extension`, all under `tests/unit/*.test.js`, using
`node node_modules/vitest/vitest.mjs run <files> --maxWorkers=2` from tests/.
After adding two boundary cases and lint fixes, the private suite passed again
(38 assertions); the unchanged seven suites account for 340 assertions.
Existing suites and failure baselines are unchanged.

Root lint passed via its exact direct components: `node
node_modules/eslint/bin/eslint.js src` (0 errors, 348 existing warnings),
`node scripts/build-anti-slop-plugin.mjs`, then `node scripts/check-anti-slop.mjs`
(0 diagnostics). The generated lint bundle was restored to the tracked bytes.
Focused ESLint on the new source and test also passed. Full local CI, build,
whole inventory, real provider tests and public activation were not run.

Tooling incident: the initial `pnpm run lint` invocation unexpectedly ran
dependency install/lifecycle hooks against the borrowed root dependency link
before lint. This violated the intended read-only dependency constraint; those
shared dependency side effects were not reverted or repaired. Subsequent checks
used direct Node entrypoints without package-manager invocation. The initial
lint found seven style issues here, which were fixed before the passing run.
