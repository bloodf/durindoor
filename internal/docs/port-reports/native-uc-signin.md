# Native UC consumer sign-in and scoped sessions (staged)

Issue #1241, related to #2034. The sign-in and session controllers are staged and unregistered. Nothing in production imports `open-sse/services/providerParity/native-uc-signin/`.

## Source

OmniRoute `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The four files below were read line by line from a checkout whose `git rev-parse HEAD` printed that commit:

- `open-sse/executors/uc/constants.ts`: Clerk Frontend API host `https://clerk.uncensored.com` (:14), Clerk JS `5.127.1` (:17), Clerk API version `2025-11-10` (:20), app origin `https://uncensored.com` (:23), refresh skew `UC_TOKEN_REFRESH_SKEW_S = 8` (:36).
- `open-sse/executors/uc/emailLogin.ts`: the email-code sign-in (`sign_ins`, then `prepare_first_factor`, then `attempt_first_factor`) and the credential harvest (:121-304).
- `open-sse/executors/uc/clerkAuth.ts`: the session token mint `mintUcSessionToken` (:89-154) and the per-session cache `UcTokenCache` (:156-180). The file has no session touch.
- `open-sse/executors/uc/credentials.ts`: the `providerSpecificData` field names and `resolveUcCredential` (:110-125), the JWT `uid` claim (:12-15, :62-66).
- `open-sse/config/providers/registry/uc/index.ts`: the `uc` web-cookie provider row. It was not re-read for this change.

## Local equivalence check

There is no equivalent. This module is the whole delta.

- `uc-direct` (`open-sse/providers/registry/uc-direct.js`) is the metered REST API at `api.uncensored.com` with a `uai_` API key. It is a different backend and is not an equivalent. This module does not read, write or produce a uc-direct key.
- `native-uc-tts` reads the same `providerSpecificData` fields and mints one token per call. It has no sign-in, token cache or cookie import.
- `native-uc-video-image` stages uc-direct media only. Its `ucToken` reads `apiKey` and accepts only `uai_` keys.

## Reused staged helpers

These are imported read-only from `native-uc-tts`, and none of those files changed:

- `UC_PROVIDER_DEFINITION.credentialFields`: the source field names, so the two modules cannot drift.
- `resolveUcCredential`: every saved metadata object must pass it before it is returned.
- `normalizeCookieJar` and `cookieHeader`: cookie safety and the `Cookie` header.
- `uidFromSessionJwt`: the uid claim of a minted session JWT.

The tests feed sign-in output into the real TTS `resolveUcCredential` and `mintUcSessionToken`, with a stubbed global fetch for the mint. They also check that the uc-direct `ucToken` returns `null` for it.

## Wire contract (verified against the source)

Every request is a form-encoded `POST` to `https://clerk.uncensored.com` with these headers, in this order (emailLogin.ts:47-55, clerkAuth.ts:96-101):

- `Origin: https://uncensored.com`
- `Referer: https://uncensored.com/`
- `Content-Type: application/x-www-form-urlencoded`
- `Cookie`, only when this one account's jar is not empty.

Form bodies are `name=encodeURIComponent(value)` pairs in source order. They are written by hand, as the source writes them, not with `URLSearchParams`.

| Step | Path and query | Body | Cookie | Source success |
|------|----------------|------|--------|----------------|
| 1 | `/v1/client/sign_ins?__clerk_api_version=2025-11-10&_clerk_js_version=5.127.1` | `locale=en-CA&identifier=<email>` | none | 200; `response.id` (`sia_…`) and the `email_code` factor's `email_address_id` (:130-181). Any `Set-Cookie` becomes the jar for steps 2 and 3 (:140-143). |
| 2 | `/v1/client/sign_ins/{sia}/prepare_first_factor` (same query) | `email_address_id=<idn>&strategy=email_code` | step-1 jar | HTTP 200 only; the body is not read (:186-205). |
| 3 | `/v1/client/sign_ins/{sia}/attempt_first_factor` (same query) | `strategy=email_code&code=<code>` | step-1 jar | 200 and `response.status == "complete"` (:229-268). |
| mint | `/v1/client/sessions/{sid}/tokens?_clerk_js_version=5.127.1` | empty | the account jar | 200 and a top-level `jwt`, else a top-level `token` (clerkAuth.ts:95-131). |

The step-3 harvest is (emailLogin.ts:270-303):

