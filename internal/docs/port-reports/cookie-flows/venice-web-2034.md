# Venice Web cookie flow — #2034

**Status: the cookie-flow contract is proved at mocked boundaries. Live behavior is unproved. No product defect was found.** `venice-web` is an active provider with no guard or staging. The focused test passes locally. These results come from mocked browser, network and proxy boundaries, so they do not show that a live Venice sign-in, Clerk session or completion works. This report does not claim parity with live Venice.

## Real provider contract

The test reads the registered `venice-web` descriptor, and every check below runs against it:

- **Origin.** The descriptor requires the `__client` cookie at `https://clerk.venice.ai`. That Clerk origin is different from the website, `https://venice.ai`, where the user signs in. The capture tab must be on the exact Clerk origin. The extension refuses a tab on `venice.ai`, on the inference host `outerface.venice.ai`, or on plain-HTTP Clerk. It does so before it asks for any permission or reads any cookie.
- **Fields.** The descriptor defines no chunk family, optional cookie, hashed family, localStorage item, account email or `webLogin`.
- **Agreement.** The server contract, the pairing response's `contract`, the dashboard projection (`AI_PROVIDERS`) and the extension table all agree on this definition.

## What the test proves

The test is `tests/unit/cookie-flow-venice-web-2034.test.js` (44 cases). The following parts are real:

- the pairing and import routes
- extension `prepareCapture`/`runCapture`
- the dashboard parser (`buildImportCandidates` and the Cookie, cURL and HAR parsers)
- the SQLite repos, under a private `DATA_DIR`
- `getProviderCredentials` with `preferredConnectionId`, and `resolveCredentialProxyOptions`
- the registered `venice-web` executor
- `proxyFetch`

The following parts are mocked:

- the management guard authority
- `chrome`
- the outbound socket (`__setOriginalFetchForTesting`)
- the proxy dispatchers

### Capture through import

A pairing issued by the server is pasted into the extension. The extension reads only `{url: clerk origin, name: "__client", storeId: <the store that owns the tab>}`. It never reads the decoy store or the Clerk siblings `__session`/`__client_uat`. It never enumerates cookies, never runs a page script and returns every permission it was granted. It sends one POST with `credentials: "omit"` and `redirect: "error"`, and that body has no `accountEmail`.

The stored row has `authType: "cookie"` and `apiKey: "__client=<jwt>"`. The capture view, the result, the route responses and the console logs contain neither the cookie nor the pairing token. The management list and single-connection reads, for both operator and non-operator callers, contain no secret.

### Refusals

- **Sends nothing.** The extension sends nothing when the tab store has no `__client`, has an insecure one, has one for a foreign host, or has only chunk-named cookies. It returns `no_cookies`.
- **Expired browser cookie.** The extension forwards it, and the server refuses it with `Cookie is expired`. The pairing is spent and nothing is stored.
- **Import route.** Each of the following gets a fixed 400 error, spends the pairing and stores nothing:
  - the `venice.ai` origin
  - an `outerface.venice.ai` cookie domain
  - an expired cookie
  - an insecure cookie
  - `__client.0`
  - a Clerk sibling
  - a duplicate `__client`
  - any `localStorage` value (`This provider takes no localStorage value`)
  - `accountEmail` in the body (`Account email is bound by the pairing`)
  - raw `cookieHeader`, `har` or `apiKey` fields, which fail with `cookies must be a non-empty array`

  A pairing request that carries `accountEmail` is also refused (`This provider takes no account email`). The import never derives an email from a cookie value.

### Dashboard paste modes

The test mirrors the import modal's request for the selected candidate. A Cookie header, a cURL from the Clerk origin, and a HAR that holds both an inference entry and a Clerk entry each store only `__client`. The parser refuses the following before any pairing is issued:

- a cURL copied from `venice.ai` or from the inference URL
- a HAR with no Clerk request
- a header with only Clerk siblings

### Ownership and two accounts

