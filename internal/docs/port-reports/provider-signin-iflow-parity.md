# iFlow sign-in and request parity (#2034)

## Upstream sources

The three pinned trees were read from the local source caches after checking their `HEAD`:

- [CLIProxyAPI dbe641f](https://github.com/router-for-me/CLIProxyAPI/tree/dbe641f286a489ecb39e3c041c554371e6add864): no tracked path contains `iflow`, and no tracked file mentions it (case-insensitive `git grep`).
- [EasyCLIProxyAPI 29567ea](https://github.com/router-for-me/EasyCLIProxyAPI/tree/29567ead8164a00724dfdc2087f02a23895636ee): same result as CLIProxyAPI.
- [OmniRoute b15b2ee](https://github.com/cheaper-inference/OmniRoute/tree/b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523): no source path or implementation. The only mentions are removal notes. `CHANGELOG.md` records the migration of the legacy iFlow provider to Qoder (#660) and the removal of its leftover refresh-lead entry (#8966). `tests/unit/service-token-refresh.test.ts` asserts that `iflow` now gets the default lead. `docs/reference/ENVIRONMENT.md` lists `IFLOW_OAUTH_CLIENT_ID`/`IFLOW_OAUTH_CLIENT_SECRET` as unreferenced.

None of the pinned sources has an iFlow wire contract to compare with, so none is inferred. The local implementation is the only authority for the behavior below. All four projects are MIT-licensed. No upstream code was copied.

## Production behavior (verified through public handlers)

The handler contracts live in `tests/unit/provider-signin-iflow-parity.test.js`, block "iFlow public handler contracts". They call the real route modules with a local SQLite store in a temporary directory. Only the outbound transport is replaced: the global `fetch` and the `proxyAwareFetch` export. The proxy-pool health probe is stubbed so that no DNS lookup happens.

### Browser sign-in (dashboard)

1. Call `POST /api/oauth/iflow/authorize` with `redirectUri` and an optional `proxyPoolId` or `proxyMode`. The response contains `authUrl`, `state` and `flowId`. The authorize URL is `https://iflow.cn/oauth` with `loginMethod=phone`, `type=phone`, `redirect`, `state` and `client_id`. The server keeps the flow bound to the provider, the state and the selected proxy.
2. The user signs in at the iFlow page and is redirected with `code` and `state`.
3. Call `POST /api/oauth/iflow/exchange` with `code`, `state` and `flowId`. The server then does two things through the proxy chosen in step 1:
   - It sends `grant_type=authorization_code` with Basic client authentication to `https://iflow.cn/oauth/token`.
   - It calls `https://iflow.cn/api/oauth/getUserInfo?accessToken=…`, which must return `success: true` and a non-empty `apiKey`.

   The stored connection holds the access token, refresh token, API key, email and proxy metadata. The response contains only `id`, `provider` and `email`.

Covered by the tests:

- Two accounts can sign in at the same time, each through its own proxy pool. Each stored row keeps its own tokens, key, email and pool.
- Replaying a used flow returns 410 and sends no second token request.
- When two submissions of the same callback race, one succeeds and the other gets 409 or 410. Only one token request is sent.
- These requests fail with 400 before any upstream request:
  - a state mismatch (the flow stays usable);
  - a missing `flowId`;
  - `device-code` (iFlow has no device flow);
  - metadata placed in the query string of the GET authorize route.
- `GET /api/oauth/iflow/authorize?redirect_uri=…`, the compatibility route that the CLI calls, returns a bound flow and no verifier.
- A rejected code, a rejected profile or a missing API key returns 502 and stores nothing.

### Profile verification

`POST /api/providers/{id}/test` calls `getUserInfo` with the stored access token through the connection's own proxy. A rejection returns `valid: false`, does not include the upstream body, and does not send a refresh grant, because iFlow is not marked refreshable in the test configuration.

### Models

The registry model list is static. `GET /v1/models` lists every `if/<model>` entry and sends no request to iFlow. `GET /api/providers/{id}/models` returns 400 ("does not support models listing") without making a request. There is no dynamic discovery endpoint.

### Chat and streaming

`POST /v1/chat/completions` with `if/<model>` sends one request to `https://apis.iflow.cn/v1/chat/completions` with these properties:

- authorization comes from the selected connection's API key, `Bearer <apiKey>`;
- the request carries an HMAC-SHA256 `x-iflow-signature`, a `session-id` and a timestamp;
- streamed requests include `stream_options.include_usage`;
- the request goes through the selected connection's proxy pool.

The tests switch the active account between two connections and check each of these properties for both accounts.

### Refresh, expiry and rejection

No public handler refreshes iFlow OAuth tokens in this checkout:

- `open-sse/executors/iflow.js` does not override `refreshCredentials`, so chat dispatch (`refreshAndUpdateCredentials`) gets `null` and sends the request with the stored API key.
- `POST /api/providers/{id}/refresh-token` accepts Codex only.

With an expired `expiresAt` and an upstream 401, chat returns 401 and sends no token request; the stored refresh token is unchanged. The refresh grant function `refreshIflowToken` sends `grant_type=refresh_token` with Basic client authentication. A rejection returns `null` after a single request. Function-level coverage, including concurrent accounts, is in this file and in `tests/unit/iflow-signin-parity.test.js`.

### Cookie import (dashboard)

To import a cookie, copy the `BXAuth` cookie from a signed-in `platform.iflow.cn` session and paste it into the iFlow cookie dialog. The dialog calls `POST /api/oauth/iflow/cookie`, which does the following:

1. It reads the current key name with a GET to `https://platform.iflow.cn/api/openapi/apikey`.
2. It rotates the key with one POST to the same URL.
3. It stores only `BXAuth=<value>;` together with the new key.

Identity persistence is covered by `tests/unit/v5-cookie-ingress-identity.test.js`. If the cookie is expired or rejected, the user must copy a new one from the browser.

### Known production gaps (not changed here)

These gaps are in files this unit may not edit. They are listed under `productionGaps` in `registration.json`.

- **Exchange errors include the upstream body.** In `src/lib/oauth/providers.js`, iFlow `exchangeToken` and `postExchange` put the upstream response body into the error message, and `POST /api/oauth/iflow/exchange` returns that message in its 502 response. The tests check only the status code.
- **Chat 401 includes the upstream body.** A chat 401 passes the upstream body into the client error and into the connection's `lastError`. This happens in the shared chat handler and affects every provider.
- **The cookie route includes the upstream body.** `POST /api/oauth/iflow/cookie` puts the upstream body in its error responses.
- **The shipped CLI cannot complete iFlow sign-in.** `cli/src/cli/menus/providers.js` gets the flow from `GET …/authorize` (via `cli/src/cli/api/client.js`), then posts `{code, redirectUri, codeVerifier, state}` to `…/exchange` without `flowId`. The server rejects this with 400 "Missing required fields" before making any upstream request.

## Dead legacy path

`src/lib/oauth/services/iflow.js` (`IFlowService`) cannot be loaded:

- It statically imports `../config/index.js`, and `src/lib/oauth/config/` does not exist.
- Its `saveTokens` posts to `/api/cli/providers/iflow`, and no such route exists under `src/app/api`.
- It does not compare the callback `state` with the generated one.

The only reference to it is the barrel `src/lib/oauth/services/index.js`, and no file in `src`, `cli`, `open-sse` or `scripts` imports that barrel. The service is unreachable in production. It is left unchanged, and no configuration module or credential store was added for it. The test block "legacy iFlow CLI service reachability" checks that the import fails.

## Staged web integration

`src/lib/oauth/providerParity/iflow/cookie.js` exports `importIflowCookie(cookie, { fetch, signal })`. Compared with the current cookie route, it:

- rejects input that contains line breaks or does not have exactly one `BXAuth` before any network request;
- sends the same platform GET and a single key-rotation POST, both with the caller's abort signal;
- validates the name and key it receives;
- returns the existing connection shape;
- reports only generic errors.

A failed POST is never retried, because the provider may already have rotated the key. The helper does not store anything or check ownership; the route stays responsible for both.

Integration slots, also listed in `registration.json`, are all in `src/app/api/oauth/iflow/cookie/route.js`:

- replace the inline lookup and rotation with `importIflowCookie`, passing it `request.signal`;
- persist the result with `createProviderConnection`;
- return generic errors and a response without secrets.

The helper is not registered yet, so the production cookie route keeps its current behavior. The test block "staged iFlow cookie import" holds the only staging-dependent assertions, including that the route does not yet import the helper. Change those assertions when the helper is registered. The protocol, security and handler blocks do not depend on staging. OAuth web wiring and flow/state guards are unchanged. They belong to the ordered auth batches.

No live account, browser or real credential store was used. All tokens, cookies and keys in the tests are synthetic.