- `sid`: `response.created_session_id`;
- `uid`: `client.sessions[id == sid].user.id`;
- `clientCookie`: `__client` from the step-3 `Set-Cookie`. A step-3 answer without it is refused, even when step 1 set one;
- `cookies`: the step-3 `Set-Cookie` jar.

The session JWT is a 60 s RS256 token with `iss: clerk.uncensored.com` and `exp - iat = 60` (clerkAuth.ts:4-6). Its `uid` claim equals the account uid (credentials.ts:12-15, `uidFromSessionJwt` at :62-66). The source never requires the claim. It reads only `exp` for the cache and `uid` for recovery. A 401 or 403 mint means the durable login is invalid and needs re-login (clerkAuth.ts:85-87). Tokens are re-minted 8 s before `exp` (constants.ts:36, clerkAuth.ts:168).

## Source verification: before and after

The first port was written without the source files. Reading them found these differences. Each is now corrected and has a test in `tests/unit/uc-signin-source-contract.test.js`.

| Area | Before | After (source line) |
|------|--------|---------------------|
| Step-1 body | `identifier=<email>` | `locale=en-CA&identifier=<email>` (emailLogin.ts:133) |
| Step-2 body order | `strategy=email_code&email_address_id=…` | `email_address_id=…&strategy=email_code` (:191) |
| Body encoding | `URLSearchParams` | `encodeURIComponent` per value (:133, :191, :234) |
| Step-1 `__client` | Required, or the start failed as `malformed` | Not required; carried when present (:140-143, :190) |
| Prepare answer | Body had to echo the sign-in id | 200 is enough. A body that names another id is still refused (fork). (:198) |
| Cookie carry into step 3 | Step-1 jar plus the prepare and wrong-code `Set-Cookie` | Step-1 jar only (:233) |
| Durable cookie | Any `__client` in the merged jar | The step-3 `Set-Cookie` `__client` only (:287-294) |
| Saved jar | Merged flow jar | The step-3 `Set-Cookie` jar, plus mint rotation (:302) |
| uid source | JWT `uid` claim, cross-checked with an invented `user.public_metadata.uid/useruid` and a `useruid` cookie; failed without one | `client.sessions[id == sid].user.id` (:273-285). The JWT `uid` claim is checked only when present. |
| Mint query | `__clerk_api_version=…&_clerk_js_version=…` | `_clerk_js_version=5.127.1` only (clerkAuth.ts:95) |
| Mint answer | `jwt`, `token` or `response.jwt` | Top-level `jwt`, else top-level `token` (:128-131) |
| Mint 403 | `needs_operator` (challenge) | `reauth` with cache eviction (:85-87) |
| Session touch | `POST /v1/client/sessions/{sid}/touch` and a `touch` method | Removed. The source has no touch endpoint. |
| Refresh skew default | 10 s | 8 s (constants.ts:36); still clamped to 1 to 30 s |
| Cookie import | Failed as `identity` when the JWT had no `uid` claim | Accepted when the claim is absent (credentials.ts:121-122 takes the uid from the paste). A `uid` or `sid` claim that names another account or session is refused. |

Unchanged after review: the host, origin, Referer, Content-Type, JS and API versions, the step-3 body, the `email_code` factor selection, the `{ response }` or bare body handling (emailLogin.ts:112-115), the empty mint body, and the `providerSpecificData` field names.

### Export change

`touchUcSession` and `createUcSessionController().touch` are removed, and `sessionJwtClaims` and `ucClerkForm` are added. No file outside this module and its tests imports it (checked with `git grep`). The staged private UC chat module does not consume it, so no consumer change is needed. A later wiring step must not call a touch route.

## Fork deviations (safety)

- Opt-in: every controller call answers `disabled` (403) unless `DURINDOOR_UC_CONSUMER_SIGNIN` is exactly `1`. Start and cookie import also need `consent: true` on each call.
- Caller input: the pending sign-in state stays inside the controller, keyed by a random UUID flow id. `verify` reads only `flowId` and `code`. A caller body cannot supply a sign-in id, a session id or cookies, and cannot resume another flow.
- Per-account jars: each flow and each session call uses only its own account's jar. There is no global or cross-account jar.
- Bounds:
  - 15 s per request, enforced even when the transport ignores its signal;
  - 64 KiB per answer;
  - a 10 min flow lifetime;
  - 5 verify attempts;
  - 32 pending flows.
