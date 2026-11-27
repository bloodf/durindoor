# xAI and Grok CLI sign-in comparison (#2034)

Pinned sources, each HEAD verified before reading:

- CLIProxyAPI `dbe641f286a489ecb39e3c041c554371e6add864` (MIT)
- OmniRoute `b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523` (MIT)
- EasyCLIProxyAPI `29567ead8164a00724dfdc2087f02a23895636ee` (MIT)

This unit keeps commit `cba1a6d82a` (staged browser/import helpers, per-proxy CLI discovery, body-free CLI token errors) and its tests unchanged, then extends them.

## What works in production

| Provider | Mode | User steps | Behavior verified by tests |
| --- | --- | --- | --- |
| `xai` (api.x.ai) | Browser PKCE, loopback 127.0.0.1:56121 | Choose xAI, approve in the browser, return to the dashboard | Authorization URL with state, S256 challenge, scope `... grok-cli:access api:access`; concurrent exchanges keep verifier and proxy |
| `xai` CLI service | Same browser flow from `src/lib/oauth/services/xai.js` | Run the CLI login and approve in the browser | Discovery cached per proxy object, fallback endpoints not cached; refresh uses the discovered token endpoint and the selected proxy |
| `grok-cli` (cli-chat-proxy.grok.com) | Device code | Choose Grok CLI, open the verification URI, enter the user code | Device request validates codes and URIs; each poll sends the device code with the selected proxy; denied and expired responses are not pending |
| Both | Refresh | None | `refreshXaiToken` serves both providers. Refresh errors carry `HTTP <status>: <oauth error code>` and never the response text, so `invalid_grant` still marks the connection invalid; 5xx returns `null` for retry |

This unit corrected one regression in `cba1a6d82a`: replacing refresh errors with `HTTP <status>` alone stopped `open-sse/services/tokenRefresh/providers.js` from detecting `invalid_grant`. `src/lib/oauth/services/xai.js` now builds both exchange and refresh errors with `oauthFailureMessage`, which keeps only a code that matches `^[a-z][a-z0-9_]{0,63}$`.

Request identity is production behavior and covered without changes. The `grok-cli` executor sends each account's own bearer, `x-email` and `x-grok-agent-id`, plus `x-grok-client-version` = `GROK_CLI_VERSION` (1.0.44). That is above the CLIProxyAPI server floor of 1.0.13 (`internal/runtime/executor/helps/xai_version.go`). `grok-build` sends the grok-shell fingerprint without `x-xai-token-auth`. The `xai` executor sends no `x-grok-*` or `x-xai-*` headers. Model discovery uses the static `grok-cli` registry list with `passthroughModels`, covered by `tests/unit/grok-cli-missing-models.test.js`; no live `/v1/models` fetch is wired. Request and stream translation are covered by the existing `grok-cli-*` and `xai-*` suites and were not changed.

## Staged, not active

`src/lib/oauth/providerParity/xai-grok-cli/` holds web-safe helpers (no `open` import). `registration.json` lists every export and the exact integration slots for the ordered auth batch. Only `oauthError.js` is imported by production code, through the CLI service.

- `discovery.js`: `discoverXaiWebEndpoints` and `exchangeXaiWebCode` for the dashboard `xai` provider. Today `providers.js` caches the static fallback for the life of the process and puts the token error body into the thrown message.
- `device.js`:
  - `assertGrokSignInMode` rejects any mode other than device, browser or import before the network.
  - `pollGrokDeviceAuthorization` runs the CLIProxyAPI poll lifecycle over the production `grok-cli.pollToken` transport. It polls immediately, waits at least 5 s, adds 5 s on `slow_down`, and stops at the earlier of `expires_in` and 30 minutes. `access_denied` and `expired_token` end it, and an `AbortSignal` stops it during a wait. It sends nothing after a token is accepted, and errors carry only the OAuth code.
  - `parseGrokAuthJsonPaste` follows OmniRoute #7610. It rejects a bare JWT or entries without `refresh_token`, and returns only the selectable account keys.
- `index.js` (from `cba1a6d82a`): Grok Build browser PKCE on 127.0.0.1:56122 with scope `openid profile email offline_access grok-cli:access`, and `mapGrokImportedToken`, which imports one explicitly selected auth.json entry. Expired imports stay eligible for refresh. JWT signatures are not checked, and these values must not be used for authorization.

Production does not offer Grok browser login or auth.json import. Production `grok-cli` request and poll errors still include response text. Both are `providers.js` slots in `registration.json`.

## Source attribution and unsupported paths

- CLIProxyAPI [`internal/auth/xai/xai.go`](https://github.com/router-for-me/CLIProxyAPI/blob/dbe641f286a489ecb39e3c041c554371e6add864/internal/auth/xai/xai.go) and [`types.go`](https://github.com/router-for-me/CLIProxyAPI/blob/dbe641f286a489ecb39e3c041c554371e6add864/internal/auth/xai/types.go) define:
  - discovery of `device_authorization_endpoint` and `token_endpoint`, validated as https on x.ai
  - a device request with `client_id` and `scope` only
  - the poll lifecycle described above
  - refresh with single flight per refresh token, which DurinDoor matches with `dedupRefresh`

  CLIProxyAPI has no local authorization-code flow. Its `plan=generic&referrer=cli-proxy-api` query extras appear only in DurinDoor's browser flow and OmniRoute's `xai-oauth.ts`. CLIProxyAPI resolves the client version from npm `@xai-official/grok` (fallback 1.0.46). DurinDoor pins 1.0.44, and that pin lives in `open-sse/config/grokCli.js`, outside this unit.
- OmniRoute [`xai-oauth.ts`](https://github.com/cheaper-inference/OmniRoute/blob/b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523/src/lib/oauth/providers/xai-oauth.ts), [`grok-cli.ts`](https://github.com/cheaper-inference/OmniRoute/blob/b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523/src/lib/oauth/providers/grok-cli.ts), [`grok-cli-oauth.ts`](https://github.com/cheaper-inference/OmniRoute/blob/b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523/src/lib/oauth/providers/grok-cli-oauth.ts), [`grokCliAuthJson.ts`](https://github.com/cheaper-inference/OmniRoute/blob/b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523/src/lib/oauth/utils/grokCliAuthJson.ts) and [`constants/oauth.ts`](https://github.com/cheaper-inference/OmniRoute/blob/b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523/src/lib/oauth/constants/oauth.ts) define:
  - separate xAI (56121) and Grok Build (56122) browser scopes
  - the Grok device flow with a `referrer=grok-build` field
  - paste import

  OmniRoute picks an auth.json entry automatically, preferring the `issuer::clientId` key. The staged DurinDoor mapper requires an explicit selection instead. OmniRoute's `rawAuthJson` retention was not ported, so the full file is never stored.
- EasyCLIProxyAPI has no xAI or Grok authentication wire contract:
  - `src-tauri/src/agents/discovery.rs` and `environments.rs` locate the Grok Build config under `~/.grok`.
  - `src-tauri/src/management_api.rs` maps `grok`/`x-ai` to the `xai` provider ID.
  - `src/services/xaiBilling.ts` defines billing types.

  No protocol is inferred from these files.
- No source establishes an OIDC `audience` parameter for these flows, so none is sent.

## Evidence

`cd tests && node node_modules/vitest/vitest.mjs run unit/provider-signin-xai-grok-cli-parity.test.js --maxWorkers=2` runs 27 tests with synthetic tokens and mocked `fetch` only. The device-poll tests use fake clocks and aborts. One isolated block, marked as staging-only, asserts that the helpers are not yet registered.