- An import without a pairing gets 401.
- An update pairing cannot target the `venice` API-key provider's connection (409, nothing pending).
- An update pairing for account A cannot be moved to account B (409). The pairing is then spent (401), and no row changes.
- A same-name create returns `conflict` and does not overwrite the existing row.

Two accounts are captured by the extension and each is put on its own strict proxy pool. The extension then replaces B's cookie. A stays byte-identical, and B keeps its pool.

For each account, the stored credential is selected and sent to the executor. The executor makes exactly three sends, all through that account's own dispatcher with `redirect: "manual"`:

1. `GET /v1/client`
2. `POST /v1/client/sessions/<that account's session>/tokens`
3. the chat `POST`

The cookie goes only to the two Clerk requests. The chat sends only that account's minted session token and its `userId`. The other account's cookie, token and user id never appear on the wire, and neither does B's replaced cookie. The executor's reported headers and body redact `Authorization` and `userId`.

### Executor failures

- A failing strict proxy gives a 502 after one send, with no direct fallback.
- The following Clerk lookup answers each give 401 `session_expired` after one send, and the stored rows do not change:
  - HTTP 401 or 403
  - `response: null`
  - no active session
  - a sign-in redirect

The executor keeps a session-token cache for the whole process. The test mints fresh synthetic JWTs for every case, so cached values cannot leak between cases.

## Limitation (not a defect)

Import validates the cookie name, origin, domain, `secure` flag, expiry and value syntax. It does not validate the JWT shape that the executor needs. A non-JWT `__client` is therefore stored, and the executor then refuses it with 401 `invalid_credential` before any send. The test asserts this current safe behavior. Rejecting such a value at import time would need a per-provider `credentialPattern`-style check for cookie values in `src/shared/utils/cookieImportContract.js`. That is an optional product change for a later owner, and this unit does not make it.

## Still mocked or unproved

- A live Venice or Clerk sign-in.
- Whether Clerk still answers with these reply shapes, and whether `outerface.venice.ai` accepts the minted token.
- Real browser cookie-store behavior.
- The full HTTP gateway route. Gateway dispatch with a substituted executor is covered separately in `tests/unit/venice-web-provider.test.js`.

No browser, provider or Docker run was made.

## Overlap with existing tests

- `venice-web-provider.test.js` covers the executor wire contract, the token cache and error mapping. It calls the executor directly, not through imported rows.
- `provider-session-registration-1127.test.js` covers parser candidates, direct import, email refusal and rejection of the Venice origin.
- `provider-cookie-capture-extension.test.js` covers capture with a synthetic pairing.

This file adds the joined path that none of them covers: a real issued pairing, then capture or paste, then the route, then SQLite, then selection, then the executor with a per-account proxy.

## Upstream source

The Clerk reply shapes (`{response: {sessions: [{id, status: "active"}]}}`, `{jwt}`) and the newline-delimited `{kind: "content"}` chat events were read from cheaper-inference/OmniRoute `open-sse/executors/venice-web-auth.ts` and `open-sse/executors/venice-web.ts` at `9671192011beb2d7f83979f40be488c5da8772b9`. That commit is dated 2026-11-26T21:35:52Z, before the owner freeze. They were read from the read-only source cache. The test ports no logic.

## Evidence

The private sandbox was `/var/tmp/venice2034-*`. It was built with `git archive HEAD` of this checkout, plus a copy (`cp -a`) of a lock-identical dependency tree. The borrowed tree was not modified. Commands ran from `tests/` with `env -i PATH LANG CI` and a private `HOME`, `DATA_DIR` and `TMPDIR`:

```bash
timeout 280 node node_modules/vitest/vitest.mjs run unit/cookie-flow-venice-web-2034.test.js \
  unit/venice-web-provider.test.js unit/provider-session-registration-1127.test.js --maxWorkers=2
```

Result: 3 files and 267 tests passed, on two consecutive runs. The new file alone has 44 cases, all passing.

A mutation check made the extension's cookie-store selection ignore the tab. 14 cases failed, and the code was then restored. The full `test:ci` suite was not run.
