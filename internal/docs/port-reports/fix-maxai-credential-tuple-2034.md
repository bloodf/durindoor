# MaxAI chat credential tuple (#2034)

**Classification: ISOLATION FIX for chat. NOT PARITY.**

This change fixes the account-mixing defect reported in [the cookie-flow report](cookie-flows/maxai-2034.md#defect-saved-fields-override-a-newly-imported-cookie). It doesn't settle the separate source-parity questions listed under [Not addressed](#not-addressed). No live sign-in, capture or provider request was made.

## Defect, confirmed

`cookieValues` in `open-sse/executors/maxai.js` picked the token, device ID and user ID one at a time, each from `providerSpecificData` first and from the stored cookie header second. A connection with saved `maxai*` fields kept signing as that saved account after a cookie import replaced `apiKey`. If only some fields were saved, one request could carry the Bearer token of one account and the device or user ID of another.

The new test reproduces the earlier `SHADOW-REPRO`. Against the previous executor (`git show HEAD:open-sse/executors/maxai.js`), 9 of its 15 cases fail. The stale account B's Bearer token is sent after a cookie update to account C, and requests that should be refused before any send reach MaxAI with mixed tuples.

## Fix

New module `open-sse/executors/maxaiCredentials.js`, `resolveMaxaiCredential(credentials)`:

1. If the stored header (`cookie`, else `apiKey`) carries `access_token`, the token, `device_id` and `user_id` all come from that header. `user_id` may instead come from the same token's JWT subject. `providerSpecificData` is never read for any member in this case.
2. Otherwise a legacy `providerSpecificData` tuple is used, but only when it is complete. If any `maxai*` field is set, the whole tuple comes from the `maxai*` fields. Otherwise it comes from the plain `accessToken` (or the top-level `accessToken`), `deviceId` and `userId`. One field family is never filled in from the other.
3. These cases are refused:
   - `incomplete`: a member is missing.
   - `conflict`: one header names two different `access_token` values, `cookie` and `apiKey` name different accounts, a JWT subject differs from the stated `user_id`, or the saved and top-level tokens differ.
   - `unsafe`: a value contains CR, LF or NUL, or is longer than 8192 characters.
   - `missing`: no credential material at all.

   A refusal carries only the reason code, never a value.

`open-sse/executors/maxai.js` changes:

- `cookieValues` delegates to the resolver.
- `signedHeaders` takes the resolved tuple and does no lookups of its own, so the Bearer token, the sealed `d` and the proof's user ID all come from one source.
- `runChat` refuses an unusable tuple with 401 before any send, including the uncharged signing-constant loads. Nothing is billed.
- `validateMaxaiSession` uses the same resolver.

The signing cryptography is unchanged. No route, registry, storage, UI or public credential shape changed.

## Image adapter: not changed, blocked by an immutable test

`open-sse/services/providerParity/native-maxai-image/signing.js` `resolveMaxaiImageCredential` still applies the old per-field precedence. An existing test pins that unsafe behavior. That test is outside this change's writable set, so it is reported here and not rewritten:

- **Case path:** `tests/unit/native-maxai-image.test.js`, `describe("wire contract")` → `it("keeps the local cookie-connection precedence")`, assertion at lines 241–242.
- **What it locks:** given `apiKey: "access_token=t; device_id=d; user_id=u"` and `providerSpecificData: { maxaiAccessToken: "psd" }`, the expected result is `{ token: "psd", deviceId: "d", userId: "u" }`. That is a token from one source with a device and user from another, which is exactly the mix this fix forbids for chat.
- **Stricter migration (follow-up owner):** change that expectation to `{ token: "t", deviceId: "d", userId: "u" }`. Then make `resolveMaxaiImageCredential` delegate to `resolveMaxaiCredential`, keeping its quote stripping of a raw localStorage device ID. Update the `credentialSources` text in `registration.json` to match. An earlier attempt that changed `signing.js` without that migration failed this assertion.

**Runtime exposure:** none today. The adapter is still `staged-unregistered`, and no route reaches it. That boundary is unchanged, and `native-maxai-image.test.js` passes unmodified. Until the migration lands, chat and the staged image adapter resolve a mixed-source connection differently. Registering the image adapter must wait for that migration.

The new test uses the image module's `computeMaxaiProof` only to recompute, independently of the chat executor, the proof expected for the chosen user ID.

## Tests

`tests/unit/fix-maxai-credential-tuple-2034.test.js` (15 cases). It runs against the real provider, pairing, cookie-import and connection-test routes, isolated SQLite, account selection, `handleChat` and the executor. Outbound bytes, the proxy reachability check and the management guard decision are mocked.

| Case | Result |
| --- | --- |
| Resolver matrix | Cookie tuple over stale fields; JWT user ID from the cookie token only; missing member, duplicate or conflicting tokens, JWT/user mismatch, CRLF and oversize refused; legacy complete tuples kept; field families not mixed; refusals carry no secret |
| Former SHADOW-REPRO | Connection created with cookie A and stale fields B, cookie update to C → Bearer C, sealed device C, proof equals the independently computed proof for user C (not B), account A's proxy, usage on that connection |
| Two accounts and proxies | A (with B's stale fields) signs as A through proxy A; after A is disabled, B signs as B through proxy B |
| Connection test route | Probe signs with the cookie account, not the saved fields |
| Legacy saved-fields-only connection | Still served with its own complete tuple |
| Refusal before send | Missing `device_id`, missing `user_id`, two access tokens, incomplete saved fields: request fails, zero outbound calls, no usage row, no secret in response or logs |
| Unknown outcome after dispatch | A single account sends once and is not resent |

**Observed, not changed:** with two accounts and a transport error after the chat send, the gateway's account fallback in `src/**` tries the next connection. The test asserts that the failed account is not resent and that any fallback attempt carries the other account's whole tuple and proxy. Whether cross-account fallback after an unknown outcome should be allowed is gateway policy and is left for a follow-up.

Existing tests are unmodified: `cookie-flow-maxai-2034`, `native-maxai-image`, `maxai-provider`, `web-session-redirects`, `review-x-executor-send-5`, `provider-registration-apikey-batch-b(-routes)`, `provider-cookie-import-contracts` and `provider-cookie-capture-extension`.

## Not addressed

These are separate source-parity questions, still unproved or unimplemented:

- **Site storage:** whether `www.maxai.co` actually keeps `access_token`, `device_id` and `user_id` as cookies is still unproved. Upstream declares MaxAI as `kind: "token"`, `acceptsFullCookieHeader: false`.
- **Token renewal:** upstream's refresh-token renewal (`open-sse/executors/maxai/refresh.ts`) has no local equivalent. No refresh token is captured, and no renewal endpoint was added or assumed.
- **Stale fields still stored:** the import update route leaves stale saved fields in place. They are now ignored whenever a cookie token exists, but they are not deleted.

## Source and attribution

The tuple model follows OmniRoute (MIT, [cheaper-inference/OmniRoute](https://github.com/cheaper-inference/OmniRoute)) `open-sse/executors/maxai/credentials.ts`, which resolves the token, device ID and user ID as one credential. Pins are as recorded in the cookie-flow report: registry pin `4265bb2ad5477450a07d3a43ea33a62c6c874878`, local read `b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523`. For `credentials.ts`, the blob is the same at both commits. Only pre-freeze pins already in the repository were compared. No code was copied for this change.

## Evidence

Run from `tests/` in a private environment (`env -i`, private HOME, DATA_DIR and TMPDIR under `/var/tmp`, no credentials):

```bash
node node_modules/vitest/vitest.mjs run unit/fix-maxai-credential-tuple-2034.test.js unit/cookie-flow-maxai-2034.test.js unit/native-maxai-image.test.js unit/maxai-provider.test.js unit/web-session-redirects.test.js unit/review-x-executor-send-5.test.js unit/provider-registration-apikey-batch-b-routes.test.js unit/provider-registration-apikey-batch-b.test.js unit/provider-cookie-import-contracts.test.js unit/provider-cookie-capture-extension.test.js --maxWorkers=2
```

Local result on Node 24.22.3: 10 files and 513 tests passed. ESLint passed on the three changed source and test files. The full suite, root lint and build were not run. The repository declares Node 24.22.2.