- Challenges during sign-in: a 401 or 403 answer, or a captcha or bot error code, ends the flow as `needs_operator` with reason `challenge`. Step 1 must answer `needs_first_factor`. The same applies to `needs_second_factor` (reason `mfa`) and to a sign-in without an `email_code` factor. Nothing retries, solves or bypasses these. The operator finishes in their own browser and uses cookie import.
- Malformed success: success is returned only after all of these hold:
  - the created session id is `sess_`-shaped;
  - the step-3 `Set-Cookie` holds `__client`;
  - the session whose id is `created_session_id` names a resolver-safe `user.id`. The source's fallback to `sessions[0]` (emailLogin.ts:280) is not ported, so another account's session in the same client is never picked;
  - one mint with the harvested jar returns a JWT-shaped token whose `uid` claim, when present, equals that `user.id`, and whose Clerk `sid` claim, when present, equals the created session id;
  - the staged TTS resolver accepts the result.

  Anything else is `malformed` and nothing is returned for saving.
- Session tokens:
  - The cache belongs to one controller instance and is keyed by uid, sid and a SHA-256 of the durable cookie.
  - It holds only the JWT and its expiry, at most 256 accounts.
  - It refreshes a bounded skew before `exp`: 8 s by default, as in the source, clamped to 1 to 30 s. No token is kept longer than 120 s.
  - A JWT whose `uid` claim names another account, or whose `sid` claim names another session, answers `identity`. An absent claim is not a refusal. `sid` is a standard Clerk claim that the source does not name, so it is checked only when present.
- Revocation: a mint answer of 401, 403 or 404, or a revoked-session error code, answers `reauth` and evicts that account's cache entry.
- Rotation: a `Set-Cookie` that changes the jar during a mint is returned as `rotated` (`{ ucClientCookie, ucCookies }`) for the same connection only.
- Fixed origin: a redirect is refused and is never followed with the cookie. An answer from another origin is refused. A `Set-Cookie` scoped to another domain is dropped.
- Redaction: result messages are fixed. No result quotes the email, the code, a cookie, an id or an upstream body.

## Registration (serial step)

See `open-sse/services/providerParity/native-uc-signin/registration.json`. It lists four authenticated dashboard routes:

- `POST /api/providers/uc/signin/start`
- `POST /api/providers/uc/signin/verify`
- `POST /api/providers/uc/signin/cancel`
- `POST /api/providers/uc/cookies/import`

It also records the kind-to-status map, a lifetime of one controller per process, and the connection-form panels. None of this is wired here.

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/uc-signin-source-contract.test.js unit/native-uc-signin.test.js --maxWorkers=2
```

This passes 53 tests: 18 source-contract tests and 35 module tests. All of them use closed mocks. A synthetic Clerk transport fails on any unexpected request, and the emails, codes, cookies and JWTs are synthetic. No browser, mailbox, account or network is involved.

`uc-signin-source-contract.test.js` cites a source line for each expectation. It checks:

- the exact URL, header object and key order, and raw body of every request;
- step-1 cookies carried into steps 2 and 3, and prepare cookies not carried;
- the source success shape and the harvested credential;
- a step 1 without cookies and a prepare with an empty body;
- refusal of a step-3 answer without `__client`;
- the uid taken from the created session only;
- capture-shaped JWT claims, with and without `uid`, and foreign `uid` or `sid` claims;
- the mint URL and the `jwt`/`token` answer forms;
- the 8 s refresh and 401/403 re-login;
- per-connection rotation;
- no touch export;
- the staged TTS `resolveUcCredential` and `mintUcSessionToken` with and without a `uid` claim;
- cookie import with absent, matching and foreign claims.

`native-uc-signin.test.js` keeps every earlier security assertion. These include the opt-in and consent guards, input refusals, opaque flow ids, forged caller state, bounded attempts, flows and deadlines, cancel and abort, challenge and MFA mapping, redirect and foreign-origin refusal, redaction, account isolation in flows and caches, cache bounds and uc-direct key isolation. Only expectations the source contradicts changed: the step-1 form, the mint query, the touch test, the default skew, the 403 mapping, the step-1 `__client` requirement and the absent-`uid` import case. A stricter case replaces each removed malformed or identity case: no matching session, an unsafe `user.id`, an empty session list, or a foreign `sid` claim.

## Remaining restrictions

- The live service is unverified. The source describes its shapes as capture-confirmed, but no live call was made here.
- Only the `email_code` strategy is ported. Password, OAuth, passkey and second-factor completion are not.
- The token cache is in memory for one process. Nothing persists a JWT.
