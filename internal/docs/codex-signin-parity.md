# Codex sign-in and request parity

Internal reference for work order #2034. This file records the comparison between
DurinDoor's Codex sign-in and request surfaces and the upstream providers
inventoried in [`provider-parity-cliproxyapi.md`](./provider-parity-cliproxyapi.md),
[`provider-parity-easycliproxyapi.md`](./provider-parity-easycliproxyapi.md) and
[`provider-parity-omniroute.md`](./provider-parity-omniroute.md).

Scope: Codex OAuth sign-in (browser PKCE and device code), token refresh, account
scoping, and authenticated model discovery. API-key configuration formats are
explicitly out of scope.

## Revisions

| Side | Revision | Note |
| --- | --- | --- |
| `router-for-me/CLIProxyAPI` `main` | [`6faa8d20b2673404cff70a2f2d9537ae0d0e684d`](https://github.com/router-for-me/CLIProxyAPI/commit/6faa8d20b2673404cff70a2f2d9537ae0d0e684d) | Resolved from the public `refs/heads/main` at review time; still the branch head. |
| `router-for-me/EasyCLIProxyAPI` `main` | [`e4223d5eefa22a3301ca7e2a28d05897432b07f9`](https://github.com/router-for-me/EasyCLIProxyAPI/commit/e4223d5eefa22a3301ca7e2a28d05897432b07f9) | Resolved from the public `refs/heads/main` at review time; still the branch head. |
| `cheaper-inference/OmniRoute` `release/v3.8.55` | [`e3c1531afd07d5e06f7ffab658584a7ae2e3627e`](https://github.com/cheaper-inference/OmniRoute/commit/e3c1531afd07d5e06f7ffab658584a7ae2e3627e) | The branch moved past the `ab180e32fcdf1f78c96f98a617e17c86e34bf5aa` recorded in the OmniRoute inventory; this file pins the newer head. |
| DurinDoor | `d8e71637` | Base of this work order (`orq/toruzq/signin-codex-a1-l2`). |

Upstream sources are pinned to the SHA above. Each was read from a shallow clone
and was not modified. No provider API, paid API, browser or Docker was contacted,
and no real credential was read or written.

## Three-way sign-in comparison

| Surface | CLIProxyAPI | EasyCLIProxyAPI | OmniRoute | DurinDoor before this change |
| --- | --- | --- | --- | --- |
| Codex browser PKCE | Yes — `sdk/auth/codex.go` `Login` | Yes — browser OAuth, runtime delegated to the embedded core | Yes — `open-sse/config/providers/registry/codex/index.ts` | Yes |
| Codex device code | **Yes** — `sdk/auth/codex_device.go` `loginWithDeviceFlow` | No — no device grant anywhere in `src/` or `src-tauri/` | No — no `deviceauth` reference in `open-sse/` | **No** |
| Token endpoint | `https://auth.openai.com/oauth/token` (`internal/auth/codex/openai_auth.go`) | Delegated to the core | `https://auth.openai.com/oauth/token` (`open-sse/config/constants.ts`) | `https://auth.openai.com/api/accounts/oauth/token` (registry `oauth.tokenUrl`) |
| Account-scoped model catalog | Yes — `Chatgpt-Account-Id` on the catalog request (`cmd/fetch_codex_models/main.go` `fetchModels`) | Delegated to the core | Not a separate upstream surface | Partly — the account header was sent only from `providerSpecificData` |
| Refresh | `refresh_token` grant on the token endpoint, 5-day lead (`sdk/cliproxy/auth/codex_refresh_selection.go`) | Delegated to the core | Refresh on the accounts token endpoint | Yes — 5-day lead, `open-sse/services/tokenRefresh/` |

The device flow exists only in CLIProxyAPI. It is a **first-party upstream
adapter**, not a delegated path: `sdk/auth/codex_device.go` contains the wire
contract itself, so no third-party claim is needed.

### The Codex device flow wire contract

From `router-for-me/CLIProxyAPI` `sdk/auth/codex_device.go`:

1. `POST https://auth.openai.com/api/accounts/deviceauth/usercode` with the JSON
   body `{"client_id": "app_EMoamEEZ73f0CkXaXp7hrann"}` returns
   `device_auth_id`, `user_code` (or `usercode`) and an optional `interval`
   (number of seconds, or a numeric string).
2. The user approves at `https://auth.openai.com/codex/device`.
3. `POST https://auth.openai.com/api/accounts/deviceauth/token` with the JSON body
   `{"device_auth_id": ..., "user_code": ...}` is polled. A 2xx answers
   `authorization_code`, `code_verifier` and `code_challenge`; upstream treats
   **403 and 404 as "still waiting"**. Every other status is a hard error.
4. The authorization code is exchanged like any other authorization code, with
   the redirect URI `https://auth.openai.com/deviceauth/callback` and the
   server-issued `code_verifier`.

This is **not** the RFC 8628 device-code grant: there is no client-generated
PKCE pair and no `grant_type=urn:ietf:params:oauth:grant-type:device_code`
exchange. The PKCE pair arrives from the server with the authorization code.

## Deltas found and fixed

### D1 — Codex device-code sign-in was missing (implemented)

DurinDoor's Codex provider was `flowType: "authorization_code_pkce"` only, and
the route rejected a device start:

```
[OAuth] codex/device-code failed: Provider does not support device code flow
```

`POST /api/oauth/codex/device-code` answered **HTTP 400**.

The flow is now implemented on the existing device-code infrastructure:

- `open-sse/providers/registry/codex.js` — the `oauth` block carries the device
  endpoints (`deviceCodeUrl`, `deviceTokenUrl`, `deviceVerificationUrl`,
  `deviceRedirectUri`).
- `src/lib/oauth/providers.js` — the Codex provider keeps browser PKCE as its
  primary `flowType` and adds a `deviceFlow` handler set. `requestDeviceCode`
  and `pollForToken` resolve the device handlers for a device-only provider
  (`flowType: "device_code"`) or for a dual provider (`deviceFlow`).
- `src/app/api/oauth/[provider]/[action]/route.js` — `beginDeviceCode` accepts a
  provider that exposes a device path; Codex joins the no-PKCE device set (the
  client never sends a challenge of its own) and the extra-data poll set (the
  poll needs the user code next to the device handle).
- `src/shared/components/OAuthModal.js` — the Codex connect dialog offers
  **Browser** (the previous behavior) and **Device code** (the new path).

The device handle stays server-side: `beginDeviceCode` stores it in the
server-side flow payload and only `flowId`, `user_code`, the verification URL
and the expiry reach the browser.

### D2 — Authenticated model discovery was not account-scoped from the id token (implemented)

Upstream sends the account binding on the catalog request:

```go
// cmd/fetch_codex_models/main.go, fetchModels()
httpReq.Header.Set("Authorization", "Bearer "+accessToken)
httpReq.Header.Set("Originator", defaultCodexOriginator)
httpReq.Header.Set("User-Agent", defaultCodexUserAgent)
if accountID := metaStringValue(auth.Metadata, "account_id"); accountID != "" {
    httpReq.Header.Set("Chatgpt-Account-Id", accountID)
}
```

DurinDoor applied the account header from `providerSpecificData` only, while the
executor and the usage client both fall back to the id token:

| Path | Before | After |
| --- | --- | --- |
| `open-sse/executors/codex.js` (chat) | `providerSpecificData` → id token | unchanged |
| `open-sse/services/usage/codex.js` (quota) | `providerSpecificData` → id token | unchanged |
| `src/app/api/providers/[id]/models/fetchConnectionModels.js` (catalog) | `providerSpecificData` only | `providerSpecificData` → id token |

A credential that carries only an id token — a bulk-imported CLI credential, for
example — therefore reached the Codex backend with no account binding, and the
catalog could answer for a different account than the one the connection is
bound to. The catalog request now also carries the CLI identity headers
(`originator`, `User-Agent`) that upstream sends.

### D3 — Token endpoint family (deliberate difference, not changed)

Upstream exchanges the Codex browser code and the device code at
`https://auth.openai.com/oauth/token`. DurinDoor uses
`https://auth.openai.com/api/accounts/oauth/token` for the browser exchange, the
device exchange and the refresh, so the provider keeps exactly one token
endpoint.

The accounts-domain endpoint is valid for both grants: upstream uses it for its
own "Sign in with ChatGPT" flow (`internal/auth/codex/siwc_auth.go`,
`requestSIWCToken` posts `grant_type=authorization_code` with a PKCE verifier to
`https://auth.openai.com/api/accounts/oauth/token`), and the device
authorization code is minted by the same accounts domain. The refresh contract
is pinned by `tests/unit/codex-refresh-token.test.js`, which this work order may
not change.

## Parity that already held (retained, with regression evidence)

- **Browser PKCE**: the authorize URL, the `S256` challenge, the
  `id_token_add_organizations` and `codex_cli_simplified_flow` parameters, the
  fixed callback port 1455 and the form-encoded exchange match the upstream
  contract. The `codex-signin-parity` test pins them.
- **Token refresh**: the 5-day refresh lead, the rotation of the refresh token
  and the strict-pool route stay as they were; `tests/unit/codex-refresh-token.test.js`
  is unchanged and still passes.
- **Account scoping on chat requests**: the executor already resolves
  `workspaceId` → `chatgptAccountId` → `accountId` → id token and sends
  `ChatGPT-Account-ID`.
- **Responses and streaming**: the provider keeps `format: "openai-responses"`
  with `forceStream: true` against `https://chatgpt.com/backend-api/codex/responses`,
  and the executor keeps the `originator`, `Version` and `session_id` headers.
- **Imported CLI credentials**: `POST /api/oauth/codex/import-token` and
  `POST /api/oauth/codex/bulk-import` are unchanged. The device flow produces a
  row in the same model (`authType: "oauth"` with an access token, a refresh
  token, the id token and the account metadata), so it is interchangeable with an
  imported credential.

## Unverified capability and known limits

- **No live call was made.** The device endpoints, the account-scoped catalog and
  the exchange shapes come from the pinned upstream sources. "Upstream sends
  this" is a statement about upstream code, not a statement that the vendor
  accepted the request.
- **The device exchange redirect differs from upstream by design.** DurinDoor
  posts the device authorization code to the registry-configured token URL; the
  upstream implementation posts it to `https://auth.openai.com/oauth/token`. Both
  are the accounts token endpoint family, but only the DurinDoor variant is
  exercised by the test suite.
- **The CLI device path is broken for every provider, Codex included.**
  `cli/src/cli/api/client.js` reads `device_code` from the device-code response
  and polls with `deviceCode`, while the server returns a `flowId` and polls by
  `flowId`. This is pre-existing and outside the Codex scope of this work order;
  the CLI reaches Codex through the browser PKCE path, which is unaffected.
- **The device flow was not exercised against the real auth service**, so the
  exact interval semantics (`interval` as a number or a numeric string) and the
  403/404 pending contract are covered by the mock only.

## Evidence

`tests/unit/codex-signin-parity.test.js` is the regression test for this work
order. Against the pre-change tree it fails with 10 failures, including:

```
[OAuth] codex/device-code failed: Provider does not support device code flow
AssertionError: expected 400 to be 200
AssertionError: expected undefined to be 'acct-codex-1'
```

The browser-PKCE cases pass against the pre-change tree, which is the evidence
that the retained path was not disturbed.

The work-order gate is:

```bash
cd tests && timeout 300 node node_modules/vitest/vitest.mjs run \
  unit/codex-signin-parity.test.js unit/codex-refresh-token.test.js \
  unit/codex-models.test.js --maxWorkers=2
```

## Pinned follow-up comparison

This pass compares [CLIProxyAPI at `6eb8554f0ede`](https://github.com/router-for-me/CLIProxyAPI/tree/6eb8554f0ede597b2aa3e508ffb3f111d3c2b9e6) and [OmniRoute at `5ffa68e83544`](https://github.com/cheaper-inference/OmniRoute/tree/5ffa68e835442a12ed1204a2eebf4076c298aecb) against DurinDoor from `7f460ce251`. The device-flow comparison earlier in this file describes the earlier pins. OmniRoute has a device flow at the new pin.

| Behavior | Upstream source | DurinDoor state |
| --- | --- | --- |
| Browser authorization URL, client ID, and scopes | CLIProxyAPI `internal/auth/codex/openai_auth.go`, `GenerateAuthURL`; OmniRoute `src/lib/oauth/providers/codex.ts`, `buildAuthUrl` | Already matched for the authorize endpoint, public client ID, OpenID/profile/email/offline-access scopes, and organization and simplified-flow flags. Intentionally different from CLIProxyAPI's mandatory `prompt=login` so the dashboard can reuse the user's OpenAI browser session. |
| Browser PKCE and callback | CLIProxyAPI `pkce.go`, `oauth_server.go`; OmniRoute `providers/codex.ts` | Already matched for S256, state, the fixed CLI callback port 1455, and the callback path. The dashboard also supports a request-local redirect URI. |
| Device start, polling, and code exchange | CLIProxyAPI `sdk/auth/codex_device.go`, `loginWithDeviceFlow`; OmniRoute `src/lib/oauth/codexDeviceFlow.ts`, `requestUserCode`, `pollForAuthorization`, `exchangeCodeForTokens` | Already matched for user-code request, verification URL, waiting on 403/404, and authorization-code exchange with the server verifier and device callback. DurinDoor keeps the device handle in its server flow store and exposes a flow ID to the dashboard. |
| Authorization-code exchange | CLIProxyAPI `openai_auth.go`, `ExchangeCodeForTokensWithRedirect`; OmniRoute `providers/codex.ts`, `exchangeToken` | Already matched for the form fields and PKCE verifier. Intentionally different token URL. DurinDoor uses its existing registry-configured accounts endpoint for both browser and device exchange. |
| Refresh request, deadline, and egress | CLIProxyAPI `openai_auth.go`, `RefreshTokens`, `refreshTokensSingleFlight`; OmniRoute `open-sse/services/tokenRefresh/providers/codex.ts` | Ported here the 30-second exchange deadline and no replay on transport failure. Intentionally different wire encoding and endpoint. DurinDoor retains the established JSON request on the accounts endpoint and the selected connection proxy. The grant omits scope, matching OmniRoute's multi-account behavior. |
| Refresh scheduling and late callers | CLIProxyAPI `codex_executor_auth.go`, `Refresh`, `refreshLocked`; OmniRoute `open-sse/services/tokenRefresh.ts`, `rotationMap.ts` | Already matched for serializing rotating grants and rechecking saved credentials. DurinDoor keeps its five-day expiry lead and eight-day stale refresh rule. Intentionally different from OmniRoute's five-minute lead, configurable passive mode, and import-time token rotation map. |
| Refresh journal, transport loss, nonterminal HTTP errors, and invalid success bodies | CLIProxyAPI `refresh_journal.go`, `journalRefresh`; `refresh_journal_file.go`; `openai_auth.go`, `refreshTokensSingleFlight` | Ported here. A transaction claims the grant before dispatch using a SHA-256 fingerprint in the Codex connection's `providerSpecificData.codexRefreshAttempt`. A second request with the same grant stops before fetching. Transport loss, other ambiguous responses, and process exit leave the claim in place. Saving a replacement grant removes it in the credential write. Reconnect with a fresh grant to recover from a lost rotation. Other connections keep their own state. |
| Journal storage and recovery | CLIProxyAPI `refresh_journal.go`, `usableRefreshReceipt`, `refreshGrantKey`; `refresh_journal_file.go` | Intentionally different. DurinDoor uses the connection database rather than separate receipt files. It stores no token copies in the journal, reconciles using the saved connection, and does no automatic claim release when fetch cannot establish that a request stayed local. A success response must contain a replacement grant for a saved connection. Token-only calls without a saved connection keep their existing in-process refresh contract. |
| Permanent refresh rejection | CLIProxyAPI `openai_auth.go`, `isNonRetryableRefreshErr`; OmniRoute `open-sse/services/tokenRefresh/providers/codex.ts` | Already matched for OAuth 401, expired, invalidated, reused grants and `invalid_grant`. Ported here `invalid_token` from OmniRoute, alongside the retry base's `token_revoked` and `invalid_client`. |
| Account, user, plan, and workspace information | CLIProxyAPI `jwt_parser.go` and `openai_auth.go`, `CreateTokenStorage`, `UpdateTokenStorage`; OmniRoute `providers/codex.ts`, `postExchange`, `mapTokens` | Already matched for extracting email and Codex account/plan claims and retaining the ID token. Intentionally different on workspace selection and refresh. DurinDoor preserves the stored workspace binding and uses JWT fallback for headers rather than switching workspaces from refresh claims or guessing from organization roles and titles. |
| Responses request envelope and compact | CLIProxyAPI `codex_executor_request.go`, `codex_executor_execute.go`; OmniRoute `executors/codex.ts`, `transformRequest`, and `codex/compactionReplay.ts` | Already matched for Responses lowering, forced streaming for ordinary requests, unary compact, system-to-developer role, tool normalization, and reasoning handling. Intentionally different in stateful replay. DurinDoor strips server-stored references under `store:false` and applies its compact allowlist. |
| Reasoning replay, tool result repair, and token counting | CLIProxyAPI `codex_executor_reasoning.go`, `applyCodexReasoningReplayCache`, and `codex_executor_tokens.go`, `CountTokens`; OmniRoute `executors/codex.ts`, `stripOrphanedCodexFunctionCallOutputs`, and `codex/toolCallRepair.ts` | Intentionally different. DurinDoor uses the supplied history and existing translator tool IDs, with provider-scoped encrypted-reasoning validation and retry. It avoids a separate cache that inserts previous reasoning turns and uses a local estimate for the Codex context budget. |
| Session and HTTP headers | CLIProxyAPI `codex_executor_request.go`, `applyCodexHeaders`; OmniRoute `executors/codex.ts`, `execute`; DurinDoor `buildHeaders` | Already matched for bearer auth, ChatGPT account scoping, JSON/SSE negotiation and stable session reuse. Exact upstream client identification, impersonation transports, and detection-evasion behavior are outside this pass. |
| Response retries and terminal SSE | CLIProxyAPI `codex_executor_stream.go`, `codex_executor_terminal.go`; OmniRoute `executors/codex.ts`, `peekCodexSseTransientError`, `terminateCodexHttpStreamOnTerminal` | Already matched for pre-output overload handling, account fallback on model capacity, and avoiding retries after user-visible output. DurinDoor's own bounded HTTP/SSE retry and translator stream lifecycle are retained. |
| Quota, model capacity, and generic rate limits | CLIProxyAPI `codex_executor_terminal.go`, `newCodexStatusErrWithHeadersAndCooling`; OmniRoute `executors/codex/quota.ts`, `parseCodexQuotaHeaders`, `getCodexDualWindowCooldownMs` | Already matched for quota windows, usage-limit cooldowns, and separate transient capacity handling. Intentionally different in cooldown thresholds and model/account scope. DurinDoor applies its shared admission policy, header parsers and account fallback rules. |
| Usage-limit reset timing in standard, top-level, or nested error envelopes | CLIProxyAPI `6eb8554f0ede`, `internal/runtime/executor/codex_executor_terminal.go`, `parseCodexRetryAfter` | Ported here for HTTP 429; generic rate limits do not acquire a usage reset. |
| Account-scoped and client-facing model lists | CLIProxyAPI `cmd/fetch_codex_models/main.go`, `fetchModels`; OmniRoute `executors/codex.ts`, `getCodexUpstreamModel` | Already matched for fetching the authenticated account list with an account header and client version and resolving the upstream model independently of effort suffixes. DurinDoor retains its registry, model aliases, and client-facing catalog policy. |
| Response/error classification and encrypted reasoning | CLIProxyAPI `codex_executor_terminal.go`, `codexStatusErrorClassification`, `codexTerminalFailureStatus`; OmniRoute `executors/codex.ts`, `toCodexResponseFailedEvent`, and `codex/reasoningReplayRejection.ts` | Already matched for terminal context errors and single-attempt encrypted-reasoning recovery. Intentionally different public error envelope and fallback status conventions. DurinDoor uses the shared gateway/translator contract instead of copying CLIProxyAPI's status error codes. |
| Completed output and SSE event filtering | CLIProxyAPI `codex_executor_terminal.go`, `patchCodexCompletedOutput`; OmniRoute `executors/codex.ts`, `filterNonstandardCodexSse`, `encodeResponseSseEvent` | Already matched for recovering output from item events in translated responses. Intentionally different for native passthrough, where DurinDoor preserves upstream event framing and lets the shared stream lifecycle handle the terminal event. |
| Responses Lite tool-call parallelism | OmniRoute `5ffa68e83544`, `open-sse/executors/codex.ts`, `enforceCodexResponsesLiteParallelToolCalls` | Ported here, preserving delegation model exceptions. |
| WebSocket, app-server, and secondary Sign in with ChatGPT credentials | OmniRoute `executors/codex.ts`, `isCodexResponsesWebSocketRequired`, `isCodexAppServerRequired`, and `executors/codex-app-server.ts`; CLIProxyAPI `siwc_auth.go` and `codex_executor_auth.go` | Intentionally different. The `codex` provider uses HTTP Responses and one OAuth credential family. DurinDoor exposes app-server through the separate `codex-app-server` provider so it can retain its own configuration and lifecycle. |

`tests/unit/codex-parity-pass.test.js` exercises the refresh journal through the translator route against the real connection repository and closed token endpoint mocks. It covers a lost response, a malformed success, a subsequent attempt, and successful rotation on a separate connection.
