# MaxAI web-cookie flow (#2034)

**Classification: NOT PARITY.**

DurinDoor's own path from cookie capture to the signed request works offline with synthetic values. Parity is not established, for three reasons:

1. The pinned upstream source defines no MaxAI cookie capture. Nothing read for this report shows that `www.maxai.co` sets cookies named `access_token`, `device_id` and `user_id`.
2. A cookie update can report success while requests keep using an older account. See [the reproduction](#defect-saved-fields-override-a-newly-imported-cookie).
3. Upstream keeps a refresh token and renews the access token. DurinDoor captures no refresh token and has no renewal path in the chat executor.

MaxAI is not guarded or staged: gateway chat reaches `MaxaiExecutor` with an imported credential. No live sign-in, capture or provider request was made.

## Upstream evidence

Project: [cheaper-inference/OmniRoute](https://github.com/cheaper-inference/OmniRoute) (MIT). DurinDoor's registry cites commit `4265bb2ad5477450a07d3a43ea33a62c6c874878`. The source was read from a local checkout at `b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523`.

For these files, the Git blob IDs match at both commits:

| File | What it shows |
| --- | --- |
| `open-sse/config/providers/registry/maxai/index.ts` | `authType: "apikey"`, `authHeader: "bearer"`. No cookie profile. The comment puts the access token on the connection and the device and user IDs in `providerSpecificData`. |
| `open-sse/executors/maxai.ts` | Resolves the credential from `providerSpecificData` and `credentials.accessToken`. |
| `open-sse/executors/maxai/credentials.ts` | Token, device ID and user ID, with an optional refresh token. The user ID can come from the JWT. A comment says the browser's localStorage sometimes wraps the device ID in quotes. |
| `open-sse/executors/maxai/constants.ts` | Signing constants are read from the public web-app bundle. The test's synthetic bundle follows this shape. |
| `open-sse/executors/maxai/signing.ts` | The signature binds the device ID and, through the proof, the user ID. |

These were read at `b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523` only:

- `src/shared/providers/webSessionCredentials.ts` declares MaxAI as `kind: "token"` with `acceptsFullCookieHeader: false`. Its storage keys are token, device ID and user ID field names. This file differs from the pinned commit.
- `src/app/api/providers/[id]/login/route.ts` and `open-sse/executors/maxai/emailLogin.ts` implement an email-code sign-in with a client-generated device ID.
- `open-sse/executors/maxai/refresh.ts` describes an access token of about 24 hours and a refresh token of about one year, and renews the access token with a signed call. A comment in `credentials.ts` says renewal needs a browser instead. Neither statement was tested.

A search of the cached `easy` and `cli` source trees for `maxai.co`, `maxai.me` and `"maxai"` found nothing. This does not prove that the live site lacks the three cookies. A live check by an account owner is still required. The upstream chat request body and stream parsing were not compared.

## Coverage before this change

| Existing test | MaxAI coverage | Not covered there |
| --- | --- | --- |
| `provider-cookie-import-contracts.test.js` | Real descriptor names and origin, parser origin filtering, header composition, basic refusals, as function calls | Routes, storage, capture, request |
| `provider-cookie-capture-extension.test.js` | The extension table matches the registry | A MaxAI capture run |
| `maxai-provider.test.js` | Executor, validation and chat with hand-built credentials and preset signing constants | Import, stored credential, proxy, loading the constants |
| `provider-registration-apikey-batch-b-routes.test.js` | Gateway route with preset signing constants | Import |
| `web-session-redirects.test.js` | Redirect refusal | Import |

## What the new test proves

`tests/unit/cookie-flow-maxai-2034.test.js` uses the real registry entry, extension capture core, dashboard parsers, pairing, import, provider and connection-test routes, isolated SQLite, account selection, `handleChat` and the executor.

| Requirement | Result |
| --- | --- |
| Names and origin | Exact origin `https://www.maxai.co` and three required cookies. The extension reads each by name in the tab's cookie store, including one scoped to `.maxai.co`. |
| Chunks, optional cookies, localStorage | MaxAI declares none. A numbered chunk, an extra `refresh_token`, a camel-case token name and a localStorage value are refused. A pairing cannot add a page-storage read. |
| Cookie header, cURL, HAR | A header, a `www.maxai.co` cURL and a HAR with a `www.maxai.co` request store the same three-cookie header. Two HAR sessions require a choice. |
| Create and storage | One `cookie` connection. The values are not in plaintext in its database row, and are absent from the checked capture results, provider list and detail responses and console output. |
| Refusals | Wrong tabs and origins, disallowed cookie domains, missing or insecure values and past cookie expiry save nothing. Unpaired, oversized and replayed imports are refused. |
| Stored request | With no preset constants, the executor loads them from the mocked web app without account headers, then sends the Bearer token. Opening `X-Authorization` with `openssl` shows the imported device ID. With the clock fixed, changing only the imported user ID changes the proof. |
| Account and proxy | The selected account's proxy options reach every executor send, including the constant loads. Usage is recorded on that account. Disabling it moves the next request to the second account's token, device ID and proxy. |
| Update ownership | For an import-created connection, an update keeps the ID and proxy, replaces the credential, and leaves the other row identical. A redirected update is refused. |
| Expiry and recovery | Mocked chat 401 and 418 leave the connection not active without returning the token. A new import restores it. |
| Connection test | The stored session sends the signed `models/get_config` probe with the account's proxy. 200 is valid; 401 and 418 are not. |
| Constants unavailable | The request fails without calling the MaxAI API. |

### Mocked or unproved

- The management guard decision is a test marker. Real dashboard authentication is covered elsewhere.
- `chrome`, `proxyAwareFetch`, the connection test's proxy reachability check and global fetch are mocks. No browser ran and no traffic passed through a proxy.
- The web-app bundle, signing constants, tokens and API answers are synthetic. The test does not independently recompute the proof, so it does not show that MaxAI would accept the signature.
- Live cookie names, cookie scope, signature acceptance, token lifetime, models and quotas are unverified.

## Current limitations

- Cookies scoped to `maxai.me` or `api.maxai.me` are refused. The descriptor's `domains` list includes `maxai.me`, but the import contract does not use it.
- A cURL copied from an `api.maxai.me` request, or a HAR holding only such requests, is refused even if it carries the three names. A bearer-only cURL is refused for having no Cookie header.
- Import validation is structural. Expiry is refused only when a submitted cookie carries a past `expirationDate`. The parsers send no expiry, and the import code does not read the JWT's `exp`. An expired token in pasted input is found only when MaxAI rejects it.
- From the executor source, not tested: loaded signing constants are cached for the life of the process and never cleared, so a change in the web app would need a restart.

## Defect: saved fields override a newly imported cookie

`cookieValues` in `open-sse/executors/maxai.js` (lines 18-24) reads `providerSpecificData.maxaiAccessToken` or `accessToken`, and the matching device and user fields, before the stored cookie header. The cookie import update replaces `apiKey` and leaves those fields in place.

The authenticated provider create route accepts these fields. Extension and dashboard cookie imports do not add them. A search of `src` found no MaxAI-specific code that writes them.

To reproduce, append this block to a temporary copy of the new test under `tests/unit/`, run the copy with `-t SHADOW-REPRO`, then delete it:

```js
describe("SHADOW-REPRO", () => {
  it("cookie update does not take effect over saved providerSpecificData", async () => {
    const created = await routes.providers.POST(request("/api/providers", { body: {
      provider: "maxai", name: "Token style", apiKey: headerOf(A),
      providerSpecificData: { maxaiAccessToken: B.access_token, maxaiDeviceId: B.device_id, maxaiUserId: B.user_id },
    } }));
    const { connection } = await created.json();
    const update = await importCookies({ action: "update", connectionId: connection.id }, cookiesOf(C));
    const reply = await chat();
    const [call] = apiCalls(CHAT_URL);
    const stored = await row(connection.id);
    process.stdout.write(`REPRO ${JSON.stringify({
      create: created.status, update: update.status, updateOk: update.body.ok, testStatus: stored.testStatus,
      storedCookieIsC: stored.apiKey === headerOf(C), staleKeysKept: stored.providerSpecificData.maxaiAccessToken === B.access_token,
      chat: reply.status, sentBearer: call.init.headers.Authorization, signedDevice: openSignature(call.init.headers).d,
    })}\n`);
  });
});
```

Observed output:

```text
REPRO {"create":201,"update":200,"updateOk":true,"testStatus":"active","storedCookieIsC":true,"staleKeysKept":true,"chat":200,"sentBearer":"Bearer synthetic.maxai-access-bravo.signature","signedDevice":"synthetic-device-bravo"}
```

The update stored account C and returned success, but chat used account B. The committed test does not assert this as accepted behavior. It covers import-created connections, which have none of these fields.

**Minimum repair, for one later owner:** when the stored cookie header carries `access_token`, take the token, device ID and user ID from that header as one set, ahead of `providerSpecificData`. Do not mix sources field by field. Keep the `providerSpecificData` path for connections without such a header. The same precedence is in `open-sse/services/providerParity/native-maxai-image/signing.js` (lines 90-92) and described in that adapter's `registration.json`, so change all three together. The image adapter was read, not run. Add the reproduction as a test that expects account C.

## Remaining path to parity

1. With an account owner, confirm where a signed-in MaxAI web session keeps the token, device ID, user ID and refresh token. If they are not the three cookies, replace the capture profile and import input to match.
2. Repair the credential precedence above.
3. Decide how to renew the access token, then implement and test it, or document daily re-import if the 24-hour lifetime is confirmed.
4. Verify one live capture and request with owner approval.

## Evidence

Run from `tests/` after installing the root and test dependencies:

```bash
node node_modules/vitest/vitest.mjs run unit/cookie-flow-maxai-2034.test.js unit/maxai-provider.test.js unit/provider-cookie-import-contracts.test.js unit/provider-cookie-capture-extension.test.js unit/web-session-redirects.test.js --maxWorkers=2
```

Local result on Node 24.22.3: 5 files and 278 tests passed, including 44 in the new file. ESLint passed on the new test. The full suite, root lint and build were not run. The repository declares Node 24.22.2.
