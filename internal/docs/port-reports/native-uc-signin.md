# Native UC consumer sign-in and scoped sessions (staged)

Issue #1241, related to #2034. The sign-in and session controllers are staged and unregistered. Nothing in production imports `open-sse/services/providerParity/native-uc-signin/`.

## Source

OmniRoute `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT):

- `open-sse/executors/uc/constants.ts`: the Clerk Frontend API host `https://clerk.uncensored.com`, the app origin `https://uncensored.com`, Clerk JS `5.127.1` and Clerk API version `2025-11-10`.
- `open-sse/executors/uc/emailLogin.ts`: the email-code sign-in (`sign_ins`, then `prepare_first_factor`, then `attempt_first_factor`) and the harvest of `__client`, `created_session_id`, the user uid and the cookie jar.
- `open-sse/executors/uc/clerkAuth.ts`: the session token mint and the session touch.
- `open-sse/executors/uc/credentials.ts`: the `providerSpecificData` field names.
- `open-sse/config/providers/registry/uc/index.ts`: the `uc` web-cookie provider row.

No OmniRoute checkout was available in this worktree when this port was written. The wire shapes come from the issue brief and from the staged UC TTS port of the same commit, which already ports `credentials.ts` and the mint half of `clerkAuth.ts`. Treat the sign-in request and response field names as source-described, not re-verified against the file.

## Local equivalence check

There is no equivalent. This module is the whole delta.

- `uc-direct` (`open-sse/providers/registry/uc-direct.js`) is the metered REST API at `api.uncensored.com` with a `uai_` API key. It is a different backend and is not an equivalent. This module does not read, write or produce a uc-direct key.
- `native-uc-tts` reads the same `providerSpecificData` fields and mints one token per call. It has no sign-in, touch, token cache or cookie import.
- `native-uc-video-image` stages uc-direct media only. Its `ucToken` reads `apiKey` and accepts only `uai_` keys.

## Reused staged helpers

These are imported read-only from `native-uc-tts`, and none of those files changed:

- `UC_PROVIDER_DEFINITION.credentialFields`: the source field names, so the two modules cannot drift.
- `resolveUcCredential`: every saved metadata object must pass it before it is returned.
- `normalizeCookieJar` and `cookieHeader`: cookie safety and the `Cookie` header.
- `uidFromSessionJwt`: the uid claim of a minted session JWT.

The tests feed sign-in output into the real TTS `resolveUcCredential` and `mintUcSessionToken`, with a stubbed global fetch for the mint. They also check that the uc-direct `ucToken` returns `null` for it.

## Wire contract (ported)

Every request is `POST https://clerk.uncensored.com{path}?__clerk_api_version=2025-11-10&_clerk_js_version=5.127.1`. It carries these headers:

- `Origin: https://uncensored.com`
- `Referer: https://uncensored.com/`
- `Content-Type: application/x-www-form-urlencoded`
- `Cookie`, only when this one account's jar is not empty.

The requests are, in order:

1. `/v1/client/sign_ins` with `identifier=<email>`. The answer is `{ response: { id: "sia_…", status: "needs_first_factor", supported_first_factors: [{ strategy: "email_code", email_address_id: "idn_…" }] } }` with `Set-Cookie: __client=…`.
2. `/v1/client/sign_ins/{sia}/prepare_first_factor` with `strategy=email_code&email_address_id=<idn>`.
3. `/v1/client/sign_ins/{sia}/attempt_first_factor` with `strategy=email_code&code=<6 digits>`. The answer is `{ response: { status: "complete", created_session_id: "sess_…" } }`.
4. `/v1/client/sessions/{sid}/tokens` with an empty body. The answer is `{ jwt }`; the source also reads `{ token }`.
5. `/v1/client/sessions/{sid}/touch` with an empty body. The answer is `{ response: { id, status, expire_at } }`.

## Saved metadata

The canonical names come from `credentials.ts`:

- `ucClientCookie`: the durable `__client` cookie.
- `ucSid`: the `created_session_id`.
- `ucUid`: the `uid` claim of the first minted session JWT. When the attempt answer names a uid in the session user's `public_metadata` (`uid` or `useruid`), or a `useruid` cookie is set, every named value must agree.
- `ucCookies`: the flat jar for this account, including `__client`.
- `ucAuthSource`: `email-code` or `cookie-import`.
- `ucSignedInAt`: an ISO timestamp.

Never stored: the email, the code, the sign-in attempt and factor ids, the session JWT, `apiKey`, or any uc-direct key.

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
- Challenges: a 401 or 403 answer, or a captcha or bot error code, ends the flow as `needs_operator` with reason `challenge`. The same applies to `needs_second_factor` (reason `mfa`) and to a sign-in without an `email_code` factor. Nothing retries, solves or bypasses these. The operator finishes in their own browser and uses cookie import.
- Malformed success: success is returned only after all of these hold:
  - the created session id is `sess_`-shaped;
  - `__client` is present;
  - a mint returns a JWT-shaped token with a uid;
  - every uid candidate agrees;
  - the staged TTS resolver accepts the result.

  Anything else is `malformed` and nothing is returned for saving.
- Session tokens:
  - The cache belongs to one controller instance and is keyed by uid, sid and a SHA-256 of the durable cookie.
  - It holds only the JWT and its expiry, at most 256 accounts.
  - It refreshes a bounded skew before `exp`: 10 s by default, clamped to 1 to 30 s. No token is kept longer than 120 s.
  - A JWT whose `uid` names another account is refused.
- Revocation: a mint answer of 401 or 404, a revoked-session error code, or a touch status other than `active` answers `reauth` and evicts that account's cache entry.
- Rotation: a `Set-Cookie` that changes the jar during a mint or touch is returned as `rotated` (`{ ucClientCookie, ucCookies }`) for the same connection only.
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

`cd tests && node node_modules/vitest/vitest.mjs run unit/native-uc-signin.test.js --maxWorkers=2` passes 35 tests. All of them use closed mocks: a synthetic Clerk transport fails on any unexpected request, and the emails, codes, cookies and JWTs are synthetic. No browser, mailbox, account or network is involved. The tests cover:

- the opt-in and consent guards;
- input refusals before any request;
- the exact URLs, headers and form bodies;
- start, verify and the harvested metadata;
- the hand-off to the real staged TTS resolver and mint;
- uc-direct key isolation;
- wrong codes and exhausted attempts;
- challenge, MFA and unsupported factors;
- refusals, rate limits, transport failures, redirects and foreign origins;
- malformed successes that are never saved;
- forged caller state;
- the pending-flow cap and flow expiry;
- cancel during a verify;
- the request deadline;
- caller abort;
- two accounts kept apart in flows and session caches;
- mint caching, the refresh skew and its clamps;
- identity mismatch, revocation and touch;
- cookie rotation;
- cookie import.

## Remaining restrictions

- The live service is unverified. The source file was not re-read in this worktree; see Source.
- Only the `email_code` strategy is ported. Password, OAuth, passkey and second-factor completion are not.
- The token cache is in memory for one process. Nothing persists a JWT.
